import { test } from "node:test";
import assert from "node:assert/strict";
import { buildNotesDoc } from "../src/lib/notes-doc.ts";
import { isEmptyDoc } from "../src/lib/print-doc.ts";
import type { MaterialNotes } from "../src/lib/ai/notes.ts";

const notes = (over: Partial<MaterialNotes> = {}): MaterialNotes => ({
  overview: "",
  sections: [],
  formulas: [],
  takeaways: [],
  ...over,
});

const doc = (n: MaterialNotes, language: "ar" | "en" = "en", title = "Lecture 3") =>
  buildNotesDoc({ notes: n, title, language, dateLabel: "12 Oct 2026" });

const kinds = (d: ReturnType<typeof buildNotesDoc>) => d.blocks.map((b) => b.kind);

test("a lecture comes out in the order a page of notes is read in", () => {
  const d = doc(
    notes({
      overview: "What this covers.",
      sections: [{ heading: "Definitions", body: "Text." }],
      formulas: [{ label: "Eigen", expression: "Av = λv" }],
      takeaways: ["It holds."],
    }),
  );
  assert.deepEqual(kinds(d), ["paragraphs", "paragraphs", "formulas", "callout"]);
});

test("the overview leads without a heading over it", () => {
  // It is the opening of the lecture, not a section of it.
  const d = doc(notes({ overview: "First.\n\nSecond." }));
  assert.equal(d.blocks.length, 1);
  assert.equal(d.blocks[0].kind, "paragraphs");
  assert.equal(d.blocks[0].heading, "");
});

test("the overview is left out when there is none", () => {
  // A heading over nothing is how a page reads as broken.
  const d = doc(notes({ sections: [{ heading: "Only", body: "Text." }] }));
  assert.equal(d.blocks.length, 1);
  assert.equal(d.blocks[0].heading, "Only");
});

test("the sections keep the order the lecture was given in", () => {
  const d = doc(
    notes({
      sections: [
        { heading: "First", body: "a" },
        { heading: "Second", body: "b" },
        { heading: "Third", body: "c" },
      ],
    }),
  );
  assert.deepEqual(
    d.blocks.map((b) => (b.kind === "paragraphs" ? b.heading : "")),
    ["First", "Second", "Third"],
  );
});

test("a section with no body leaves no heading behind", () => {
  const d = doc(
    notes({
      sections: [
        { heading: "Hole", body: "" },
        { heading: "Real", body: "Text." },
      ],
    }),
  );
  assert.deepEqual(kinds(d), ["paragraphs"]);
});

test("formulas are copied as they came, label or no label", () => {
  const d = doc(
    notes({
      formulas: [
        { label: "Eigenvalues", expression: "A*v = λ*v" },
        { label: "", expression: "det(A - λ*I) = 0" },
        { label: "Nothing", expression: "" },
      ],
    }),
  );
  const block = d.blocks[0];
  assert.equal(block.kind, "formulas");
  assert.deepEqual(block.rows, [
    { label: "Eigenvalues", expression: "A*v = λ*v" },
    { label: "", expression: "det(A - λ*I) = 0" },
  ]);
});

test("LaTeX delimiters are stripped, since they print as noise", () => {
  // "\\frac{d}{dx}" itself has to survive - it is the model's job not to write
  // that - but "\\(x\\)" printing as "(x)" is this file's job to fix.
  const d = doc(
    notes({
      formulas: [
        { label: "", expression: "\\(x^2\\) and \\[y\\] and $$z$$" },
        { label: "", expression: "\\frac{d}{dx} x" },
      ],
    }),
  );
  const block = d.blocks[0];
  assert.equal(block.kind, "formulas");
  assert.deepEqual(
    block.rows.map((r) => r.expression),
    ["x^2 and y and z", "\\frac{d}{dx} x"],
  );
});

test("the headings are the reader's language, not the notes'", () => {
  const ar = doc(
    notes({ formulas: [{ label: "", expression: "x" }], takeaways: ["y"] }),
    "ar",
  );
  assert.deepEqual(kinds(ar), ["formulas", "callout"]);
  assert.equal(ar.blocks[0].heading, "الصيغ المهمة");
  assert.equal(ar.blocks[1].heading, "الخلاصة");
  const en = doc(notes({ formulas: [{ label: "", expression: "x" }] }), "en");
  assert.equal(en.blocks[0].heading, "The formulas");
});

test("a lecture with no title still gets one", () => {
  assert.equal(doc(notes(), "en", "   ").title, "Lecture notes");
  assert.equal(doc(notes(), "ar", "   ").title, "ملاحظات المحاضرة");
});

test("a reply with nothing readable in it produces no document", () => {
  assert.ok(isEmptyDoc(doc(notes())));
  assert.ok(isEmptyDoc(doc(notes({ sections: [{ heading: "Hole", body: "" }] }))));
});

test("the course is a subtitle and is optional", () => {
  assert.equal(doc(notes(), "en", "Lecture 3").course, "");
  const d = buildNotesDoc({
    notes: notes({ overview: "x" }),
    title: "Lecture 3",
    course: "  Applied Math ",
    language: "en",
    dateLabel: "",
  });
  assert.equal(d.course, "Applied Math");
});