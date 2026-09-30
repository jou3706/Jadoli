"use client";

import { forwardRef } from "react";
import { useI18n } from "@/lib/i18n";
import { HOURS, TABLE_DAYS, colorStyle, dayName, hourLabel } from "@/lib/constants";
import { lectureStatus, lectureTitle } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { toMinutes } from "@/lib/utils";
import type { Lecture } from "@/lib/db/types";

type Cell = { h: number; span: number; lecture: Lecture | null };

/** Packs a day's lectures into non-overlapping hour rows. */
function layoutDay(lectures: Lecture[], day: number): Cell[] {
  const dayLectures = lectures.filter((l) => Number(l.day) === day);
  const rows: Cell[] = [];
  for (let h = 8; h < 20; ) {
    const match = dayLectures.find(
      (l) => Math.floor(toMinutes(l.start_time) / 60) === h,
    );
    if (match) {
      const span = Math.max(
        1,
        Math.ceil(
          (toMinutes(match.end_time) - toMinutes(match.start_time)) / 60,
        ),
      );
      rows.push({ h, span, lecture: match });
      h += span;
    } else {
      rows.push({ h, span: 1, lecture: null });
      h += 1;
    }
  }
  return rows;
}

export const WeekTable = forwardRef<
  HTMLTableElement,
  {
    lectures: Lecture[];
    now: Date;
    editMode?: boolean;
    openForm?: (l: Lecture | { day: number; start_time: string; end_time: string }) => void;
  }
>(function WeekTable({ lectures, now, editMode = false, openForm }, ref) {
  const { tr, lang } = useI18n();
  const today = now.getDay();

  return (
    <div className="overflow-x-auto rounded-2xl border bg-card scrollbar-thin">
      <table
        ref={ref}
        className="w-full min-w-[1100px] table-fixed border-collapse text-sm"
      >
        <thead>
          <tr className="bg-muted/60">
            <th className="w-24 p-3 text-start font-heading">
              {tr("اليوم", "Day")}
            </th>
            {HOURS.map((h) => (
              <th
                key={h}
                className="p-3 font-heading font-bold text-muted-foreground"
              >
                {hourLabel(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TABLE_DAYS.map((day) => {
            const isToday = day === today;
            return (
              <tr key={day} className={cn("border-t", isToday && "bg-primary/10")}>
                <td className="p-3 font-heading text-base font-bold">
                  <div className="flex items-center gap-2">
                    <span>{dayName(day, lang)}</span>
                    {isToday && (
                      <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                        {tr("اليوم", "Today")}
                      </span>
                    )}
                  </div>
                </td>

                {layoutDay(lectures, day).map(({ h, span, lecture }) => {
                  if (!lecture) {
                    return (
                      <td key={h} className="p-1">
                        {editMode && openForm && (
                          <button
                            type="button"
                            onClick={() =>
                              openForm({
                                day,
                                start_time: `${String(h).padStart(2, "0")}:00`,
                                end_time: `${String(h + 1).padStart(2, "0")}:00`,
                              })
                            }
                            className="h-20 w-full rounded-lg border border-dashed border-primary/40 text-lg text-primary hover:bg-primary/5"
                          >
                            +
                          </button>
                        )}
                      </td>
                    );
                  }

                  const c = colorStyle(lecture.color);
                  const live = lectureStatus(lecture, now) === "live";

                  return (
                    <td key={h} colSpan={span} className="p-1">
                      <button
                        type="button"
                        onClick={() => editMode && openForm?.(lecture)}
                        className={cn(
                          "h-20 w-full rounded-lg border-s-4 p-2 text-start",
                          c.soft,
                          c.bar,
                          c.text,
                          live && "ring-2 ring-emerald-600",
                          isToday && !live && "ring-2 ring-primary/70",
                          editMode
                            ? "cursor-pointer border border-dashed"
                            : "cursor-default",
                        )}
                      >
                        <p className="line-clamp-1 font-bold">
                          {lectureTitle(lecture, lang)}
                        </p>
                        <p className="line-clamp-1 text-xs opacity-80">
                          {lecture.hall}
                        </p>
                        <p className="line-clamp-1 text-xs opacity-80">
                          {lecture.doctor}
                        </p>
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
});
