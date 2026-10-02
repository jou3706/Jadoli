import { pad2 } from "./utils";

/**
 * Spaced repetition: when a card should be shown again, and how that changes
 * when it is graded.
 *
 * Deliberately the small version of SM-2. The full algorithm has a learning
 * queue, an intraday scheduler and a dozen knobs, and every one of them is a
 * thing a student has to understand before the thing is any use. What is kept
 * here is the part that does the work: a card that is forgotten comes back the
 * same day, and a card that is remembered comes back later and later.
 *
 * Days, not seconds. A student cannot use a card at "three past the epoch", and
 * a review queue that turns over within the hour is a queue that gets skipped.
 * Dates are civil `YYYY-MM-DD`, the same shape every other date in the app is
 * stored in, so nothing here has to know about UTC.
 */

export type ReviewGrade = "again" | "hard" | "good" | "easy";

/** The four answers a person can give, in the order they get worse. */
export const REVIEW_GRADES: {
  id: ReviewGrade;
  ar: string;
  en: string;
  cls: string;
}[] = [
  { id: "again", ar: "نسيت", en: "Again", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  { id: "hard", ar: "صعب", en: "Hard", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  { id: "good", ar: "كويس", en: "Good", cls: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  { id: "easy", ar: "سهل", en: "Easy", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
];

/** How each answer moves the interval. Read once, then the maths is small. */
const EASE_START = 2.5;
const EASE_MIN = 1.3;
const EASE_MAX = 2.8;
const EASE_DELTA: Record<ReviewGrade, number> = {
  again: -0.2,
  hard: -0.15,
  good: 0,
  easy: 0.15,
};

/** Past a year the answer stops being about the course. */
export const MAX_INTERVAL_DAYS = 365;

/** A card's whole memory: everything here changes the next time it is shown. */
export type SrsState = {
  /** Days until it is asked again. 0 means "again today". */
  interval_days: number;
  /** How reliably it is remembered, and how fast the interval may grow. */
  ease: number;
  /** How many times it has been remembered. */
  reps: number;
  /** How many times it was forgotten after being remembered. */
  lapses: number;
  /** `YYYY-MM-DD` it is next asked for. */
  due_date: string;
  /**
   * `YYYY-MM-DD` it was last graded, null when never.
   *
   * Null and not "" because the column is a real date and the database is right
   * about this: "never" is not a day, it is the absence of one.
   */
  last_review: string | null;
};

/** A card, as far as the scheduler is concerned. */
/**
 * A card, as far as the scheduler is concerned.
 *
 * The scheduling fields plus enough of the row to ask it and label it. The
 * question and the answer are there because anything that shows a card has to
 * read both, and a type that left them out would push that cast into the
 * components - where it would be forgotten the first time a new one was added.
 */
export type SrsCard = SrsState & {
  id: string;
  subject_key: string;
  question: string;
  answer: string;
  created_date: string;
};

const clampEase = (ease: number) =>
  Math.min(EASE_MAX, Math.max(EASE_MIN, Math.round(ease * 100) / 100));

/**
 * A date `days` from another, as a date.
 *
 * Done in UTC deliberately. Adding a day in the device's own zone is where a
 * card jumps to the day before across a daylight-saving boundary, and a review
 * queue that goes backwards is worse than one that is a day out.
 */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) return date;
  const d = new Date(t);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Whole days from `today` to `date`; negative is behind. */
export function daysBetween(date: string, today: string): number {
  const a = Date.parse(`${date}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((a - b) / 86_400_000);
}

/** A card that has never been seen, and so is asked for today. */
export const newCardState = (today: string): SrsState => ({
  interval_days: 0,
  ease: EASE_START,
  reps: 0,
  lapses: 0,
  due_date: today,
  last_review: null,
});

/**
 * Whether it is time to ask.
 *
 * A date that cannot be read counts as due. That is the safe way round: a card
 * that is asked once too often is a few seconds lost, and a card that is never
 * asked because its date was mangled is a fact nobody revised again.
 */
export const isDue = (card: Pick<SrsState, "due_date">, today: string) => {
  const due_date = (card.due_date ?? "").trim();
  if (!due_date) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date)) return true;
  return due_date <= today;
};

/**
 * The next interval for an answer.
 *
 * Four answers, four shapes:
 *
 * - forgotten: back to today. This is the only answer that does not move the
 *   card forward, and it lowers the ease so the card grows more slowly next
 *   time even when it is remembered again.
 * - hard: a short step up. Someone who found this difficult should see it
 *   again soon, or they will find it difficult again.
 * - good: the normal one, a day for a new card, then three, then whatever the
 *   card's own ease says.
 * - easy: further out, and the ease goes up, because a card that is easy is
 *   one that can be asked less and forgotten less.
 */
export function nextInterval(
  state: Pick<SrsState, "interval_days" | "ease">,
  grade: ReviewGrade,
): number {
  const interval_days = Math.max(0, Number(state.interval_days) || 0);
  const ease = clampEase(Number(state.ease) || EASE_START);
  switch (grade) {
    case "again":
      return 0;
    case "hard":
      return clampInterval(interval_days === 0 ? 1 : interval_days * 1.2);
    case "good":
      return clampInterval(interval_days === 0 ? 1 : interval_days === 1 ? 3 : interval_days * ease);
    case "easy":
      return clampInterval(interval_days === 0 ? 3 : interval_days * ease * 1.35);
  }
}

const clampInterval = (days: number) =>
  Math.max(1, Math.min(MAX_INTERVAL_DAYS, Math.round(days)));

/** A graded answer, turned into the card's next memory. */
export function gradeCard(
  state: SrsState,
  grade: ReviewGrade,
  today: string,
): SrsState {
  const interval_days = nextInterval(state, grade);
  return {
    interval_days,
    ease: clampEase((Number(state.ease) || EASE_START) + EASE_DELTA[grade]),
    // A forgotten card has not been remembered a second time, so `reps` stays
    // put while `lapses` records why it came back.
    reps: grade === "again" ? state.reps : state.reps + 1,
    lapses: grade === "again" ? state.lapses + 1 : state.lapses,
    due_date: addDays(today, interval_days),
    last_review: today,
  };
}

/** What each answer would do, for the labels under the buttons. */
export const previewGrades = (state: SrsState, today: string) =>
  REVIEW_GRADES.map((g) => {
    const next = gradeCard(state, g.id, today);
    return { ...g, due_date: next.due_date, interval_days: next.interval_days };
  });

/** "in 6 days", in the app's two languages. */
export function dueLabel(due_date: string, today: string, lang: "ar" | "en"): string {
  const n = daysBetween(due_date, today);
  if (n <= 0) return lang === "en" ? "today" : "النهارده";
  if (n === 1) return lang === "en" ? "tomorrow" : "بكرة";
  if (n < 30) return lang === "en" ? `in ${n} days` : `بعد ${n} يوم`;
  const months = Math.round(n / 30);
  return lang === "en" ? `in ${months} months` : `بعد ${months} شهر`;
}

/** A card is young until it has survived a few real intervals. */
export const MATURE_INTERVAL_DAYS = 21;

export type SrsSummary = {
  total: number;
  /** Asked for today or earlier. A count, unlike the card's own `due_date`. */
  due: number;
  /** Never seen. */
  fresh: number;
  /** Seen, but not yet a long-term memory. */
  young: number;
  mature: number;
  /** Per course, for the list that says where the work is. */
  bySubject: { subject_key: string; due: number; total: number }[];
};

/**
 * What there is to do today, and where.
 *
 * The due count is taken once per card, and the subject split adds up to it, so
 * the numbers on the page cannot quietly disagree with each other.
 */
export function summarise(cards: SrsCard[], today: string): SrsSummary {
  const bySubject = new Map<string, { due: number; total: number }>();
  let due = 0;
  let fresh = 0;
  let young = 0;
  let mature = 0;

  for (const card of cards) {
    const key = (card.subject_key ?? "").trim() || "—";
    const bucket = bySubject.get(key) ?? { due: 0, total: 0 };
    bucket.total += 1;
    if (isDue(card, today)) {
      due += 1;
      bucket.due += 1;
    }
    if (card.reps === 0) fresh += 1;
    else if (card.interval_days >= MATURE_INTERVAL_DAYS) mature += 1;
    else young += 1;
    bySubject.set(key, bucket);
  }

  return {
    total: cards.length,
    due,
    fresh,
    young,
    mature,
    bySubject: [...bySubject.entries()]
      .map(([subject_key, v]) => ({ subject_key, ...v }))
      .sort((a, b) => b.due - a.due || a.subject_key.localeCompare(b.subject_key)),
  };
}

/**
 * The queue for one sitting.
 *
 * Oldest due date first, so a card that has been waiting since Monday is asked
 * before one that became due an hour ago, and the order never depends on how
 * the rows happened to come back from the database.
 *
 * Courses are then interleaved rather than run one after another: twenty cards
 * of the same course in a row is a memory test, not revision. Within a course
 * the ranking above is untouched, so a planned single-course sitting still gets
 * its cards in the order they were earned.
 */
export function reviewQueue(cards: SrsCard[], today: string, limit = 30): SrsCard[] {
  const ranked = [...cards]
    .filter((c) => isDue(c, today))
    .sort(
      (a, b) =>
        (a.due_date || "0000-00-00").localeCompare(b.due_date || "0000-00-00") ||
        a.reps - b.reps ||
        (a.created_date || "").localeCompare(b.created_date || ""),
    );

  const byCourse = new Map<string, SrsCard[]>();
  for (const card of ranked) {
    const key = card.subject_key;
    const queue = byCourse.get(key);
    if (queue) queue.push(card);
    else byCourse.set(key, [card]);
  }

  const out: SrsCard[] = [];
  const cap = Math.max(1, limit);
  for (let round = 0; out.length < cap; round += 1) {
    let added = false;
    for (const queue of byCourse.values()) {
      const next = queue[round];
      if (!next) continue;
      out.push(next);
      added = true;
      if (out.length >= cap) break;
    }
    // Every course has run out: the queue is shorter than the limit.
    if (!added) break;
  }
  return out;
}