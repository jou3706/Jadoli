import { splitParagraphs, uniqueLines, type PrintDoc } from "./print-doc";
import type { MaterialSummary } from "./ai/summary";

/**
 * A summary, turned into a document.
 *
 * The PDF is produced by rasterising a real DOM node rather than by drawing text
 * into the PDF, and that is not a preference: jsPDF's built-in fonts have no
 * Arabic glyphs at all, no shaping and no right-to-left, so a summary written by
 * a model in Arabic would come out as disconnected letters in the wrong order.
 * Letting the browser lay the page out and photographing it is the same trick
 * `lib/export.ts` already uses for the timetable, and it gets Arabic, mixed
 * numbers and punctuation right for free.
 *
 * What is left to decide here is the part that can actually be wrong: what goes
 * in the document, in what order, and what the file is called.
 */

type Wording = { [K in "summary" | "points" | "terms" | "vocabularyNote" | "generated"]: string };

const WORDS: Record<"ar" | "en", Wording> = {
  ar: {
    summary: "الملخص",
    points: "أهم النقاط",
    terms: "مصطلحات لازم تعرفها",
    vocabularyNote: "كل مصطلح بمعناه كما ورد في المحاضرة.",
    generated: "تم الاستخراج",
  },
  en: {
    summary: "Summary",
    points: "What has to be remembered",
    terms: "Vocabulary",
    vocabularyNote: "Each term with the meaning it was given in the lecture.",
    generated: "Extracted",
  },
};

/**
 * The document for one summary.
 *
 * Empty sections are left out rather than rendered with nothing in them: a
 * heading over an empty page is how a summary reads as broken, and "there was
 * nothing readable in that file" should be the only thing on the sheet when the
 * file really had nothing.
 */
export function buildSummaryDoc(input: {
  summary: MaterialSummary;
  title: string;
  course?: string;
  language: "ar" | "en";
  dateLabel: string;
}): PrintDoc {
  const words = WORDS[input.language];
  const blocks: PrintDoc["blocks"] = [];

  const lines = splitParagraphs(input.summary.summary);
  if (lines.length) blocks.push({ kind: "paragraphs", heading: words.summary, lines });

  const items = uniqueLines(input.summary.keyPoints, 400);
  if (items.length) blocks.push({ kind: "points", heading: words.points, items });

  const seen = new Set<string>();
  const rows = input.summary.glossary
    .map((g) => ({ term: g.term, meaning: g.meaning }))
    // A row with only one half is a line the model left unfinished. It is worse
    // in a printed document than on a screen, where the reader's eye fills it in.
    .filter((g) => {
      const term = g.term.replace(/\s+/g, " ").trim();
      const meaning = g.meaning.replace(/\s+/g, " ").trim();
      if (!term || !meaning) return false;
      const key = term.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      g.term = term;
      g.meaning = meaning;
      return true;
    });
  if (rows.length) {
    blocks.push({
      kind: "terms",
      heading: words.terms,
      rows: [...rows, { term: "", meaning: words.vocabularyNote }],
    });
  }

  return {
    title: String(input.title ?? "").trim() || words.summary,
    course: String(input.course ?? "").trim(),
    language: input.language,
    dateLabel: input.dateLabel,
    blocks,
  };
}