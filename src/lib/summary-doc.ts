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
 * in the document, in what order, and what the file is called. All of it is a
 * function of the summary and the language, with no browser and no dates read
 * from the clock, so it can be read and checked on its own.
 */

export type SummaryBlock =
  | { kind: "paragraphs"; heading: string; lines: string[] }
  | { kind: "points"; heading: string; items: string[] }
  | { kind: "terms"; heading: string; rows: { term: string; meaning: string }[] };

export type SummaryDoc = {
  /** The document's own title: the file it was made from. */
  title: string;
  /** The course, when the app knows it, as a subtitle. */
  course: string;
  /** What was asked for, in the reader's language. */
  language: "ar" | "en";
  /** Printed under the title so a sheet found later says what it is. */
  dateLabel: string;
  blocks: SummaryBlock[];
};

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

/** Blank lines separate paragraphs; single newlines do not. */
const paragraphs = (text: string) =>
  String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

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
}): SummaryDoc {
  const words = WORDS[input.language];
  const blocks: SummaryBlock[] = [];

  const lines = paragraphs(input.summary.summary);
  if (lines.length) blocks.push({ kind: "paragraphs", heading: words.summary, lines });

  const items = input.summary.keyPoints.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (items.length) blocks.push({ kind: "points", heading: words.points, items });

  const rows = input.summary.glossary
    .map((g) => ({
      term: g.term.replace(/\s+/g, " ").trim(),
      meaning: g.meaning.replace(/\s+/g, " ").trim(),
    }))
    // A row with only one half is a line the model left unfinished. It is worse
    // in a printed document than on a screen, where the reader's eye fills it in.
    .filter((g) => g.term && g.meaning);
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

/** Nothing worth printing at all. */
export const isEmptyDoc = (doc: SummaryDoc) => doc.blocks.length === 0;

/**
 * Extensions a title picked up from its own file name.
 *
 * Materials are titled after the file they came from, so a title ends in `.pdf`
 * in practice rather than in principle. Appending the extension again would name
 * every sheet in the app `lecture-3.pdf.pdf`, which is the kind of thing that
 * looks fine until a folder fills up with them.
 */
const FILE_EXTENSIONS =
  /\.(pdf|docx?|pptx?|xlsx?|txt|md|rtf|odt|odp|ods|csv|png|jpe?g|gif|webp|svg|mp4|mov|avi|webm|mp3|m4a|epub|zip)$/i;

/**
 * A file name a filesystem will accept.
 *
 * A material title is whatever the student or the download gave it, and the
 * characters Windows will not put in a file name are exactly the ones that turn
 * up in course titles: `Week 1/2: intro*`, `محاضرة 3 - مراجعة`. jsPDF hands the
 * name to the browser's own download, which then either refuses it or writes a
 * file nobody can find again.
 */
export function summaryFileName(title: string, extension = "pdf"): string {
  const cleaned = String(title ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(FILE_EXTENSIONS, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  const base = cleaned || "summary";
  // Kept short: a name past this length is truncated by the filesystem anyway, and
  // it is truncated without its extension, which is the part that matters.
  return `${base.slice(0, 120)}.${extension}`;
}