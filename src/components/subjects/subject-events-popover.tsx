"use client";

import { useId, useMemo, useState } from "react";
import { CalendarClock, MapPin } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useList } from "@/lib/db/store";
import { cn, formatTime } from "@/lib/utils";
import {
  countdownLabel,
  eventsForSubject,
  kindClass,
  kindLabel,
  shortDate,
  splitByToday,
  todayISO,
} from "@/lib/subject-events";
import type { SubjectEvent } from "@/lib/db/types";

/**
 * What is due on a course, revealed on hover.
 *
 * Every event for the course, not only today's: the question behind a hover is
 * "what is coming for this", and an exam three weeks out is exactly what you
 * want to know while deciding what to drop tonight.
 *
 * Opens on hover or on tap, because a hover that cannot be reached by touch or
 * by keyboard is a hover that does not exist for half the people using the app.
 */

function EventLine({ event, today }: { event: SubjectEvent; today: string }) {
  const { lang } = useI18n();

  return (
    <li className="flex items-start gap-2">
      <span
        className={cn(
          "mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold",
          kindClass(event.kind),
        )}
      >
        {kindLabel(event.kind, lang)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{event.title}</span>
        <span className="ms-1.5 text-[11px] text-muted-foreground">
          {shortDate(event.date, lang)} · {countdownLabel(event.date, today, lang)}
        </span>
        {(event.start_time || event.hall) && (
          <span className="ms-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            {event.start_time && (
              <span className="tabular-nums">
                {formatTime(event.start_time)}
                {event.end_time && `–${formatTime(event.end_time)}`}
              </span>
            )}
            {event.hall && (
              <span className="inline-flex items-center gap-0.5">
                <MapPin className="h-2.5 w-2.5" />
                {event.hall}
              </span>
            )}
          </span>
        )}
      </span>
    </li>
  );
}

export function SubjectEventsPopover({
  events,
  className,
}: {
  events: SubjectEvent[];
  className?: string;
}) {
  const { tr, lang } = useI18n();
  const today = todayISO(new Date());
  const [open, setOpen] = useState(false);
  const panelId = useId();

  // The split and the order come from one place, so this panel and the subjects
  // page cannot end up calling the same week different things.
  const { upcoming, past } = useMemo(() => splitByToday(events, today), [events, today]);

  // Nothing to say is better than an empty box: a course with nothing due looks
  // exactly as it did before this existed.
  if (!events.length) return null;

  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // Closing on blur would shut the panel the moment the keyboard moved to
      // the finished-events list inside it, so only a focus that has genuinely
      // left counts as leaving.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        aria-label={tr(`أحداث المادة (${events.length})`, `Course events (${events.length})`)}
        className={cn(
          "inline-flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-bold transition-colors",
          upcoming.length
            ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
            : "bg-muted text-muted-foreground",
          "hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          className,
        )}
      >
        <CalendarClock className="h-3 w-3" />
        {events.length}
      </button>

      {open && (
        <div
          id={panelId}
          role="tooltip"
          className="absolute bottom-full start-1/2 z-50 mb-2 w-max max-w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border bg-popover p-2.5 text-start text-xs shadow-lg rtl:translate-x-[50%]"
        >
          <div className="mb-1.5 font-bold">{tr("أحداث المادة", "Course events")}</div>
          {upcoming.length > 0 && (
            <ul className="space-y-1.5">
              {upcoming.map((e) => (
                <EventLine key={e.id} event={e} today={today} />
              ))}
            </ul>
          )}
          {past.length > 0 && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[11px] text-muted-foreground">
                {tr(`اتنهى (${past.length})`, `Finished (${past.length})`)}
              </summary>
              <ul className="mt-1.5 space-y-1.5 opacity-70">
                {past.map((e) => (
                  <EventLine key={e.id} event={e} today={today} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Reads the course's events itself, so a caller only has to name the course.
 *
 * Reading them here rather than passing them in means the schedule and the
 * subjects page cannot disagree: one query, one match rule.
 */
export function SubjectEventsFor({ subject }: { subject: string }) {
  const { data: all = [] } = useList("SubjectEvent", "date", 500);
  const events = useMemo(() => eventsForSubject(all, subject), [all, subject]);
  return <SubjectEventsPopover events={events} />;
}