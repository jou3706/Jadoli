"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toMinutes } from "@/lib/utils";
import type { Lecture } from "@/lib/db/types";

type PermissionState = "unsupported" | NotificationPermission | "denied";

/**
 * Fires a browser notification ~10 minutes before each lecture. Only the first
 * lecture of a session is announced; re-mounting the app won't re-notify.
 */
export function useNotifications(
  lectures: Lecture[],
  now: Date,
): {
  supported: boolean;
  permission: PermissionState;
  requestPermission: () => void;
} {
  const [permission, setPermission] = useState<PermissionState>("unsupported");
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (permission !== "granted" || !lectures.length) return;
    const today = now.getDay();
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
        new Notification(l.subject_name, {
          body: `${l.hall || ""} · ${l.start_time} – ${l.end_time}`,
          tag: key,
        });
      } catch {
        /* notification failed silently — not critical */
      }
    }
  }, [lectures, now, permission]);

  const requestPermission = useCallback(async () => {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result);
  }, []);

  return {
    supported: permission !== "unsupported",
    permission,
    requestPermission,
  };
}
