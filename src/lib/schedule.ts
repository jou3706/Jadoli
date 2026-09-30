import { dayName, dayShort, type Lang } from "./constants";
import { toMinutes } from "./utils";
import type { Lecture } from "./db/types";

/** Best display name for a lecture, honouring the active language. */
export function lectureTitle(l?: Lecture | null, lang: Lang = "ar"): string {
  if (!l) return "";
  if (lang === "en" && l.subject_en) return l.subject_en;
  return l.subject_name ?? "";
}

/** Secondary line under the title: the other language's name, if any. */
export function lectureSubtitle(l?: Lecture | null, lang: Lang = "ar") {
  if (!l) return null;
  return lang === "en" ? l.subject_name || null : l.subject_en || null;
}

export function lectureKindLabel(kind: string, lang: Lang) {
  if (lang === "en") return kind === "section" ? "Section" : "Lecture";
  return kind === "section" ? "تمارين" : "محاضرة";
}

/** Egyptian teaching week order: Saturday(6) → Thursday(4). */
const weekOrder = (day: number) => (day + 1) % 7;

/** Sorts lectures by Egyptian week order, then by start time. */
export function sortByWeek(lectures: Lecture[]): Lecture[] {
  return [...lectures].sort(
    (a, b) =>
      weekOrder(a.day) - weekOrder(b.day) ||
      toMinutes(a.start_time) - toMinutes(b.start_time),
  );
}

/** Case/diacritic-insensitive-ish search across the fields students search by. */
export function searchLectures(lectures: Lecture[], term?: string) {
  const q = (term ?? "").trim().toLowerCase();
  if (!q) return lectures;
  return lectures.filter((l) =>
    [l.subject_name, l.subject_en, l.doctor, l.code, l.hall].some((f) =>
      (f ?? "").toLowerCase().includes(q),
    ),
  );
}

export type NextResult = {
  lecture: Lecture;
  status: "live" | "next";
  seconds: number;
} | null;

/**
 * Finds the lecture happening right now, else the soonest upcoming one,
 * measured on a 7-day cycle so it always returns something.
 */
export function findNext(
  lectures: Lecture[],
  now: Date,
): NextResult {
  const nowMin =
    now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const WEEK = 7 * 1440;
  let best: { lecture: Lecture; diff: number } | null = null;

  for (const l of lectures) {
    const start = l.day * 1440 + toMinutes(l.start_time);
    const end = l.day * 1440 + toMinutes(l.end_time);
    if (nowMin >= start && nowMin < end) {
      return {
        lecture: l,
        status: "live",
        seconds: Math.round((end - nowMin) * 60),
      };
    }
    const diff = ((start - nowMin) % WEEK + WEEK) % WEEK;
    if (!best || diff < best.diff) best = { lecture: l, diff };
  }

  return best
    ? { lecture: best.lecture, status: "next", seconds: Math.round(best.diff * 60) }
    : null;
}

export type LectureStatus = "past" | "live" | "upcoming" | null;

/** Status of a lecture relative to now, but only for today's day. */
export function lectureStatus(l: Lecture, now: Date): LectureStatus {
  if (Number(l.day) !== now.getDay()) return null;
  const min = now.getHours() * 60 + now.getMinutes();
  if (min >= toMinutes(l.end_time)) return "past";
  if (min >= toMinutes(l.start_time)) return "live";
  return "upcoming";
}

/** Lectures on the same day that overlap the given window. */
export function findConflicts(
  lectures: Lecture[],
  draft: { day?: number; start_time?: string; end_time?: string },
  excludeId?: string,
): Lecture[] {
  if (draft.day == null || !draft.start_time || !draft.end_time) return [];
  const s = toMinutes(draft.start_time);
  const e = toMinutes(draft.end_time);
  if (e <= s) return [];
  return lectures.filter(
    (l) =>
      l.id !== excludeId &&
      Number(l.day) === Number(draft.day) &&
      s < toMinutes(l.end_time) &&
      toMinutes(l.start_time) < e,
  );
}

export function dayLabel(id: number, lang: Lang, long = false) {
  return long ? dayName(id, lang) : dayShort(id, lang);
}

/** Lectures grouped by subject name, ordered by week then time. */
export function groupBySubject(lectures: Lecture[]) {
  return Object.values(
    sortByWeek(lectures).reduce<Record<string, Lecture[]>>((acc, l) => {
      (acc[l.subject_name] ||= []).push(l);
      return acc;
    }, {}),
  );
}

/**
 * The subject names already in the schedule, each with the details of one of
 * its lectures.
 *
 * Picking a subject in the new-lecture form should not mean retyping the code,
 * the doctor and the hall every time: a course keeps those, and only the day
 * and the time change between its sessions. The most recent lecture wins,
 * because that is the one whose details were last corrected.
 */
export function subjectCatalogue(lectures: Lecture[]) {
  const byName = new Map<string, Lecture>();
  for (const l of sortByWeek(lectures)) {
    if (l.subject_name) byName.set(l.subject_name, l);
  }
  return [...byName.values()].sort((a, b) => a.subject_name.localeCompare(b.subject_name, "ar"));
}

/** The fields a subject carries from one session to the next. */
export type SubjectDetails = Pick<
  Lecture,
  "subject_en" | "code" | "doctor" | "hall" | "kind" | "color" | "department"
>;

/** The keys copied across, listed rather than read off the source. */
const SUBJECT_DETAIL_KEYS: (keyof SubjectDetails)[] = [
  "subject_en",
  "code",
  "doctor",
  "hall",
  "kind",
  "color",
  "department",
];

/**
 * Fills the details of a subject into a draft, leaving the fields that make a
 * session different - the day, the times and the notes - as the user set them.
 * A blank value on the source lecture is skipped so an empty box never wipes
 * what was already typed.
 */
export function applySubjectDetails<T extends Record<string, unknown>>(
  draft: T,
  source?: SubjectDetails | null,
): T {
  if (!source) return draft;
  const next: Record<string, unknown> = { ...draft };
  // Only the listed keys. Walking the source object instead would drag the
  // source's own day and times along and undo what the user just entered.
  for (const key of SUBJECT_DETAIL_KEYS) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) next[key] = value;
  }
  return next as T;
}
