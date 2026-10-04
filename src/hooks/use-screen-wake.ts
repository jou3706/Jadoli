"use client";

import { useEffect } from "react";
import { useAlarmPrefs } from "@/hooks/use-alarm-prefs";
import { holdScreenAwake, wakeSupported } from "@/lib/screen-wake";

/**
 * Keeps the screen lit while the app is open and the switch is on.
 *
 * Returns whether the browser can do this at all, so the header can show the
 * control only where it would mean something.
 */
export function useScreenWake(): boolean {
  const { wake } = useAlarmPrefs();

  useEffect(() => {
    if (!wake || !wakeSupported()) return;
    return holdScreenAwake();
  }, [wake]);

  return wakeSupported();
}
