"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFilter } from "@/lib/db/store";
import { useAuth } from "@/lib/db/auth";
import type { SubjectEvent } from "@/lib/db/types";
import { SNOOZE_MINUTES, alarmAt, alarmKey, alarmWindow } from "@/lib/alarm";
import { todayISO } from "@/lib/subject-events";
import {
  emptyAlarmStore,
  isEligible,
  markFired,
  markSnoozed,
  msUntilNextWake,
  pruneAlarmStore,
  readAlarmStore,
  writeAlarmStore,
  type AlarmStore,
} from "@/lib/alarm-store";
import {
  Alarm,
  previewChime,
  soundSupported,
  soundUnlocked,
  stopVibration,
  unlockSound,
  vibrate,
} from "@/lib/alarm-sound";
import { notificationsEnabled, setAlarmPref, soundEnabled } from "@/lib/alarm-prefs";
import { isPushSubscribed, shouldNotifyInApp } from "@/lib/push-subscription";
import { useAlarmPrefs } from "@/hooks/use-alarm-prefs";

/**
 * Ringing for an event, and remembering that it already rang.
 *
 * The memory is the awkward part and it matters: an alarm that re-fires every
 * thirty seconds until the tab is closed is not an alarm, it is a punishment.
 * It also wakes for the right reason - the moment an alarm becomes true, or
 * the moment a snooze runs out - rather than on a timer that is always a bit
 * late for the thing it exists to prevent.
 *
 * Sound and notification are kept apart on purpose. One is heard and one is
 * seen, and neither needs the other's permission to do its job.
 */

export type RingingEvent = { event: SubjectEvent; at: number };

/** Long enough to catch a snooze ending, short enough to survive a clock change. */
const MAX_SLEEP = 15 * 60_000;

/**
 * Notification options the DOM types do not declare yet.
 *
 * `vibrate` and `renotify` are honoured by Chromium on Android, which is exactly
 * where an alarm has to be felt as well as seen - and a heads-up notification is
 * also the thing that makes an operating system light the screen.
 */
type AlarmNotification = NotificationOptions & {
  renotify?: boolean;
  vibrate?: number[];
};

