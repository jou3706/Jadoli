import type { SubjectEvent } from "./db/types";
import { alarmAt, alarmKey, alarmWindow } from "./alarm";

/**
 * What an alarm has already done, remembered between reloads.
 *
 * Kept out of the hook so the rules can be tested without a browser, and out of
 * the database because this is about one device, not one account's data: it
 * says nothing that would be wrong on another phone, and it must never travel
 * between accounts or end up in an export.
 *
 * Keyed by account, not by device, so two people on one laptop do not inherit
 * each other's alarms.
 */

const NS = "jadwali_alarms";

export type AlarmStore = {
  /** When each alarm last rang. */
  fired: Record<string, number>;
  /** When each snoozed alarm becomes eligible again. */
  snoozed: Record<string, number>;
};

export const emptyAlarmStore = (): AlarmStore => ({ fired: {}, snoozed: {} });

export const readAlarmStore = (who: string): AlarmStore => {
  try {
    const raw = localStorage.getItem(`${NS}:${who}`);
    if (!raw) return emptyAlarmStore();
    const parsed = JSON.parse(raw) as Partial<AlarmStore>;
    // A record that is not a map of times is not a record at all; reading it
    // as one would make every alarm look like it had already fired.
    const times = (o: unknown): Record<string, number> => {
      if (!o || typeof o !== "object") return {};
      const kept = Object.entries(o as Record<string, unknown>).filter(
        ([, v]) => typeof v === "number" && Number.isFinite(v),
      ) as [string, number][];
      return Object.fromEntries(kept);
    };
    return { fired: times(parsed.fired), snoozed: times(parsed.snoozed) };
  } catch {
    return emptyAlarmStore();
  }
};

export const writeAlarmStore = (who: string, store: AlarmStore) => {
  try {
    localStorage.setItem(`${NS}:${who}`, JSON.stringify(store));
  } catch {
    /* a disk that is full is not a reason to ring twice */
  }
};

/** Forget the past, so last week's alarms cannot shape today. */
export function pruneAlarmStore(store: AlarmStore, now: number, keepMs = 14 * 86_400_000): AlarmStore {
  const keep = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).filter(([, at]) => at > now - keepMs));
  return { fired: keep(store.fired), snoozed: keep(store.snoozed) };
}

/**
 * Whether this event should ring right now.
 *
 * Three ways to be stopped, and they are not the same: an alarm that already
 * rang, one that was asked to wait, and one whose moment has not come. A snooze
 * that has run out stops being one, on its own, because it is only ever
 * compared against the current time.
 */
export const isEligible = (event: SubjectEvent, store: AlarmStore, now: Date): boolean => {
  const key = alarmKey(event);
  if (store.fired[key]) return false;
  const until = store.snoozed[key];
  if (until && until > now.getTime()) return false;
  return alarmWindow(event, now) !== null;
};

/**
 * When to wake up next, in milliseconds.
 *
 * Both reasons to wake, whichever is sooner: an alarm about to become true,
 * and a snooze about to run out. An alarm that only woke when something became
 * due would never notice a snooze ending, and would sit silent through it.
 */
export function msUntilNextWake(
  events: SubjectEvent[],
  store: AlarmStore,
  now: Date,
): number | null {
  const t = now.getTime();
  let soonest: number | null = null;
  const consider = (at: number) => {
    if (at <= t) return;
    if (soonest === null || at < soonest) soonest = at;
  };

  for (const e of events) {
    if (store.fired[alarmKey(e)]) continue;
    const window = alarmWindow(e, now);
    const snoozedUntil = store.snoozed[alarmKey(e)];
    if (window) {
      // Already inside its window, so it should have rung. If it did not, the
      // only thing left to wait for is a snooze running out - and skipping that
      // here is how a snooze turns into a silence.
      if (snoozedUntil) consider(snoozedUntil);
      continue;
    }
    if (snoozedUntil) consider(snoozedUntil);
    else {
      // Not in its window yet, so the moment it opens is what to wait for.
      const opens = alarmAt(e)?.getTime();
      if (opens !== undefined && opens !== null) consider(opens);
    }
  }
  return soonest === null ? null : soonest - t;
};

/** Record that an alarm rang, so it does not ring again. */
export const markFired = (store: AlarmStore, event: SubjectEvent, at: number): AlarmStore => ({
  fired: { ...store.fired, [alarmKey(event)]: at },
  snoozed: { ...store.snoozed },
});

/**
 * Ask for a wait instead of an end.
 *
 * The fired record is cleared and the snooze is what holds it back, so when the
 * wait runs out on its own the alarm is eligible again with nothing else to
 * tidy up afterwards.
 */
export const markSnoozed = (
  store: AlarmStore,
  event: SubjectEvent,
  until: number,
): AlarmStore => {
  const { [alarmKey(event)]: _gone, ...fired } = store.fired;
  return { fired, snoozed: { ...store.snoozed, [alarmKey(event)]: until } };
};
