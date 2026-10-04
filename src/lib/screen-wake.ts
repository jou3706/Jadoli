/**
 * Keeping the screen awake, so an alarm that is due is an alarm that is seen.
 *
 * A browser grants a screen wake lock only while the page is visible, and drops
 * it the moment the tab is hidden - so this takes a fresh one every time the app
 * comes back to the foreground. Nothing here can turn a screen that is already
 * off back on; that is the operating system's job, and no web page can ask for
 * it. What this can do is stop the screen from going off in the first place.
 */

type Sentinel = { released: boolean; release: () => Promise<void> };
type WakeLockNavigator = {
  wakeLock?: { request: (type: "screen") => Promise<Sentinel> };
};

/** Whether this browser has the Screen Wake Lock API at all. */
export const wakeSupported = (): boolean =>
  typeof navigator !== "undefined" && !!(navigator as unknown as WakeLockNavigator).wakeLock;

/**
 * Starts holding the screen awake and returns the way to let it go.
 *
 * The returned function is safe to call more than once. Re-acquisition on
 * `visibilitychange` is the whole trick: without it, switching tabs once would
 * silently end the hold for good.
 */
export function holdScreenAwake(): () => void {
  const api = (navigator as unknown as WakeLockNavigator).wakeLock;
  if (!api) return () => {};

  let sentinel: Sentinel | null = null;
  let stopped = false;

  const acquire = async () => {
    if (stopped) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (sentinel && !sentinel.released) return;
    try {
      sentinel = await api.request("screen");
    } catch {
      /* refused, or the page is not focused: there is nothing more to try */
    }
  };

  const onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      void acquire();
    }
  };

  void acquire();
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  return () => {
    stopped = true;
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
    if (sentinel && !sentinel.released) {
      void sentinel.release().catch(() => {});
    }
    sentinel = null;
  };
}