export function useEventAlarms() {
  const { session } = useAuth();
  const who = session?.id ?? "";
  const prefs = useAlarmPrefs();
  // Only from today onwards. An alarm is never about a week that has already
  // happened, and asking for everything means that one person with a long
  // history fills the list with the past and quietly loses the next exam.
  const { data: events } = useFilter(
    "SubjectEvent",
    { date: { $gte: todayISO(new Date()) } },
    "date",
    500,
  );
  /**
   * Held still on purpose.
   *
   * A default `[]` is a new array on every render, and this list is a
   * dependency of the timer below: if it changed identity the timeout would be
   * thrown away and rebuilt once a second, and an alarm an hour away would
   * never arrive. It has to be the same array unless the data itself is new.
   */
  const list = useMemo(() => (events ?? []) as SubjectEvent[], [events]);

  const [ringing, setRinging] = useState<RingingEvent | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  // A sampled clock, so the countdown on the overlay moves without anything
  // else in the app re-rendering once a minute.
  const [clock, setClock] = useState(() => Date.now());

  const store = useRef<AlarmStore>(emptyAlarmStore());
  const alarm = useRef<Alarm | null>(null);

  if (alarm.current === null) alarm.current = new Alarm();

  const save = useCallback(
    (next: AlarmStore) => {
      store.current = next;
      if (who) writeAlarmStore(who, next);
    },
    [who],
  );

  // This account's memory, and nothing else account's.
  useEffect(() => {
    if (!who) {
      store.current = emptyAlarmStore();
      return;
    }
    const loaded = pruneAlarmStore(readAlarmStore(who), Date.now());
    store.current = loaded;
    writeAlarmStore(who, loaded);
  }, [who]);

  useEffect(() => {
    setUnlocked(soundUnlocked());
    // The switch survived the reload, but a browser still wants a gesture before
    // it makes noise. The first touch anywhere on the page is that gesture, so
    // an alarm turned on last time is heard this time without being re-asked.
    if (!soundEnabled()) return;
    const once = () => {
      void unlockSound().then((ok) => {
        if (ok) setUnlocked(true);
      });
      window.removeEventListener("pointerdown", once);
      window.removeEventListener("keydown", once);
    };
    window.addEventListener("pointerdown", once);
    window.addEventListener("keydown", once);
    return () => {
      window.removeEventListener("pointerdown", once);
      window.removeEventListener("keydown", once);
    };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  /** Ring for the next eligible event, or stay quiet. */
  const check = useCallback(
    async (now: Date) => {
      if (!who) return;
      const next = list.find((e) => isEligible(e, store.current, now));
      if (!next) return;
      save(markFired(store.current, next, now.getTime()));
      setRinging({ event: next, at: now.getTime() });

      alarm.current?.start();
      vibrate([400, 150, 400]);
      try {
        if (
          notificationsEnabled() &&
          "Notification" in window &&
          Notification.permission === "granted" &&
          shouldNotifyInApp(await isPushSubscribed())
        ) {
          const options: AlarmNotification = {
            body: [next.subject_key, next.start_time].filter(Boolean).join(" · "),
            tag: alarmKey(next),
            requireInteraction: true,
            renotify: true,
            silent: false,
            vibrate: [400, 150, 400, 150, 400],
          };
          new Notification(next.title, options);
        }
      } catch {
        /* a notification is a bonus, not the alarm */
      }
    },
    [who, list, save],
  );

  useEffect(() => {
    if (!who || !list.length) return;
    const now = new Date();
    check(now);
    const wait = msUntilNextWake(list, store.current, now);
    const delay =
      wait === null ? MAX_SLEEP : Math.min(Math.max(wait + 500, 1_000), MAX_SLEEP);
    const id = setTimeout(() => check(new Date()), delay);
    return () => clearTimeout(id);
  }, [who, list, check]);

  // Leaving the page mid-alarm should not leave the phone buzzing on a table.
  useEffect(() => {
    const stop = () => alarm.current?.stop();
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      stop();
      stopVibration();
    };
  }, []);

  /** An end, not a wait. */
  const stop = useCallback(() => {
    alarm.current?.stop();
    stopVibration();
    setRinging(null);
  }, []);

  /** A wait: the alarm is eligible again by itself once the time passes. */
  const snooze = useCallback(
    (minutes = SNOOZE_MINUTES) => {
      if (!ringing || !who) return;
      save(markSnoozed(store.current, ringing.event, Date.now() + minutes * 60_000));
      alarm.current?.stop();
      stopVibration();
      setRinging(null);
    },
    [ringing, who, save],
  );

  /** The tap that lets a browser make a sound at all. */
  const enableSound = useCallback(async () => {
    const ok = await unlockSound();
    if (ok) {
      setAlarmPref("sound", true);
      previewChime();
    }
    setUnlocked(ok);
    return ok;
  }, []);

  return {
    ringing,
    stop,
    snooze,
    enableSound,
    /** Sound is only "on" when the switch is on and the browser permits it. */
    unlocked: prefs.sound && unlocked,
    supported: soundSupported(),
    /** Sampled now, for a countdown that moves without re-rendering the app. */
    now: useMemo(() => new Date(clock), [clock]),
    /** When the next alarm opens, so a quiet app can still say what is coming. */
    next: useMemo(() => {
      const t = clock;
      const soonest = list
        .map((e) => alarmWindow(e, new Date(t)))
        .filter((w): w is NonNullable<typeof w> => !!w && w.at > t)
        .sort((a, b) => a.at - b.at)[0];
      return soonest ? soonest.at : null;
    }, [list, clock]),
    /** What a given event's reminder is, for the dialog's selector. */
    remindAt: (event: SubjectEvent) => alarmAt(event)?.getTime() ?? null,
  };
}
