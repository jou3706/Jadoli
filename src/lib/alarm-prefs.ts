/**
 * The two on/off switches for the alarm, remembered per device.
 *
 * One store, read by the alarm hook, the header bell and the sound button, so
 * they all agree and a reload brings the same answer back. Sound and
 * notifications are separate switches on purpose: they are different
 * permissions, and a person may well want one without the other.
 *
 * The default is OFF. A browser will not make a sound until a gesture has asked
 * it to, so "off until asked" is the only honest starting point - and it means
 * pressing the button is what turns the channel on, once and then for good.
 */

export type AlarmPrefs = {
  /** Play the alarm sound. */
  sound: boolean;
  /** Show browser notifications. */
  notifications: boolean;
  /** Hold the screen awake so an alarm that comes is an alarm that is seen. */
  wake: boolean;
};

const KEY = "jadoli:alarm-prefs";

const OFF: AlarmPrefs = { sound: false, notifications: false, wake: false };

/**
 * Cached, and deliberately so: `useSyncExternalStore` compares the snapshot by
 * identity, so parsing localStorage on every call would re-render forever.
 */
let cache: AlarmPrefs | null = null;
const listeners = new Set<() => void>();

const read = (): AlarmPrefs => {
  if (cache) return cache;
  let next = OFF;
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AlarmPrefs>;
      next = {
        sound: parsed.sound === true,
        notifications: parsed.notifications === true,
        wake: parsed.wake === true,
      };
    }
  } catch {
    next = OFF;
  }
  cache = next;
  return cache;
};

export const getAlarmPrefs = (): AlarmPrefs => read();

export const soundEnabled = (): boolean => read().sound;
export const notificationsEnabled = (): boolean => read().notifications;

export const setAlarmPref = (key: keyof AlarmPrefs, on: boolean): void => {
  cache = { ...read(), [key]: on };
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode: the switch still works for this session, which is honest */
  }
  for (const listener of listeners) listener();
};

export const subscribeAlarmPrefs = (onChange: () => void): (() => void) => {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
};

/** The server has no preference to read, so it renders the default. */
export const serverAlarmPrefs = (): AlarmPrefs => OFF;

/** Only for tests: forget the cache so each case starts clean. */
export const resetAlarmPrefs = (): void => {
  cache = null;
  listeners.clear();
};
