/**
 * What a printed page is made of.
 *
 * Both printable things in the app - a material's summary and a material's full
 * lecture notes - are the same kind of object: a heading, a course line, and an
 * ordered list of blocks. Keeping them in one shape is what lets a single sheet
 * renderer draw both, so the two never drift apart in how they look, and what is
 * left for the two builders to decide is only content and order.
 *
 * Nothing here reads the clock, the browser or the network, so a document can be
 * read and checked on its own.
 */

export type PrintBlock =
  /** Prose. An empty heading means a lead paragraph with no heading over it. */
  | { kind: "paragraphs"; heading: string; lines: string[] }
  /** Numbered, one fact per line: the things to revise from. */
  | { kind: "points"; heading: string; items: string[] }
  /** Two columns: the word, and what it means here. */
  | { kind: "terms"; heading: string; rows: { term: string; meaning: string }[] }
  /** Set apart from the prose, the way a textbook sets a formula apart. */
  | { kind: "formulas"; heading: string; rows: { label: string; expression: string }[] }
  /** A tinted box, for the part of the page that is the point of the page. */
  | { kind: "callout"; heading: string; items: string[] };

export type PrintDoc = {
  /** The document's own title: the file it was made from. */
  title: string;
  /** The course, when the app knows it, as a subtitle. */
  course: string;
  /** The document's language, which decides its direction and its wording. */
  language: "ar" | "en";
  /** Printed under the title so a sheet found later says what it is. */
  dateLabel: string;
  blocks: PrintBlock[];
};

/** Nothing worth printing at all. */
export const isEmptyDoc = (doc: PrintDoc) => doc.blocks.length === 0;

/** Blank lines separate paragraphs; single newlines do not. */
export const splitParagraphs = (text: string) =>
  String(text ?? "")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

/** A line of a list, or one half of a row: collapsed to a single line of type. */
const oneLine = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/**
 * Lines, without the repeats.
 *
 * A model asked for twelve points will hand back the same point twice more often
 * than you would like, and a numbered list that says the same thing twice reads
 * as though the page were padded.
 */
export const uniqueLines = (values: readonly unknown[], max: number): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values ?? []) {
    const line = oneLine(v, max);
    if (!line) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
};

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
export function printFileName(title: string, extension = "pdf"): string {
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