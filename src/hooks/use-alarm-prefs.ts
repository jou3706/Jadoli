"use client";

import { useSyncExternalStore } from "react";
import {
  getAlarmPrefs,
  serverAlarmPrefs,
  subscribeAlarmPrefs,
  type AlarmPrefs,
} from "@/lib/alarm-prefs";

/** Live view of the device's alarm switches, so every control stays in step. */
export function useAlarmPrefs(): AlarmPrefs {
  return useSyncExternalStore(subscribeAlarmPrefs, getAlarmPrefs, serverAlarmPrefs);
}
