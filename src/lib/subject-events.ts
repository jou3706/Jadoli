import type { SubjectEvent, SubjectEventKind } from "./db/types";

/**
 * Finding a course's events, and putting them in an order worth reading.
 *
 * Kept apart from the dialog and the tooltip so the rules can be tested without
 * a browser, and because "which events should this show" is a question both
 * places have to answer the same way - otherwise the schedule and the subjects
 * page disagree about what is due.
 */

export const EVENT_KINDS: { k: SubjectEventKind; ar: string; en: string; cls: string }[] = [
  {
    k: "quiz",
    ar: "كويز",
    en: "Quiz",
    cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  {
    k: "exam",
    ar: "امتحان",
    en: "Exam",
    cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  },
  {
    k: "assignment",
    ar: "تسليم",
    en: "Assignment",
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  {
    k: "other",
    ar: "حدث",
    en: "Event",
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
];

export const kindLabel = (kind: string, lang: "ar" | "en") => {
  const found = EVENT_KINDS.find((k) => k.k === kind);
  return found ? (lang === "en" ? found.en : found.ar) : lang === "en" ? "Event" : "حدث";
};

export const kindClass = (kind: string) =>
  EVENT_KINDS.find((k) => k.k === kind)?.cls ?? EVENT_KINDS[EVENT_KINDS.length - 1].cls;

/** Course names are matched the way the database matches them. */
export const sameSubject = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

/**
 * Every event on a course, soonest first.
 *
 * All of them, not just today's: the point of looking at a course is to find
 * out what is coming, and an exam three weeks out is exactly what you want to
 * see while deciding what to drop tonight. Ties break on the time, then on the
 * title, so the order does not shift between renders of the same data.
 */
export function eventsForSubject(events: SubjectEvent[], subject: string): SubjectEvent[] {
  return events
    .filter((e) => sameSubject(e.subject_key, subject))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        (a.start_time || "99:99").localeCompare(b.start_time || "99:99") ||
        a.title.localeCompare(b.title),
    );
}

/** Split into what is still ahead and what is behind, for a "next up" label. */
export function splitByToday(events: SubjectEvent[], today: string) {
  const upcoming = events.filter((e) => e.date >= today);
  const past = events.filter((e) => e.date < today);
  return { upcoming, past };
}

/** Whole days from today. Positive is ahead, negative is behind. */
export function daysUntil(date: string, today: string): number {
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((a - b) / 86_400_000);
}

/** Today's date in the `YYYY-MM-DD` shape the rows are stored in. */
export const todayISO = (now: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
};

/** Short "5 Oct" style date, in the app's two languages. */
export function shortDate(date: string, lang: "ar" | "en"): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString(lang === "en" ? "en-GB" : "ar-EG-u-nu-latn", {
    day: "numeric",
    month: "short",
  });
}

/**
 * How a countdown reads.
 *
 * "Today" and "Tomorrow" because those are the answers people actually want,
 * and a count of days is only useful before it stops being small.
 */
export function countdownLabel(
  date: string,
  today: string,
  lang: "ar" | "en",
): string {
  const n = daysUntil(date, today);
  if (n === 0) return lang === "en" ? "today" : "النهارده";
  if (n === 1) return lang === "en" ? "tomorrow" : "بكرة";
  if (n === -1) return lang === "en" ? "yesterday" : "إمبارح";
  if (n < 0) return lang === "en" ? `${-n}d ago` : `منذ ${-n} يوم`;
  if (n < 30) return lang === "en" ? `in ${n}d` : `بعد ${n} يوم`;
  return shortDate(date, lang);
}

/**
 * A course name for a row that may not be filed under one.
 *
 * A blank `subject_key` means the event was added before the course had a
 * name to file it under. Grouping it under "" keeps it visible on the page
 * rather than hiding it, which is the safer way to lose a row.
 */
export const eventSubjectName = (subjectKey: string) => subjectKey.trim();

/**
 * Whether the server refused the row because it is already there.
 *
 * The database guards against the same quiz being added twice, which is the
 * right call, and it makes the offline retry safe. But the honest answer to
 * "you already added this" arrives as a raw Postgres complaint, and that should
 * not be the sentence a person has to read.
 */
export const isDuplicateEvent = (err: unknown) =>
  /duplicate key|23505|already exists|conflict/i.test(
    err instanceof Error ? err.message : String(err),
  );