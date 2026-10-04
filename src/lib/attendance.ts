import type { Attendance, Lecture } from "./db/types";
import { weekStartKey } from "./utils";

/**
 * The line a course's attendance has to stay above.
 *
 * Egyptian universities block a student from sitting an exam below a percentage
 * of delivered sessions, and the number written on the wall is almost always
 * 75. So this is a stated rule rather than a target: a percentage is only worth
 * showing next to the number it is measured against.
 */
export const ATTENDANCE_THRESHOLD = 0.75;

/** How close to the line is close enough to mention. */
const WATCH_MARGIN = 0.1;

export type AttendanceRisk = "safe" | "watch" | "risk";

export type CourseAttendance = {
  /** The course name, which is what every other table keys on. */
  subjectKey: string;
  attended: number;
  /** Every session that has happened and could have been marked. */
  chances: number;
  pct: number;
  /** Distance from the threshold, as a fraction. Negative when below it. */
  margin: number;
  /**
   * How many more sessions can be missed and still finish at or above the
   * threshold, assuming every other one is attended. Negative when the course
   * is already under the line.
   */
  allowance: number;
  risk: AttendanceRisk;
};

/**
 * The weeks on record, oldest first.
 *
 * The current week is always one of them even when nothing has been marked in
 * it: a session that has already happened and carries no record is an absence,
 * so the week has to count as a chance whether or not it says anything.
 * A later week never does — it has not happened yet.
 */
export function trackedWeeks(records: Attendance[], thisWeek: string): string[] {
  const seen = new Set<string>([thisWeek]);
  for (const r of records) if (r.week_start && r.week_start <= thisWeek) seen.add(r.week_start);
  return [...seen].sort();
}

/**
 * How many chances one weekly session has had to be attended.
 *
 * An absence is a session with no record, so the number of chances cannot be
 * counted from the records alone — it is every tracked week since the lecture
 * was added to the timetable.
 */
export function lectureChances(lecture: Lecture, weeks: string[], fallback = weeks[0]): number {
  const since = lecture.created_date
    ? weekStartKey(new Date(lecture.created_date))
    : fallback;
  return weeks.filter((w) => w >= since).length;
}

const riskOf = (margin: number): AttendanceRisk =>
  margin <= 0 ? "risk" : margin < WATCH_MARGIN ? "watch" : "safe";

/**
 * Every course in the timetable, with its rate and what that rate allows.
 *
 * Answering "can I skip this lecture" is a per-course question, not a per-lecture
 * one: the morning section and the afternoon section of the same course are two
 * chances between them, and the allowance only means anything once they are added
 * together.
 *
 * Sorted worst first, because the course that is about to block you is the only
 * one worth opening this page for. A course with no tracked session yet is left
 * out: there is no rate to judge, and a row of zeroes reads as a warning rather
 * than as an absence of information.
 */
export function attendanceByCourse(
  lectures: Lecture[],
  records: Attendance[],
  thisWeek: string,
  threshold = ATTENDANCE_THRESHOLD,
): CourseAttendance[] {
  const weeks = trackedWeeks(records, thisWeek);

  // A repeat of the same session in one week is one attendance, not two.
  const attendedWeeks = new Map<string, Set<string>>();
  for (const r of records) {
    const id = r.lecture_id;
    if (!id) continue;
    let set = attendedWeeks.get(id);
    if (!set) attendedWeeks.set(id, (set = new Set()));
    set.add(r.week_start ?? r.date);
  }

  const byCourse = new Map<string, { attended: number; chances: number }>();
  for (const lecture of lectures) {
    const key = (lecture.subject_name ?? "").trim();
    if (!key) continue;
    const chances = lectureChances(lecture, weeks);
    const attended = attendedWeeks.get(lecture.id)?.size ?? 0;
    const row = byCourse.get(key) ?? { attended: 0, chances: 0 };
    row.attended += attended;
    row.chances += chances;
    byCourse.set(key, row);
  }

  return [...byCourse.entries()]
    .map(([subjectKey, { attended, chances }]) => {
      const pct = chances ? attended / chances : 0;
      const margin = pct - threshold;
      return {
        subjectKey,
        attended,
        chances,
        pct,
        margin,
        // After k more misses the rate is attended / (chances + k), which has to
        // stay at or above the threshold; that is the whole of the allowance.
        allowance: Math.floor((attended - threshold * chances) / threshold),
        risk: riskOf(margin),
      };
    })
    .filter((c) => c.chances > 0)
    .sort((a, b) => a.pct - b.pct || a.subjectKey.localeCompare(b.subjectKey, "ar"));
}