"use client";

import { forwardRef } from "react";
import { Layers } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { HOURS, HOUR_START, HOUR_END, TABLE_DAYS, colorStyle, dayName, hourLabel } from "@/lib/constants";
import { lectureStatus, lectureTitle } from "@/lib/schedule";
import { cn, formatTime, toMinutes } from "@/lib/utils";
import type { Lecture, ReviewSession } from "@/lib/db/types";
import { SubjectEventsFor } from "@/components/subjects/subject-events-popover";

type Cell = { h: number; span: number; lecture: Lecture | null };

/** Packs a day's lectures into non-overlapping hour rows. */
function layoutDay(lectures: Lecture[], day: number): Cell[] {
  const dayLectures = lectures.filter((l) => Number(l.day) === day);
  // The header is a fixed 08:00-20:00 grid, but a lecture can start outside it
  // (a 07:00 lecture, or one exported at 20:30). Pin the start into the grid so
  // the row is drawn in the column it falls into instead of vanishing.
  const startSlot = (l: Lecture) =>
    Math.min(
      HOUR_END - 1,
      Math.max(HOUR_START, Math.floor(toMinutes(l.start_time) / 60)),
    );
  const rows: Cell[] = [];
  for (let h = HOUR_START; h < HOUR_END; ) {
    const match = dayLectures.find((l) => startSlot(l) === h);
    if (match) {
      const span = Math.max(
        1,
        Math.ceil(
          (toMinutes(match.end_time) - toMinutes(match.start_time)) / 60,
        ),
      );
      // Never spill past the final column: a lecture that runs past 20:00 is
      // clipped to the grid instead of widening the row beyond its header.
      const clipped = Math.min(span, HOUR_END - h);
      rows.push({ h, span: clipped, lecture: match });
      h += clipped;
    } else {
      rows.push({ h, span: 1, lecture: null });
      h += 1;
    }
  }
  return rows;
}

/**
 * A review sitting, drawn on the week.
 *
 * A session has a real date and a lecture has a weekday, so the two cannot be
 * the same kind of thing in the same grid: a lecture repeats every week, a
 * review sitting happens once. Rather than bend that, each session is drawn on
 * the date it belongs to and left off the other six days of the week - which is
 * also the honest picture, because a sitting from last Saturday is not this
 * Saturday's sitting.
 */
export function WeekReviewSessions({ sessions }: { sessions: ReviewSession[] }) {
  const { tr, lang } = useI18n();
  if (!sessions.length) return null;

  const byDay = new Map<number, ReviewSession[]>();
  for (const s of sessions) {
    const day = new Date(`${s.date}T00:00:00Z`).getUTCDay();
    const list = byDay.get(day) ?? [];
    list.push(s);
    byDay.set(day, list);
  }

  return (
    <>
      {TABLE_DAYS.filter((d) => byDay.has(d)).map((day) => (
        <tr key={day} className="border-t">
          <td className="p-1 ps-3 align-top">
            <span className="text-[11px] text-muted-foreground">
              {dayName(day, lang)}
            </span>
          </td>
          <td colSpan={HOURS.length} className="p-1">
            <ul className="flex flex-wrap gap-1.5">
              {(byDay.get(day) ?? []).map((s) => (
                <li key={s.id}>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border border-teal-500/40 bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium",
                      s.done && "opacity-50 line-through",
                    )}
                  >
                    <Layers className="h-3 w-3 text-teal-600 dark:text-teal-300" />
                    <span className="tabular-nums">
                      {formatTime(s.start_time)}
                    </span>
                    {s.subject_key && (
                      <span className="max-w-[10rem] truncate">
                        {s.subject_key}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ))}
      <tr className="sr-only">
        <td colSpan={HOURS.length + 1}>
          {tr("جلسات المراجعة", "Review sessions")}
        </td>
      </tr>
    </>
  );
}

export const WeekTable = forwardRef<
  HTMLTableElement,
  {
    lectures: Lecture[];
    now: Date;
    editMode?: boolean;
    openForm?: (l: Lecture | { day: number; start_time: string; end_time: string }) => void;
    /** Sittings to draw under the days they fall on. */
    sessions?: ReviewSession[];
  }
>(function WeekTable({ lectures, now, editMode = false, openForm, sessions = [] }, ref) {
  const { tr, lang } = useI18n();
  const today = now.getDay();

  return (
    <div className="overflow-x-auto rounded-2xl border bg-card scrollbar-thin" data-tour="week-grid">
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
                        <div className="relative z-10 mt-1 inline-flex">
                          <SubjectEventsFor subject={lecture.subject_name} />
                        </div>
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
          <WeekReviewSessions sessions={sessions} />
        </tbody>
      </table>
    </div>
  );
});
