/**
 * Does this browser answer its own alarms, or does the server have to?
 *
 * Both paths ring for the same event - the page while it is open, the push job
 * while it is closed - and for a while they both raised a notification, under
 * the same tag, so whichever arrived second replaced the first. The visible
 * symptom was small but real: the in-app alarm asks for `requireInteraction`, so
 * it stays on the screen until it is dismissed, and a push landing up to a
 * minute later quietly replaced it with one that times out on its own.
 *
 * So one of them owns the notification and the other keeps only the parts a push
 * cannot do. Which one is not a race and not a guess: a browser that holds a
 * working subscription is a browser whose alarms will be delivered whether or not
 * the tab is open, and a browser without one has nothing but this page.
 */

let cached: boolean | null = null;

/**
 * Whether this browser has a push subscription, asked once per page load.
 *
 * `getSubscription` touches the browser's own storage, and `check` runs on a
 * timer that is rebuilt on every data change - asking each time would mean a
 * storage round trip on every tick. Cached, and cleared by whoever changes the
 * answer: see `invalidatePushSubscription`.
 */
export async function isPushSubscribed(): Promise<boolean> {
  if (cached !== null) return cached;
  cached = await read();
  return cached;
}

async function read(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    return Boolean(await reg.pushManager.getSubscription());
  } catch {
    // No worker yet, or no storage access. Treated as "not subscribed", which is
    // the answer that keeps the page's own notification working.
    return false;
  }
}

/**
 * Called after the switch is turned on or off, so the next alarm asks again
 * rather than believing the answer from before the click.
 */
export const invalidatePushSubscription = () => {
  cached = null;
};

/**
 * Whether the page should raise its own notification for an alarm.
 *
 * Pure, so the rule can be read without a browser: a browser that can be reached
 * with a push does not need the page to shout, and one that cannot has nothing
 * else. The sound and the ring overlay are unaffected either way - both are what
 * the student is actually looking at, and neither survives the tab closing.
 */
export const shouldNotifyInApp = (subscribed: boolean) => !subscribed;