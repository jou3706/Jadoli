"use client";

import { useMemo } from "react";
import { useFilter, useMutate } from "@/lib/db/store";
import { dayDate, isoDate, weekStartKey } from "@/lib/utils";
import type { Attendance, Lecture } from "@/lib/db/types";

/**
 * Attendance for the current Egyptian week. Toggling creates or deletes the
 * record for the lecture's occurrence in this week.
 */
export function useAttendance(now: Date) {
  const weekStart = useMemo(() => weekStartKey(now), [now]);
  const { data } = useFilter("Attendance", { week_start: weekStart }, undefined, 500, [
    weekStart,
  ]);
  const { create, remove } = useMutate("Attendance");
  const records: Attendance[] = data ?? [];

  return {
    records,
    isAttended: (l: Lecture) =>
      records.some((r) => r.lecture_id === l.id),
    toggle: (l: Lecture) => {
      const existing = records.find((r) => r.lecture_id === l.id);
      if (existing) return remove(existing.id);
      return create({
        lecture_id: l.id,
        date: isoDate(dayDate(Number(l.day), now)),
        week_start: weekStart,
      });
    },
  };
}
