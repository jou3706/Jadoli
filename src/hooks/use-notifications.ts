"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { toMinutes } from "@/lib/utils";
import { notificationsEnabled, setAlarmPref } from "@/lib/alarm-prefs";
import { useAlarmPrefs } from "@/hooks/use-alarm-prefs";
import type { Lecture } from "@/lib/db/types";

type PermissionState = "unsupported" | NotificationPermission;

/** The day a reminder was sent, per lecture, so a reload does not repeat it. */
const NOTIFIED_KEY = "jadoli:lecture-notified";

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

const readNotified = (today: string): Set<string> => {
  try {
    const raw = localStorage.getItem(NOTIFIED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Record<string, string>;
    return new Set(
      Object.entries(parsed)
        .filter(([, day]) => day === today)
        .map(([key]) => key),
    );
  } catch {
    return new Set();
  }
};

const writeNotified = (keys: Set<string>, today: string): void => {
  try {
    const parsed: Record<string, string> = {};
    for (const key of keys) parsed[key] = today;
    localStorage.setItem(NOTIFIED_KEY, JSON.stringify(parsed));
  } catch {
    /* private mode: repeats at worst, which is harmless */
  }
};

/**
 * `vibrate` is honoured by Chromium on Android - the place where a reminder has
 * to be felt as well as seen - but the DOM types do not declare it.
 */
type ReminderNotification = NotificationOptions & { vibrate?: number[] };

/**
 * The bell in the header: a real switch, with a memory.
 *
 * Turning it on asks the browser for permission, says so, and shows one
 * notification immediately - because a control whose effect is never seen might
 * as well not work. Turning it off stops reminders. The switch is remembered,
 * and so is every lecture it has already announced, so a reload does not
 * announce the same lecture twice.
 */
export function useNotifications(
  lectures: Lecture[],
  now: Date,
): {
  supported: boolean;
  permission: PermissionState;
  enabled: boolean;
  toggle: () => void;
} {
  const { tr } = useI18n();
  const toast = useToast();
  const { notifications: enabled } = useAlarmPrefs();
  const [permission, setPermission] = useState<PermissionState>("unsupported");
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
    notified.current = readNotified(dayKey(new Date()));
  }, []);

  useEffect(() => {
    if (!enabled || permission !== "granted" || !lectures.length) return;
    const today = now.getDay();
    const todayStamp = dayKey(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();

    for (const l of lectures) {
      if (Number(l.day) !== today) continue;
      const start = toMinutes(l.start_time);
      const delta = start - nowMin;
      if (delta < 0 || delta > 10) continue;
      const key = `${l.id}:${l.start_time}`;
      if (notified.current.has(key)) continue;
      notified.current.add(key);
      try {
        const reminder: ReminderNotification = {
          body: `${l.hall || ""} · ${l.start_time} – ${l.end_time}`,
          tag: key,
          silent: false,
          vibrate: [200, 100, 200],
        };
        new Notification(l.subject_name, reminder);
      } catch {
        /* notification failed silently — not critical */
      }
    }
    writeNotified(notified.current, todayStamp);
  }, [lectures, now, permission, enabled]);

  const toggle = useCallback(async () => {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      toast({
        title: tr("المتصفح مانع الإشعارات", "The browser is blocking notifications"),
        description: tr(
          "فعّل الإشعارات من إعدادات الموقع في المتصفح.",
          "Allow notifications for this site in your browser settings.",
        ),
        variant: "destructive",
      });
      return;
    }
    if (notificationsEnabled()) {
      setAlarmPref("notifications", false);
      toast({ title: tr("قفلنا الإشعارات", "Notifications are off") });
      return;
    }
    let perm: NotificationPermission = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
      setPermission(perm);
    }
    if (perm !== "granted") return;
    setAlarmPref("notifications", true);
    try {
      new Notification(tr("إشعارات جدولي شغالة", "Jadwali notifications are on"), {
        body: tr(
          "هنفكّرك قبل المحاضرات ومنبّهات الامتحانات.",
          "We'll remind you before lectures and exam alarms.",
        ),
        tag: "jadoli-notifications-on",
      });
    } catch {
      /* the switch is still on; the sample just did not show */
    }
  }, [tr, toast]);

  return {
    supported: permission !== "unsupported",
    permission,
    enabled,
    toggle: () => void toggle(),
  };
}
