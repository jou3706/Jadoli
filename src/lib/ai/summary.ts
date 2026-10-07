import { z } from "zod";

/**
 * A material read back as something you can revise from.
 *
 * Cards ask for recall and this asks for orientation: what the file is about,
 * what has to survive the exam, and what the words in it mean. Those are three
 * different artifacts and only the first one is the file's own words, which is
 * why this is a page and not a deck.
 */

// No minimum length here: an empty entry is dropped by the tidier below rather
// than failing the whole read over one blank row.
const glossaryEntry = z.object({
  term: z.string().max(160).default(""),
  meaning: z.string().max(400).default(""),
});

export const summarySchema = z.object({
  summary: z.string().max(6000).default(""),
  key_points: z.array(z.string().max(400)).max(12).default([]),
  glossary: z.array(glossaryEntry).max(24).default([]),
});

export type RawSummary = z.infer<typeof summarySchema>;

export type MaterialSummary = {
  summary: string;
  keyPoints: string[];
  glossary: { term: string; meaning: string }[];
};

/**
 * Squared-off whitespace, with the paragraph breaks kept.
 *
 * A summary is read in paragraphs and a key point is read as a line, so the
 * blank line between them is content rather than noise.
 */
const clean = (s: unknown, max: number) =>
  String(s ?? "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);

/**
 * The parts of a reply worth showing.
 *
 * A summary with no key points and no glossary is still a summary, so nothing
 * here is required — but a glossary that repeats a term, or a key point that is
 * the title of the file with a full stop on it, is dropped rather than displayed
 * as though it had been read.
 */
export function tidySummary(raw: RawSummary): MaterialSummary {
  const seen = new Set<string>();
  const glossary: { term: string; meaning: string }[] = [];
  for (const g of raw.glossary ?? []) {
    const term = clean(g?.term, 160);
    const meaning = clean(g?.meaning, 400);
    if (!term || !meaning) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    glossary.push({ term, meaning });
  }

  const points: string[] = [];
  const pointSeen = new Set<string>();
  for (const p of raw.key_points ?? []) {
    const line = String(p ?? "").trim().slice(0, 400);
    if (!line) continue;
    const key = line.toLowerCase();
    if (pointSeen.has(key)) continue;
    pointSeen.add(key);
    points.push(line);
  }

  return { summary: clean(raw.summary, 6000), keyPoints: points, glossary };
}

const KEY = "jadwali:material-summary";

/**
 * Summaries are cached on the device, not in the database.
 *
 * A summary is derived from a file that does not change, so a second look at the
 * same material should not pay for a second read of it — and the derivation is
 * cheap to lose, unlike attendance or a grade. The id is in the key, so two
 * courses with the same file title do not collide.
 */
export function readCachedSummary(materialId: string): MaterialSummary | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(`${KEY}:${materialId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MaterialSummary;
    if (!parsed || typeof parsed.summary !== "string") return null;
    return {
      summary: parsed.summary,
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : [],
      glossary: Array.isArray(parsed.glossary) ? parsed.glossary : [],
    };
  } catch {
    // A corrupt cache is not worth an error message: it is one more read.
    return null;
  }
}

export function writeCachedSummary(materialId: string, value: MaterialSummary): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(`${KEY}:${materialId}`, JSON.stringify(value));
  } catch {
    // The quota is small and a summary is disposable; failing to cache it only
    // means the next visit pays for the read again.
  }
}