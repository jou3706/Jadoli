import { pad2, toMinutes } from "./utils";

/**
 * The free time in a day, and the days that have some.
 *
 * A student's week is mostly lectures, and what is useful is not the timetable
 * but the holes in it: an hour between two lectures is the same hour every week,
 * and it is where a review session belongs. So this works in minutes of the day
 * and says nothing about weeks, because a repeating timetable has no weeks in
 * it - the same is true of the answer.
 */

/** Anything with a start and an end, which is a lecture and also a review session. */
export type BusyRange = { start_time: string; end_time: string };

export type FreeSlot = {
  /** `HH:MM` */
  start: string;
  /** `HH:MM` */
  end: string;
  minutes: number;
};

/**
 * When a day is a day.
 *
 * Eight in the morning to ten at night: the edges of a day for someone who has
 * lectures. A review session planned for 06:30 is a plan nobody keeps, and one
 * planned for midnight is worse.
 */
export const DAY_START = "08:00";
export const DAY_END = "22:00";

/** Below this it is not a session, it is a gap between two things. */
export const MIN_SLOT_MINUTES = 20;

/** How long a sitting is meant to be: short enough to actually happen. */
export const SESSION_MINUTES = 25;

/** How many cards fit in one sitting. Roughly a minute each, with room to think. */
export const CARDS_PER_SESSION = 20;

/** 510 -> "08:30" */
export const minutesToTime = (minutes: number) =>
  `${pad2(Math.floor(minutes / 60) % 24)}:${pad2(minutes % 60)}`;

type Span = { from: number; to: number };

/**
 * The free slots in a day, soonest first.
 *
 * Busy ranges are clipped to the day, merged where they touch, and subtracted in
 * one pass. Two lectures that overlap do not leave a hole between them, which
 * is the whole reason this merges instead of filtering: a timetable with a
 * clash in it is common enough that planning against the clash as if it were
 * free time is not a small mistake.
 *
 * A range that ends before it starts is ignored rather than allowed to run
 * backwards through the day.
 */
export function freeSlots(
  busy: BusyRange[],
  opts: { start?: string; end?: string; minMinutes?: number } = {},
): FreeSlot[] {
  const dayFrom = toMinutes(opts.start ?? DAY_START);
  const dayTo = toMinutes(opts.end ?? DAY_END);
  const min = opts.minMinutes ?? MIN_SLOT_MINUTES;
  if (dayTo <= dayFrom) return [];

  const spans: Span[] = [];
  for (const range of busy) {
    const from = toMinutes(range?.start_time ?? "");
    const to = toMinutes(range?.end_time ?? "");
    if (Number.isNaN(from) || Number.isNaN(to) || to <= from) continue;
    // Outside the day the planner is looking at, before clipping. Clipping first
    // would turn "an evening class after the day ends" into a range that ends
    // before it starts, and a backwards range then hands the planner an evening
    // of free time it does not have.
    if (to <= dayFrom || from >= dayTo) continue;
    spans.push({ from: Math.max(from, dayFrom), to: Math.min(to, dayTo) });
  }
  // Merged, not just sorted: touching ranges become one busy block.
  spans.sort((a, b) => a.from - b.from);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ ...span });
  }

  const free: { from: number; to: number }[] = [];
  let cursor = dayFrom;
  for (const span of merged) {
    if (span.from > cursor) {
      free.push({ from: cursor, to: span.from });
    }
    cursor = Math.max(cursor, span.to);
  }
  if (cursor < dayTo) free.push({ from: cursor, to: dayTo });

  return free
    .filter((s) => s.to - s.from >= min)
    .map((s) => ({
      start: minutesToTime(s.from),
      end: minutesToTime(s.to),
      minutes: s.to - s.from,
    }));
}

/** Whether two things on the same day are on top of each other. */
export const overlaps = (
  a: BusyRange | null | undefined,
  b: BusyRange | null | undefined,
): boolean => {
  if (!a || !b) return false;
  const aFrom = toMinutes(a.start_time);
  const bFrom = toMinutes(b.start_time);
  const aTo = toMinutes(a.end_time);
  const bTo = toMinutes(b.end_time);
  if ([aFrom, aTo, bFrom, bTo].some(Number.isNaN)) return false;
  if (aTo <= aFrom || bTo <= bFrom) return false;
  return aFrom < bTo && bFrom < aTo;
};

/** One calendar day, with the weekday number the timetable uses (0 = Sunday). */
export type PlanDay = { date: string; day: number };

/**
 * The next `count` days, today first.
 *
 * The weekday comes from the date rather than from `Date.getDay()`, because a
 * date at midnight UTC is the same weekday in Cairo and a lecture at 09:00 on
 * Sunday has to land on the Sunday the student is living in.
 */
export function upcomingDays(today: string, count: number): PlanDay[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => {
    const date = addUtcDays(today, i);
    return { date, day: new Date(`${date}T00:00:00Z`).getUTCDay() };
  });
}

function addUtcDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return date;
  const d = new Date(t);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}