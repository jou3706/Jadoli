import type { SubjectEvent } from "./db/types";

/**
 * When an alarm should go off, and when it should stop being offered.
 *
 * Two separate moments, and the difference is the whole design:
 *
 * - the alarm moment is when the reminder becomes true: the event's own start
 *   time minus how far ahead the person asked to be told.
 * - the give-up moment is the event's start plus a grace period, because an
 *   alarm that fires three hours after the exam started is not a reminder, it
 *   is an insult.
 *
 * Times are read as the wall clock on this device, never as UTC. The row holds
 * a civil date and "09:00" with no zone, and "09:00" means nine in the morning
 * where the person is standing.
 */

export const DEFAULT_REMIND_MINUTES = 60;

/** How far ahead a person can pick to be told. */
export const REMIND_CHOICES = [
  { min: 0, ar: "في الوقت", en: "At the time" },
  { min: 10, ar: "قبل 10 د", en: "10 min before" },
  { min: 30, ar: "قبل نص ساعة", en: "30 min before" },
  { min: 60, ar: "قبل ساعة", en: "1 hour before" },
  { min: 180, ar: "قبل 3 ساعات", en: "3 hours before" },
  { min: 1440, ar: "قبل يوم", en: "1 day before" },
] as const;

/** The choices a person is offered, plus whatever they set by hand. */
export const remindChoices = (current: number) => {
  if (REMIND_CHOICES.some((c) => c.min === current)) return REMIND_CHOICES;
  return [...REMIND_CHOICES, { min: current, ar: `${current} د`, en: `${current} min` }];
};

/** How long after the start it is still worth ringing. */
export const ALARM_GRACE_MINUTES = 30;

/** `YYYY-MM-DD` plus `HH:MM` on this device's clock, as a real instant. */
export function eventStart(event: Pick<SubjectEvent, "date" | "start_time">): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(event.date ?? "");
  if (!m) return null;
  const [, y, mo, d] = m;
  // No time means the day itself. Midday, not midnight: an exam with no hour
  // set is somewhere in the day, and treating it as 00:00 makes it ring at
  // midnight the night before.
  const [hh, mm] = /^(\d{1,2}):(\d{2})$/.exec(event.start_time ?? "")?.slice(1).map(Number) ?? [12, 0];
  const at = new Date(Number(y), Number(mo) - 1, Number(d), hh, mm, 0, 0);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Minutes before the start that this event asks for, falling back to an hour. */
export const remindMinutesOf = (event: Pick<SubjectEvent, "remind_minutes">) =>
  Number.isFinite(event.remind_minutes) && event.remind_minutes >= 0
    ? Math.floor(event.remind_minutes)
    : DEFAULT_REMIND_MINUTES;

/** The instant the alarm should start for this event. */
export function alarmAt(event: Pick<SubjectEvent, "date" | "start_time" | "remind_minutes">): Date | null {
  const start = eventStart(event);
  if (!start) return null;
  return new Date(start.getTime() - remindMinutesOf(event) * 60_000);
}

/**
 * Whether this event should be ringing right now.
 *
 * Two ways in, and both are wanted. The normal one is the moment arriving. The
 * other is arriving late: someone opening the app five minutes before an exam
 * with an hour's warning should still be told, because the warning is true now
 * even though they missed the moment it was scheduled for.
 */
export function alarmWindow(
  event: Pick<SubjectEvent, "date" | "start_time" | "remind_minutes">,
  now: Date,
  graceMinutes = ALARM_GRACE_MINUTES,
): { start: number; at: number; until: number } | null {
  const start = eventStart(event);
  const at = alarmAt(event);
  if (!start || !at) return null;
  const t = now.getTime();
  const from = at.getTime();
  const until = start.getTime() + graceMinutes * 60_000;
  if (t < from || t > until) return null;
  return { start: start.getTime(), at: from, until };
}

/** Every event whose alarm is true right now, soonest first. */
export const dueAlarms = (events: SubjectEvent[], now: Date) =>
  events
    .map((e) => ({ event: e, ...(alarmWindow(e, now) ?? {}) }))
    .filter((x): x is { event: SubjectEvent; start: number; at: number; until: number } =>
      x.start !== undefined,
    )
    .sort((a, b) => a.at - b.at)
    .map((x) => x.event);

/**
 * Milliseconds until the next alarm worth waiting for, or null when nothing is
 * coming. Used to sleep exactly as long as the wait, instead of waking up every
 * few seconds to be told the same thing.
 */
export function msUntilNextAlarm(
  events: SubjectEvent[],
  now: Date,
): number | null {
  let soonest: number | null = null;
  for (const e of events) {
    const at = alarmAt(e);
    if (!at) continue;
    const t = at.getTime();
    if (t <= now.getTime()) continue;
    if (soonest === null || t < soonest) soonest = t;
  }
  return soonest === null ? null : soonest - now.getTime();
}

/**
 * Identity of one ringing, stored to keep it from ringing twice.
 *
 * The time is part of it on purpose: moving an exam to an hour later should
 * let it ring again, and an alarm that refused to do so would be wrong in the
 * direction that matters.
 */
export const alarmKey = (e: Pick<SubjectEvent, "id" | "date" | "start_time">) =>
  `${e.id}:${e.date}:${e.start_time}`;

/** How long "later" means. */
export const SNOOZE_MINUTES = 10;
