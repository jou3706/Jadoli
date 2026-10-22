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
 * So exactly one of them owns the notification, and which one is decided by
 * where the student is standing:
 *
 *  - The page is in front of them: the page owns it. The worker stands down
 *    while the page is awake (see `reportAlarmsLive`), because the page's own
 *    alarm is the sticky one and it is already on the screen.
 *  - The page is in the background, or there is no page: the push owns it,
 *    because a notification raised by a hidden tab is a notification nobody
 *    looks at.
 *  - There is no push subscription at all: the page owns it whatever else is
 *    true, because there is nobody else to say anything.
 *
 * The rule used to be "a browser with a push never needs the page to shout".
 * That handed the notification to a channel that does not always answer: the
 * delivery job is a database cron, and while it is not running, a phone with a
 * working subscription heard the alarm's sound and saw nothing at all.
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
 * Pure, so the rule can be read without a browser:
 *
 *  - The page is in front of the student, so it says something. The worker
 *    stands down while the page is awake, so this is the only notification.
 *  - There is no push subscription, so the page is the only thing that can say
 *    anything - whether it is in front or not.
 *
 * The sound and the ring overlay are unaffected either way - both are what the
 * student is actually looking at, and neither survives the tab closing.
 */
export const shouldNotifyInApp = ({
  visible,
  subscribed,
}: {
  /** Whether this page is the one in front of the student right now. */
  visible: boolean;
  /** Whether this browser can be reached with a push. */
  subscribed: boolean;
}): boolean => visible || !subscribed;

/**
 * Tell the worker that this page is awake and ringing its own alarms.
 *
 * The worker uses this to decide whether a push should raise a notification or
 * step aside for the page. It has to be a claim the page keeps renewing rather
 * than a one-off message: a page that has been closed, crashed or backgrounded
 * must not silence the push, or a reminder would arrive to nobody.
 */
export const reportAlarmsLive = () => {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => {
      const worker = reg.active ?? navigator.serviceWorker.controller;
      worker?.postMessage({ type: "jadwali:alarms-live" });
    })
    .catch(() => undefined);
};