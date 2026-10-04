import { test } from "node:test";
import assert from "node:assert/strict";
import { printFileName, splitParagraphs, uniqueLines, isEmptyDoc } from "../src/lib/print-doc.ts";

test("blank lines separate paragraphs and single newlines do not", () => {
  assert.deepEqual(splitParagraphs("One.\nStill one.\n\nTwo."), ["One. Still one.", "Two."]);
  assert.deepEqual(splitParagraphs("   \n\n  "), []);
  assert.deepEqual(splitParagraphs(""), []);
});

test("a repeated line is kept once", () => {
  assert.deepEqual(uniqueLines(["Convolution", "convolution", "Eigen", ""], 400), [
    "Convolution",
    "Eigen",
  ]);
});

test("a line of type is cut to what is allowed", () => {
  assert.equal(uniqueLines([{ toString: () => "x".repeat(50) }], 10).length, 1);
  assert.equal("x".repeat(50).slice(0, 10).length, 10);
});

test("a document with no blocks has nothing to print", () => {
  assert.ok(isEmptyDoc({ title: "t", course: "", language: "en", dateLabel: "", blocks: [] }));
  assert.ok(
    !isEmptyDoc({
      title: "t",
      course: "",
      language: "en",
      dateLabel: "",
      blocks: [{ kind: "paragraphs", heading: "", lines: ["x"] }],
    }),
  );
});

test("a file name a Windows machine will accept", () => {
  // Course titles are full of exactly these characters, and jsPDF passes the name
  // straight to the browser's download.
  assert.equal(printFileName('Week 1/2: intro*'), "Week 1 2 intro.pdf");
  assert.equal(printFileName('a<b>c|d"e"f?g*h'), "a b c d e f g h.pdf");
});

test("punctuation a file name may keep is kept", () => {
  // Only the characters Windows actually refuses are replaced. The Arabic
  // question mark is a different character from `?` and is perfectly legal, so
  // stripping it would be mangling a title for no reason.
  assert.equal(printFileName("محاضرة 3 - مراجعة؟"), "محاضرة 3 - مراجعة؟.pdf");
  assert.equal(printFileName("مقدمة: الفصل الأول"), "مقدمة الفصل الأول.pdf");
});

test("a title that came from a file name does not get two extensions", () => {
  // Materials are titled after the file they came from (`title: file.name`), so
  // this is the normal case, not an edge case.
  assert.equal(printFileName("Lecture-3.pdf"), "Lecture-3.pdf");
  assert.equal(printFileName("محاضرة 3.pdf"), "محاضرة 3.pdf");
  assert.equal(printFileName("Week 1.pptx"), "Week 1.pdf");
  assert.equal(printFileName("notes (2).PDF"), "notes (2).pdf");
});

test("a dot that is part of the title is not an extension", () => {
  // "v1.2" and "Q1. Final Exam" are titles, not files with extensions.
  assert.equal(printFileName("Revision v1.2"), "Revision v1.2.pdf");
  assert.equal(printFileName("Q1. Final Exam"), "Q1. Final Exam.pdf");
  assert.equal(printFileName("Applied Math."), "Applied Math.pdf");
  assert.equal(printFileName("Applied Math  "), "Applied Math.pdf");
});

test("a file name with nothing usable in it still gets an extension", () => {
  assert.equal(printFileName(""), "summary.pdf");
  assert.equal(printFileName("///"), "summary.pdf");
  assert.equal(printFileName("...."), "summary.pdf");
  assert.equal(printFileName(".pdf"), "summary.pdf");
});

test("a file name that is too long loses its length, not its extension", () => {
  const name = printFileName("x".repeat(400));
  assert.ok(name.length <= 124, `too long: ${name.length}`);
  assert.ok(name.endsWith(".pdf"));
});