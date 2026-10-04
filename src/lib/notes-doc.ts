import { splitParagraphs, uniqueLines, type PrintDoc } from "./print-doc";
import type { MaterialNotes } from "./ai/notes";

/**
 * A lecture, turned into a document.
 *
 * The order here is the order of a page of notes rather than the order of the
 * reply: what the lecture is about, then the lecture in the order it was given,
 * then the maths written out on its own so it can be found without hunting, then
 * the lines worth revising from. The section order itself is never rearranged -
 * a lecture is a sequence, and putting the third topic before the second makes
 * notes that no longer follow the lecture they are notes of.
 */

type Wording = { [K in "tables" | "formulas" | "takeaways" | "untitled"]: string };

const WORDS: Record<"ar" | "en", Wording> = {
  ar: {
    tables: "جداول المحاضرة",
    formulas: "الصيغ المهمة",
    takeaways: "الخلاصة",
    untitled: "ملاحظات المحاضرة",
  },
  en: {
    tables: "Tables",
    formulas: "The formulas",
    takeaways: "Takeaways",
    untitled: "Lecture notes",
  },
};

/**
 * The document for one lecture.
 *
 * A section with no body is a hole in the middle of a printed lecture, and an
 * overview is dropped when the model wrote none rather than left as a heading
 * over nothing. What is not dropped is an untitled section: a lecture the model
 * returned as one long piece of prose is still the lecture, and refusing to
 * print it would be worse than printing it without a heading.
 */
export function buildNotesDoc(input: {
  notes: MaterialNotes;
  title: string;
  course?: string;
  language: "ar" | "en";
  dateLabel: string;
}): PrintDoc {
  const words = WORDS[input.language];
  const blocks: PrintDoc["blocks"] = [];

  const overview = splitParagraphs(input.notes.overview);
  if (overview.length) {
    // No heading: this is the opening of the lecture, not a section of it.
    blocks.push({ kind: "paragraphs", heading: "", lines: overview });
  }

  for (const s of input.notes.sections ?? []) {
    const lines = splitParagraphs(s?.body ?? "");
    if (!lines.length) continue;
    blocks.push({
      kind: "paragraphs",
      heading: String(s?.heading ?? "").replace(/\s+/g, " ").trim(),
      lines,
    });
  }

  const tables = (input.notes.tables ?? [])
    .map((t) => ({
      caption: String(t?.caption ?? "").replace(/\s+/g, " ").trim(),
      columns: (t?.columns ?? []).map((c) => String(c ?? "").trim()),
      rows: (t?.rows ?? []).map((r) => (Array.isArray(r) ? r : []).map((c) => String(c ?? "").trim())),
    }))
    .filter((t) => t.columns.length > 1 && t.rows.length > 0);
  if (tables.length) {
    // The grids get a heading of their own rather than being tucked under the
    // section they came from: a table is the part of a lecture a student scans
    // for, and it is the one thing on the page that cannot be read as prose.
    blocks.push({ kind: "table", heading: words.tables, ...tables[0] });
    for (const extra of tables.slice(1)) {
      blocks.push({ kind: "table", heading: "", ...extra });
    }
  }

  const formulas = (input.notes.formulas ?? [])
    .map((f) => ({
      label: String(f?.label ?? "").replace(/\s+/g, " ").trim(),
      expression: String(f?.expression ?? "")
        // LaTeX delimiters are noise on paper: "\(x\)" reads as "(x)" at best.
        .replace(/\\\(|\\\)|\\\[|\\\]|\$\$/g, " ")
        .replace(/[^\S\n]+/g, " ")
        .trim(),
    }))
    .filter((f) => f.expression);
  if (formulas.length) {
    blocks.push({ kind: "formulas", heading: words.formulas, rows: formulas });
  }

  const takeaways = uniqueLines(input.notes.takeaways, 400);
  if (takeaways.length) {
    blocks.push({ kind: "callout", heading: words.takeaways, items: takeaways });
  }

  return {
    title: String(input.title ?? "").trim() || words.untitled,
    course: String(input.course ?? "").trim(),
    language: input.language,
    dateLabel: input.dateLabel,
    blocks,
  };
}