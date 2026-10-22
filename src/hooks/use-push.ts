"use client";

import { useCallback, useEffect, useState } from "react";
import { authHeader } from "@/lib/db/supabase-client";
import { invalidatePushSubscription } from "@/lib/push-subscription";
import { isTimeZone } from "@/lib/tz";

/**
 * Turning the browser into something the app can reach when it is closed.
 *
 * Three separate things have to line up, and a student who is told "reminders
 * are on" while only one of them is true is worse off than one who is told
 * nothing, so each is checked and the switch only reports on when all of them
 * hold:
 *
 *  1. the browser can push at all,
 *  2. the deployment has a VAPID key pair to push with,
 *  3. this browser holds a subscription, saved against this account.
 *
 * The time zone is sent along with the subscription and nowhere else. It is the
 * only moment in the whole system at which anyone knows whose clock the event's
 * "09:00" belongs to - the browser does, the database does not, and the job that
 * sends the reminder does not either.
 */

export type PushState =
  /** The browser cannot push, or the deployment has no keys for it. */
  | "unavailable"
  /** Supported and configured, but this browser is not subscribed. */
  | "off"
  /** This browser is subscribed and its endpoint is saved. */
  | "on"
  /** Asking the browser, or saving the result. */
  | "busy";

export type PushStatus = {
  state: PushState;
  toggle: () => void;
};

/** Whether this browser can be asked for a subscription at all. */
export const pushSupported = () =>
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/**
 * The VAPID public key as the bytes `subscribe` wants.
 *
 * The key travels as base64url because that is how it is published; the API takes
 * a `BufferSource`. Done by hand rather than by `Buffer.from(s, "base64")`,
 * which is not base64url - the two differ in `-` and `_` - and quietly produces
 * a key the push service rejects with no explanation.
 */
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.trim().replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  // Backed by a plain ArrayBuffer rather than inferred from one, because the DOM
  // type wants `BufferSource` and not every typed array is one.
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** The bytes of whatever the browser stored, whatever shape it stored them in. */
function storedBytes(source: BufferSource): Uint8Array {
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  const view = source as ArrayBufferView;
  return new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);
}

/**
 * Whether a subscription was made with the key this deployment publishes now.
 *
 * A subscription is bound to the key pair that created it. When the pair is
 * replaced - a fresh deployment, a rotated secret - every subscription made
 * under the old pair stops being deliverable, and the push service says so
 * with a bare 403. The browser still believes it is subscribed, so the switch
 * is on, the job runs every minute, and nothing ever arrives: a reminder that
 * is on and cannot be delivered.
 *
 * Null means "cannot be told": the browser does not expose the key it used, and
 * re-subscribing on a guess would churn a working subscription for nothing.
 */
function sameApplicationKey(subscription: PushSubscription, publicKey: string): boolean | null {
  const stored = subscription.options?.applicationServerKey;
  if (!stored) return null;
  const a = storedBytes(stored);
  const b = keyBytes(publicKey);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The zone this browser is on, or UTC when it will not say. */
const zone = () => {
  try {
    const found = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return found && isTimeZone(found) ? found : "UTC";
  } catch {
    return "UTC";
  }
};

export function usePush(): PushStatus {
  const [state, setState] = useState<PushState>("unavailable");

  useEffect(() => {
    if (!pushSupported()) return;
    let live = true;

    void (async () => {
      try {
        const res = await fetch("/api/push/subscribe");
        // A deployment with no VAPID pair answers 503, and that is the whole
        // answer: there is nothing to subscribe to, so the switch is not shown
        // rather than shown and failing.
        if (!res.ok) return;
        const { vapidPublicKey } = (await res.json()) as { vapidPublicKey?: string };
        if (!live || !vapidPublicKey) return;

        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (!existing) {
          if (live) setState("off");
          return;
        }

        // A subscription made under a key this deployment no longer uses cannot
        // be delivered to. It is replaced here rather than left failing on
        // every tick of the delivery job, and the student is not asked to do
        // anything: the browser is the only party that can make a subscription,
        // and it can make a new one without being asked twice.
        if (sameApplicationKey(existing, vapidPublicKey) === false) {
          const renewed = await renew(reg, existing, vapidPublicKey);
          if (live) setState(renewed ? "on" : "off");
          return;
        }

        if (live) setState("on");
      } catch {
        /* offline, or no worker yet: reported as unavailable until asked again */
      }
    })();

    return () => {
      live = false;
    };
  }, []);

  const toggle = useCallback(async () => {
    if (!pushSupported() || state === "busy") return;
    setState("busy");

    try {
      const res = await fetch("/api/push/subscribe");
      if (!res.ok) throw new Error("UNAVAILABLE");
      const { vapidPublicKey } = (await res.json()) as { vapidPublicKey?: string };
      if (!vapidPublicKey) throw new Error("UNAVAILABLE");

      let permission = Notification.permission;
      if (permission === "default") permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("off");
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      const existing = await reg.pushManager.getSubscription();

      if (existing) {
        // Turned off: the endpoint is removed from the server first, so a
        // subscription that cannot be deleted leaves no row sending to it.
        await unsubscribe(existing.endpoint);
        await existing.unsubscribe();
        invalidatePushSubscription();
        setState("off");
        return;
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyBytes(vapidPublicKey),
      });
      await save(sub.toJSON() as PushSubscriptionJSON);
      invalidatePushSubscription();
      setState("on");
    } catch {
      // Anything that goes wrong here ends with the switch off and the truth on
      // screen. A reminder that claims to be on and is not is the failure this
      // is guarding against.
      setState("off");
    }
  }, [state]);

  return { state, toggle };
}

type PushSubscriptionJSON = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

/**
 * Re-subscribes this browser under the key the deployment publishes now.
 *
 * The old row is removed from the server first: a row that cannot be delivered
 * to is a row the delivery job tries every minute and fails on every minute.
 * Then the browser is asked for a new subscription, which it can do on its own
 * as long as the permission was already granted.
 */
async function renew(
  reg: ServiceWorkerRegistration,
  old: PushSubscription,
  publicKey: string,
): Promise<boolean> {
  if (Notification.permission !== "granted") return false;
  const oldEndpoint = old.endpoint;
  try {
    await old.unsubscribe();
    if (oldEndpoint) await unsubscribe(oldEndpoint);
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    });
    await save(sub.toJSON() as PushSubscriptionJSON);
    invalidatePushSubscription();
    return true;
  } catch {
    return false;
  }
}

/** Saves the endpoint, and the zone that says whose clock the reminders are on. */
async function save(json: PushSubscriptionJSON) {
  const language = document.documentElement.lang === "en" ? "en" : "ar";
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({
      subscription: {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        language,
        timeZone: zone(),
      },
    }),
  });
  if (!res.ok) throw new Error("SAVE_FAILED");
}

/** Forgets the endpoint, so nothing is left sending to a browser nobody uses. */
async function unsubscribe(endpoint: string) {
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ endpoint }),
  });
}