/**
 * One change event for every backend.
 *
 * A write has to tell the running app about itself, otherwise the list on
 * screen keeps showing the rows from before the write and the only way to see
 * the change is a manual refresh. `store.ts` listens for the event and re-runs
 * every mounted `useQuery`; the backends fire it once the write has landed.
 */
export const CHANGE_EVENT = "jadoli:db";

/** Re-read every mounted list. Safe to call on the server (it does nothing). */
export function notifyDataChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}
