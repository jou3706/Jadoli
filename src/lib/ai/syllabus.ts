import { z } from "zod";
import { pad2 } from "../utils";
import type { SubjectEventKind } from "../db/types";

/**
 * What a syllabus says, turned into rows the events table can hold.
 *
 * A course syllabus is the one file that already contains the exam date, the
 * quiz dates and the submission deadlines, and it is the file a student is most
 * likely to have uploaded and least likely to have read twice. Reading it is a
 * job for a model; deciding what to do with the answer is not.
 */

const KINDS = ["quiz", "exam", "assignment", "other"] as const satisfies readonly SubjectEventKind[];

/** One date as it comes back, loose on purpose: models write `12/3` and `Mar 12`. */
export const rawEventSchema = z.object({
  subject_key: z.string().max(120).default(""),
  title: z.string().min(1).max(200),
  kind: z.enum(KINDS).default("other"),
  date: z.string().max(60).default(""),
  start_time: z.string().max(20).default(""),
  end_time: z.string().max(20).default(""),
  hall: z.string().max(200).default(""),
  note: z.string().max(600).default(""),
});

export const syllabusResultSchema = z.object({
  events: z.array(rawEventSchema).max(40),
});

export type RawSyllabusEvent = z.infer<typeof rawEventSchema>;

/** A row ready to be shown for confirmation, then saved. */
export type SyllabusDraft = RawSyllabusEvent & {
  subject_key: string;
  date: string;
  start_time: string;
  end_time: string;
  remind_minutes: number;
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const validISO = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  // A 31 February has to be rejected, not stored as the 3rd of March.
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

/**
 * A date into `YYYY-MM-DD`, or nothing.
 *
 * An event with no usable date is dropped rather than guessed at: it cannot be
 * counted down to, and a countdown to the wrong Tuesday is worse than no
 * countdown, because it is believed.
 */
export function parseEventDate(raw: string, today: string): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  if (validISO(s)) return s;

  // 2026-03-12T09:00 or 2026/03/12
  const isoish = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoish) {
    const [, y, m, d] = isoish;
    const candidate = `${y}-${pad2(Number(m))}-${pad2(Number(d))}`;
    if (validISO(candidate)) return candidate;
  }

  // 12/03/2026 — day first, then month, as it is written everywhere here.
  const dmy = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    const candidate = `${y}-${pad2(m)}-${pad2(d)}`;
    if (validISO(candidate)) return candidate;
  }

  // "12 March" or "March 12", with no year: the year is the current one, and a
  // date already past is read as next year, since a syllabus is read before the
  // thing it describes.
  const named = s.match(/^(\d{1,2})\s+([a-z]{3,})\.?/i) ?? s.match(/^([a-z]{3,})\.?\s+(\d{1,2})/i);
  if (named) {
    const monthText = named.length === 3 && /^\d/.test(named[1]) ? named[2] : named[1];
    const dayText = /^\d/.test(named[1]) ? named[1] : named[2];
    const month = MONTHS[monthText.slice(0, 3).toLowerCase()];
    if (month) {
      const day = Number(dayText);
      if (day >= 1 && day <= 31) {
        const year = Number(today.slice(0, 4));
        for (const y of [year, year + 1]) {
          const candidate = `${y}-${pad2(month)}-${pad2(day)}`;
          if (validISO(candidate) && candidate >= today) return candidate;
        }
      }
    }
  }
  return null;
}

/** A time into `HH:MM`, or nothing. */
export function parseEventTime(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2})[:.](\d{2})/);
  if (!m) return "";
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return "";
  return `${pad2(h)}:${pad2(mi)}`;
}

const REMIND_BY_KIND: Record<SubjectEventKind, number> = {
  exam: 120,
  quiz: 60,
  assignment: 60,
  other: 60,
};

/**
 * Two events are the same when the same course has the same title on the same
 * day. The database refuses that pair as well, so this only saves the student the
 * error message.
 */
export function sameEvent(
  a: { subject_key: string; title: string; date: string },
  b: { subject_key: string; title: string; date: string },
): boolean {
  return (
    a.date === b.date &&
    a.subject_key.trim().toLowerCase() === b.subject_key.trim().toLowerCase() &&
    a.title.trim().toLowerCase() === b.title.trim().toLowerCase()
  );
}

/**
 * The rows worth showing, in the order they come.
 *
 * `fallbackSubject` fills in a course name the file did not state: a syllabus
 * saved inside a course already carries one, and asking the student to type it
 * again would be the wrong answer.
 */
export function syllabusDrafts(
  raw: RawSyllabusEvent[],
  opts: { today: string; fallbackSubject?: string },
): SyllabusDraft[] {
  const out: SyllabusDraft[] = [];
  for (const e of raw) {
    const date = parseEventDate(e.date, opts.today);
    if (!date) continue;
    const subject = (e.subject_key || opts.fallbackSubject || "").trim();
    if (!subject) continue; // an event on no course has nowhere to live
    const start = parseEventTime(e.start_time);
    const draft: SyllabusDraft = {
      ...e,
      subject_key: subject,
      date,
      title: e.title.trim(),
      kind: e.kind,
      hall: e.hall.trim(),
      note: e.note.trim(),
      start_time: start,
      end_time: start ? parseEventTime(e.end_time) : "",
      remind_minutes: REMIND_BY_KIND[e.kind],
    };
    if (out.some((o) => sameEvent(o, draft))) continue; // the same line read twice
    out.push(draft);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));
}