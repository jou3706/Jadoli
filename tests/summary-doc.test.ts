import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummaryDoc, isEmptyDoc, summaryFileName } from "../src/lib/summary-doc.ts";
import type { MaterialSummary } from "../src/lib/ai/summary.ts";

const sum = (over: Partial<MaterialSummary> = {}): MaterialSummary => ({
  summary: "",
  keyPoints: [],
  glossary: [],
  ...over,
});

const doc = (s: MaterialSummary, language: "ar" | "en" = "en", title = "Week 3 notes") =>
  buildSummaryDoc({ summary: s, title, language, dateLabel: "12 Oct 2026" });

const kinds = (d: ReturnType<typeof buildSummaryDoc>) => d.blocks.map((b) => b.kind);

test("the three parts come out in the order a revision sheet wants them", () => {
  const d = doc(
    sum({
      summary: "First.\n\nSecond.",
      keyPoints: ["Convolution"],
      glossary: [{ term: "Eigenvector", meaning: "keeps its direction" }],
    }),
  );
  assert.deepEqual(kinds(d), ["paragraphs", "points", "terms"]);
});

test("blank lines separate paragraphs and single newlines do not", () => {
  const d = doc(sum({ summary: "One line.\nStill the same line.\n\nA new paragraph." }));
  const block = d.blocks[0];
  assert.equal(block.kind, "paragraphs");
  assert.deepEqual(block.kind === "paragraphs" ? block.lines : [], [
    "One line. Still the same line.",
    "A new paragraph.",
  ]);
});

test("a section with nothing in it is left out, not printed empty", () => {
  // A heading over nothing is how a sheet reads as broken. This is the case a
  // scanned PDF with no real text produces.
  assert.deepEqual(kinds(doc(sum({ summary: "Only this." }))), ["paragraphs"]);
  assert.deepEqual(kinds(doc(sum({ keyPoints: ["one"] }))), ["points"]);
  assert.deepEqual(
    kinds(doc(sum({ glossary: [{ term: "a", meaning: "b" }] }))),
    ["terms"],
  );
});

test("a reply with nothing readable in it produces no document at all", () => {
  const empty = doc(sum());
  assert.ok(isEmptyDoc(empty));
  assert.deepEqual(empty.blocks, []);
});

test("a glossary row missing either half is dropped", () => {
  // On a screen the reader's eye finishes the row. On paper it is a blank line
  // with a bullet beside it.
  const d = doc(
    sum({
      glossary: [
        { term: "Kernel", meaning: "the span of the inputs" },
        { term: "Orphan", meaning: "" },
        { term: "", meaning: "meaningless" },
      ],
    }),
  );
  const block = d.blocks[0];
  assert.equal(block.kind, "terms");
  const rows = block.kind === "terms" ? block.rows : [];
  assert.equal(rows.filter((r) => r.term === "").length, 1, "only the closing note is empty");
  assert.deepEqual(
    rows.filter((r) => r.term).map((r) => r.term),
    ["Kernel"],
  );
});

test("the closing note is the reader's language, not the summary's", () => {
  const arabic = doc(
    sum({ glossary: [{ term: "معنى", meaning: "شرح" }] }),
    "ar",
  );
  const block = arabic.blocks[0];
  const note = block.kind === "terms" ? block.rows[block.rows.length - 1].meaning : "";
  assert.match(note, /مصطلح/);
  const english = doc(sum({ glossary: [{ term: "x", meaning: "y" }] }), "en");
  const enBlock = english.blocks[0];
  const enNote = enBlock.kind === "terms" ? enBlock.rows[enBlock.rows.length - 1].meaning : "";
  assert.match(enNote, /Each term/);
});

test("headings are written in the language the summary was read in", () => {
  const ar = doc(sum({ summary: "نص" }), "ar");
  assert.equal(ar.blocks[0].heading, "الملخص");
  const en = doc(sum({ summary: "text" }), "en");
  assert.equal(en.blocks[0].heading, "Summary");
});

test("a summary with no title still gets one, rather than a blank sheet", () => {
  const d = buildSummaryDoc({
    summary: sum({ summary: "text" }),
    title: "   ",
    language: "en",
    dateLabel: "",
  });
  assert.equal(d.title, "Summary");
});

test("the course is a subtitle and is optional", () => {
  assert.equal(doc(sum(), "en", "Week 3").course, "");
  const withCourse = buildSummaryDoc({
    summary: sum({ summary: "text" }),
    title: "Week 3",
    course: "  Applied Math ",
    language: "en",
    dateLabel: "",
  });
  assert.equal(withCourse.course, "Applied Math");
});

test("a file name a Windows machine will accept", () => {
  // Course titles are full of exactly these characters, and jsPDF passes the
  // name straight to the browser's download.
  assert.equal(summaryFileName('Week 1/2: intro*'), "Week 1 2 intro.pdf");
  assert.equal(summaryFileName('a<b>c|d"e"f?g*h'), "a b c d e f g h.pdf");
});

test("punctuation a file name may keep is kept", () => {
  // Only the characters Windows actually refuses are replaced. The Arabic
  // question mark is a different character from `?` and is perfectly legal, so
  // stripping it would be mangling a title for no reason.
  assert.equal(summaryFileName("محاضرة 3 - مراجعة؟"), "محاضرة 3 - مراجعة؟.pdf");
  assert.equal(summaryFileName("مقدمة: الفصل الأول"), "مقدمة الفصل الأول.pdf");
});

test("a title that came from a file name does not get two extensions", () => {
  // Materials are titled after the file they came from (`title: file.name`), so
  // this is the normal case, not an edge case.
  assert.equal(summaryFileName("Lecture-3.pdf"), "Lecture-3.pdf");
  assert.equal(summaryFileName("محاضرة 3.pdf"), "محاضرة 3.pdf");
  assert.equal(summaryFileName("Week 1.pptx"), "Week 1.pdf");
  assert.equal(summaryFileName("notes (2).PDF"), "notes (2).pdf");
});

test("a dot that is part of the title is not an extension", () => {
  // "v1.2" and "Q1. Final Exam" are titles, not files with extensions.
  assert.equal(summaryFileName("Revision v1.2"), "Revision v1.2.pdf");
  assert.equal(summaryFileName("Q1. Final Exam"), "Q1. Final Exam.pdf");
  assert.equal(summaryFileName("Applied Math."), "Applied Math.pdf");
  assert.equal(summaryFileName("Applied Math  "), "Applied Math.pdf");
});

test("a file name with nothing usable in it still gets an extension", () => {
  assert.equal(summaryFileName(""), "summary.pdf");
  assert.equal(summaryFileName("///"), "summary.pdf");
  assert.equal(summaryFileName("...."), "summary.pdf");
  assert.equal(summaryFileName(".pdf"), "summary.pdf");
});

test("a file name that is too long loses its length, not its extension", () => {
  const name = summaryFileName("x".repeat(400));
  assert.ok(name.length <= 124, `too long: ${name.length}`);
  assert.ok(name.endsWith(".pdf"));
});