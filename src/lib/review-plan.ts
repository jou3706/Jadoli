import {
  CARDS_PER_SESSION,
  SESSION_MINUTES,
  freeSlots,
  minutesToTime,
  upcomingDays,
  type BusyRange,
  type PlanDay,
} from "./gaps";
import { toMinutes } from "./utils";
import type { SrsCard } from "./srs";
import { isDue } from "./srs";
import type { ReviewSession } from "./db/types";

/**
 * Putting review sessions into the holes in a week.
 *
 * The order of the work matters more than the work itself, so this is written
 * as a planner and not as a function that saves anything: it reads what is due
 * and what is already booked, and returns what it would add. Nothing is written
 * until a person says yes, because a planner that edits your week by itself is
 * not a planner.
 */

/**
 * What a sitting with no course is called, when it has to be put in a list next
 * to courses that have names. Not written to the database: a session belongs to
 * no course, and an empty column says that in the one language both can read.
 */
export const NO_SUBJECT = "—";

/** A session that has been worked out but not yet agreed to. */
export type SessionProposal = {
  date: string;
  day: number;
  start_time: string;
  end_time: string;
  subject_key: string;
  /** How many due cards this sitting would take on. */
  card_count: number;
};

export type PlanInput = {
  /** Today's date, `YYYY-MM-DD`. */
  today: string;
  /** Everything in the queue, not only the due part: the summary needs the rest. */
  cards: SrsCard[];
  /** Lectures for each weekday, keyed 0 (Sunday) to 6 (Saturday). */
  lecturesByDay: Record<number, BusyRange[]>;
  /** Sessions already on the calendar, so a proposal never lands on one. */
  booked: (PlanDay & BusyRange)[];
  /** How many days ahead to look. */
  days?: number;
  /** How long one sitting lasts. */
  sessionMinutes?: number;
  /** The most sittings to add in one day. */
  maxPerDay?: number;
  /** Days a session may start no earlier than. */
  dayStart?: string;
  dayEnd?: string;
  /** The smallest hole worth sitting in. */
  minSlotMinutes?: number;
};

/**
 * Works out where the sessions should go.
 *
 * Soonest day first, and inside a day the earliest hole first: the queue is
 * longest when it is oldest, so the sessions nearest now are the ones that
 * actually shorten it.
 *
 * One sitting takes as many cards as it can from the course with the most due,
 * because a session that mixes six courses is six warm-ups. Cards past what one
 * sitting holds are left for the next hole, and the counts add up to the number
 * of cards that were due.
 */
export function planReviewSessions(input: PlanInput): SessionProposal[] {
  const {
    today,
    cards,
    lecturesByDay,
    booked,
    days = 7,
    sessionMinutes = SESSION_MINUTES,
    maxPerDay = 2,
    dayStart,
    dayEnd,
    minSlotMinutes,
  } = input;

  /** What is still waiting, per course, oldest first. */
  const queues = new Map<string, number>();
  for (const card of cards) {
    if (!isDue(card, today)) continue;
    const key = (card.subject_key ?? "").trim() || NO_SUBJECT;
    queues.set(key, (queues.get(key) ?? 0) + 1);
  }

  const proposals: SessionProposal[] = [];
  if (queues.size === 0) return proposals;

  for (const { date, day } of upcomingDays(today, days)) {
    let placed = 0;
    if (placed >= maxPerDay) continue;

    /**
     * Everything this day is already busy with. Added to as the day fills up, so
     * two sittings in one day are planned around each other rather than on top
     * of each other.
     */
    const busy: BusyRange[] = [
      ...(lecturesByDay[day] ?? []),
      ...booked
        .filter((b) => b.date === date)
        .map((b) => ({ start_time: b.start_time, end_time: b.end_time })),
    ];

    for (;;) {
      if (placed >= maxPerDay) break;
      const slots = freeSlots(busy, {
        ...(dayStart ? { start: dayStart } : {}),
        ...(dayEnd ? { end: dayEnd } : {}),
        ...(minSlotMinutes ? { minMinutes: minSlotMinutes } : {}),
      });
      const slot = slots.find((s) => s.minutes >= sessionMinutes);
      if (!slot) break;

      const subject = hungriest(queues);
      if (!subject) break;
      const held = queues.get(subject) ?? 0;
      const cardCount = Math.min(held, CARDS_PER_SESSION);
      queues.set(subject, held - cardCount);

      const from = toMinutes(slot.start);
      proposals.push({
        date,
        day,
        start_time: slot.start,
        end_time: minutesToTime(from + sessionMinutes),
        subject_key: subject,
        card_count: cardCount,
      });
      busy.push({ start_time: slot.start, end_time: minutesToTime(from + sessionMinutes) });
      placed += 1;
    }
  }

  return proposals;
}

/** The course with the most cards waiting, alphabetically first on a tie. */
const hungriest = (queues: Map<string, number>): string | null => {
  let best: string | null = null;
  let bestCount = 0;
  for (const [subject, count] of queues) {
    if (count <= 0) continue;
    if (best === null || count > bestCount || (count === bestCount && subject < best)) {
      best = subject;
      bestCount = count;
    }
  }
  return best;
};

/**
 * What a set of proposals is worth, and what it would take.
 *
 * Shown before anything is saved, because the only useful question about a
 * plan is "is this worth the time it takes", and that is arithmetic.
 */
export function proposalTotals(proposals: SessionProposal[]) {
  const minutes = proposals.reduce(
    (sum, p) => sum + (toMinutes(p.end_time) - toMinutes(p.start_time)),
    0,
  );
  return {
    sessions: proposals.length,
    minutes,
    cards: proposals.reduce((sum, p) => sum + p.card_count, 0),
    days: new Set(proposals.map((p) => p.date)).size,
  };
}

/**
 * The row an agreed proposal becomes.
 *
 * The dash that stands in for "no course" goes back to being nothing on the way
 * in, and the row is marked as the planner's so the page can tell a sitting it
 * proposed from one somebody placed by hand.
 */
export function proposalToRow(p: SessionProposal): Partial<ReviewSession> {
  return {
    date: p.date,
    start_time: p.start_time,
    end_time: p.end_time,
    subject_key: p.subject_key === NO_SUBJECT ? "" : p.subject_key,
    card_count: p.card_count,
    source: "auto",
    done: false,
  };
}

/** Anything in the timetable, reduced to what a busy range needs. */
export type WeekdayRange = { day: number; start_time: string; end_time: string };

/**
 * Lectures grouped by the weekday they happen on.
 *
 * The planner asks "what is free on Tuesday", and asking it that way means the
 * day a session lands on is worked out in one place instead of once per call
 * site.
 */
export function busyByWeekday(
  lectures: WeekdayRange[],
): Record<number, BusyRange[]> {
  const byDay: Record<number, BusyRange[]> = {};
  for (const lecture of lectures) {
    const day = Number(lecture.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    if (!lecture.start_time || !lecture.end_time) continue;
    (byDay[day] ??= []).push({
      start_time: lecture.start_time,
      end_time: lecture.end_time,
    });
  }
  return byDay;
}