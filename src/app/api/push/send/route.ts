import { NextResponse } from "next/server";
import webpush from "web-push";
import {
  forgetSubscription,
  isGoneStatus,
  markDelivered,
  remindersFor,
  secretMatches,
  serviceClient,
  touchSubscription,
  vapidKeys,
  type StoredSubscription,
} from "@/lib/push-server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The minute-accurate sender, called by `supabase/09-push-subscriptions.sql`.
 *
 * Deliberately not a route a browser can usefully call: it is guarded by the
 * shared secret in a header, because the caller is a database job that cannot
 * hold a session. Nothing here is idempotent per browser, so an open route would
 * be a way to send every subscriber's reminders at once, repeatedly, to anyone
 * who found it.
 *
 * The shape of a run: for each subscription, work out what that reader owes from
 * their own zone, send it, and write down what went out. Subscriptions the push
 * service reports as gone are deleted in the same pass, because a row that can
 * never be delivered to is a row that costs a lookup every minute forever.
 */
export async function POST(req: Request) {
  if (!secretMatches(req.headers.get("x-cron-secret"), process.env.PUSH_CRON_SECRET)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const keys = vapidKeys();
  if (!keys) {
    return NextResponse.json(
      { error: "VAPID keys are not set on this deployment" },
      { status: 503 },
    );
  }

  let sb: ReturnType<typeof serviceClient>;
  try {
    sb = serviceClient();
  } catch {
    return NextResponse.json({ error: "Backend not configured" }, { status: 503 });
  }

  webpush.setVapidDetails(
    process.env.NEXT_PUBLIC_SITE_URL || "mailto:jadwali@example.com",
    keys.publicKey,
    keys.privateKey,
  );

  const now = new Date();
  const { data: subs, error } = await sb
    .from("push_subscriptions")
    .select("id,user_id,endpoint,p256dh,auth,language,time_zone")
    .limit(1000);
  if (error) {
    return NextResponse.json({ error: `Could not read subscriptions: ${error.message}` }, { status: 502 });
  }

  const summary = { subscriptions: 0, sent: 0, failed: 0, removed: 0, reminders: 0 };

  for (const row of (subs ?? []) as unknown as StoredSubscription[]) {
    summary.subscriptions += 1;

    let reminders;
    try {
      reminders = await remindersFor(sb, row, now);
    } catch {
      // One reader's broken row must not stop everyone else's reminders going
      // out on this tick. It is reported and the next tick tries again.
      summary.failed += 1;
      continue;
    }

    if (reminders.length === 0) continue;
    summary.reminders += reminders.length;

    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    };
    const sentKeys: string[] = [];
    let live = true;

    for (const reminder of reminders) {
      try {
        await webpush.sendNotification(
          subscription,
          JSON.stringify({
            title: reminder.title,
            body: reminder.body,
            tag: reminder.tag,
            url: reminder.url,
            eventId: reminder.eventId,
          }),
          { TTL: 3600 },
        );
        summary.sent += 1;
sentKeys.push(reminder.key);
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode ?? 0;
        if (isGoneStatus(status)) {
          // The endpoint is dead: cleared in the browser, or the profile gone.
          await forgetSubscription(sb, row.id);
          summary.removed += 1;
          live = false;
          break;
        }
        // A 429 or a 5xx is the push service having a moment. Leave the row
        // alone: this reminder simply goes out on a later tick, and the ledger
        // still says it has not been sent.
        summary.failed += 1;
      }
    }

    if (live && sentKeys.length) {
      try {
        await markDelivered(sb, row.user_id, sentKeys);
        await touchSubscription(sb, row.id);
      } catch {
        // The push went out but the ledger did not, so the next tick would send
        // it again. The tag makes that a replacement in the tray rather than a
        // second notification, which is the survivable version of this bug.
        summary.failed += 1;
      }
    }
  }

  return NextResponse.json(summary);
}
