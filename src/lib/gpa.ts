import { GRADE_SCALE } from "./constants";
import type { Grade } from "./db/types";

/**
 * What a grade does to the average.
 *
 * The GPA page can add up what already happened. What a student actually asks,
 * usually in the middle of a term and usually out loud, is the other question:
 * what does one more course do to it. That is the whole of this file — the same
 * weighted average, asked about a grade that has not been earned yet.
 */

export type GpaTotals = { gpa: number; points: number; hours: number };

const hoursOf = (g: Grade) => Number(g.credit_hours) || 0;
const pointsOf = (g: Grade) => hoursOf(g) * (Number(g.grade_point) || 0);

/** The cumulative average over every graded course. */
export function gpaTotals(grades: Grade[]): GpaTotals {
  let points = 0;
  let hours = 0;
  for (const g of grades) {
    points += pointsOf(g);
    hours += hoursOf(g);
  }
  return { gpa: hours ? points / hours : 0, points, hours };
}

/** The points a letter is worth, 0 for anything not on the scale. */
export const pointsFor = (letter: string): number =>
  GRADE_SCALE.find((g) => g.l === letter)?.p ?? 0;

/**
 * The average if one course of `hours` came out as `letter`.
 *
 * Hours with no grade are counted as unearned rather than skipped: the
 * denominator is every hour the student is registered for, so a course left
 * blank drags the average down the same way an F would.
 */
export function gpaWith(
  grades: Grade[],
  hours: number,
  letter: string,
): number {
  const t = gpaTotals(grades);
  const h = Number(hours) || 0;
  const totalHours = t.hours + h;
  if (totalHours <= 0) return 0;
  return (t.points + h * pointsFor(letter)) / totalHours;
}

export type NeededGrade = {
  letter: string;
  points: number;
  /** The average this grade produces, which clears the target. */
  gpa: number;
  /** Null when even an A cannot reach the target. */
  reachable: boolean;
};

/**
 * The lowest grade in one course that still leaves the average at or above
 * `target`.
 *
 * Answering this the other way round — trying every letter and taking the best
 * one — is what the scale is for, and it keeps the answer honest at the edges:
 * a target above what the remaining hours allow comes back unreachable rather
 * than as a promise.
 */
export function gradeNeeded(
  grades: Grade[],
  hours: number,
  target: number,
): NeededGrade | null {
  const h = Number(hours) || 0;
  if (h <= 0) return null;
  const t = gpaTotals(grades);
  const wanted = target * (t.hours + h) - t.points;

  // Best first, so an unreachable target is found before a worse grade is
  // accepted as good enough.
  for (const { l, p } of [...GRADE_SCALE].reverse()) {
    if (h * p + 1e-9 >= wanted) {
      return { letter: l, points: p, gpa: (t.points + h * p) / (t.hours + h), reachable: true };
    }
  }
  const best = GRADE_SCALE[GRADE_SCALE.length - 1].p;
  return {
    letter: GRADE_SCALE[0].l,
    points: best,
    gpa: (t.points + h * best) / (t.hours + h),
    reachable: false,
  };
}