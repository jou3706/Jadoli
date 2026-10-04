import { z } from "zod";

/**
 * A material read back as lecture notes.
 *
 * This is the same read as the summary and a different artifact. A summary is
 * orientation - what the file is about and what has to survive the exam. Notes
 * are the lecture itself, laid out in the order it was given, which is why this
 * is sections rather than three fields: a page of prose that has to be read
 * straight through is not notes, and a lecture that arrives as one undifferentiated
 * block of text is unreadable on paper in a way it is not on a screen.
 *
 * So the model is asked for the order and the headings, and the app keeps
 * whatever order it hands back.
 */

// No minimum length on any field: an empty entry is dropped by the tidier below
// rather than failing the whole read over one blank row.
const section = z.object({
  heading: z.string().max(160).default(""),
  body: z.string().max(8000).default(""),
});

const formula = z.object({
  label: z.string().max(160).default(""),
  expression: z.string().max(600).default(""),
});

export const notesSchema = z.object({
  overview: z.string().max(3000).default(""),
  sections: z.array(section).max(30).default([]),
  formulas: z.array(formula).max(20).default([]),
  takeaways: z.array(z.string().max(400)).max(12).default([]),
});

export type RawNotes = z.infer<typeof notesSchema>;

export type MaterialNotes = {
  overview: string;
  sections: { heading: string; body: string }[];
  formulas: { label: string; expression: string }[];
  takeaways: string[];
};

/**
 * Squared-off whitespace, with the paragraph breaks kept.
 *
 * A lecture note is read in paragraphs, so the blank line between them is content
 * rather than noise. Collapsing it would run a lecture into one wall.
 */
const clean = (s: unknown, max: number) =>
  String(s ?? "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);

/** Repeated headings, repeated bodies and repeated takeaways, gone. */
const once = <T>(values: readonly T[], key: (v: T) => string): T[] => {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of values) {
    const k = key(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
};

/**
 * The parts of a reply worth printing.
 *
 * Nothing is required: notes with no formulas are still notes. What is dropped is
 * a section with no body, a formula with no expression, and any of those repeated
 * - a heading with nothing under it is a hole in the middle of a printed lecture,
 * which reads worse than the hole it leaves in the source.
 */
export function tidyNotes(raw: RawNotes): MaterialNotes {
const sections = once(
    (raw.sections ?? [])
      .map((s) => ({ heading: clean(s?.heading, 160), body: clean(s?.body, 8000) }))
      .filter((s) => s.body.length > 0),
    (s) => `${s.heading.toLowerCase()} ${s.body.slice(0, 80).toLowerCase()}`,
  );

  const formulas = once(
    (raw.formulas ?? [])
      .map((f) => ({ label: clean(f?.label, 160), expression: clean(f?.expression, 600) }))
      .filter((f) => f.expression.length > 0),
    (f) => f.expression.toLowerCase(),
  );

  const takeaways: string[] = [];
  const tSeen = new Set<string>();
  for (const t of raw.takeaways ?? []) {
    const line = String(t ?? "").trim().slice(0, 400);
    if (!line) continue;
    const key = line.toLowerCase();
    if (tSeen.has(key)) continue;
    tSeen.add(key);
    takeaways.push(line);
  }

  return { overview: clean(raw.overview, 3000), sections, formulas, takeaways };
}

const KEY = "jadoli:material-notes";

/**
 * Notes are cached on the device, not in the database, for the reason summaries
 * are: they are derived from a file that does not change, so a second look at the
 * same material should not pay for a second read of it, and unlike a grade or an
 * attendance record they are cheap to lose.
 */
export function readCachedNotes(materialId: string): MaterialNotes | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(`${KEY}:${materialId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MaterialNotes;
    if (!parsed || typeof parsed.overview !== "string") return null;
    return {
      overview: parsed.overview,
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      formulas: Array.isArray(parsed.formulas) ? parsed.formulas : [],
      takeaways: Array.isArray(parsed.takeaways) ? parsed.takeaways : [],
    };
  } catch {
    // A corrupt cache is not worth an error message: it is one more read.
    return null;
  }
}

export function writeCachedNotes(materialId: string, value: MaterialNotes): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(`${KEY}:${materialId}`, JSON.stringify(value));
  } catch {
    // Notes run longer than a summary and the quota is small; failing to cache one
    // only means the next click pays for the read again.
  }
}