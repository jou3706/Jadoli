import { test } from "node:test";
import assert from "node:assert/strict";
import { tidyNotes } from "../src/lib/ai/notes.ts";

const raw = (over: Record<string, unknown> = {}) =>
  tidyNotes({
    overview: "",
    sections: [],
    formulas: [],
    takeaways: [],
    ...over,
  } as never);

test("paragraph breaks inside a section survive, since a lecture is read in them", () => {
  const n = raw({
    sections: [{ heading: "Definitions", body: "First.\n\nSecond." }],
  });
  assert.equal(n.sections.length, 1);
  assert.equal(n.sections[0].body, "First.\n\nSecond.");
});

test("a heading with nothing under it is dropped", () => {
  // A hole in the middle of a printed lecture reads worse than the hole it
  // leaves in the source.
  const n = raw({
    sections: [
      { heading: "Empty", body: "" },
      { heading: "Real", body: "Something." },
      { heading: "Blank", body: "   \n  " },
    ],
  });
  assert.deepEqual(n.sections.map((s) => s.heading), ["Real"]);
});

test("the order the lecture was given in is not rearranged", () => {
  // A lecture is a sequence. Putting the third topic before the second makes
  // notes that no longer follow the lecture they are notes of.
  const n = raw({
    sections: [
      { heading: "First", body: "a" },
      { heading: "Second", body: "b" },
      { heading: "Third", body: "c" },
    ],
  });
  assert.deepEqual(n.sections.map((s) => s.heading), ["First", "Second", "Third"]);
});

test("an untitled section is kept, because it is still the lecture", () => {
  const n = raw({ sections: [{ heading: "", body: "The whole lecture as one block." }] });
  assert.equal(n.sections.length, 1);
  assert.equal(n.sections[0].heading, "");
});

test("a repeated section is kept once", () => {
  const n = raw({
    sections: [
      { heading: "Eigen", body: "Same thing." },
      { heading: "Eigen", body: "Same thing." },
      { heading: "Eigen", body: "A different part of it." },
    ],
  });
  assert.equal(n.sections.length, 2);
});

test("a formula with no expression is dropped, and no label is fine", () => {
  // A formula box with nothing in it is the emptiest thing a page can hold.
  const n = raw({
    formulas: [
      { label: "Named", expression: "Av = λv" },
      { label: "Bare", expression: "" },
      { label: "", expression: "det(A - λI) = 0" },
    ],
  });
  assert.deepEqual(n.formulas.map((f) => f.expression), ["Av = λv", "det(A - λI) = 0"]);
});

test("a repeated formula is kept once", () => {
  const n = raw({
    formulas: [
      { label: "One name", expression: "Av = λv" },
      { label: "Another name", expression: "av = λv" },
    ],
  });
  assert.equal(n.formulas.length, 1);
});

test("repeated takeaways are kept once", () => {
  const n = raw({ takeaways: ["It holds.", "it holds.", "And it is fast."] });
  assert.deepEqual(n.takeaways, ["It holds.", "And it is fast."]);
});

test("nothing is required", () => {
  // A lecture with no formulas and no takeaways is still a lecture, and failing
  // the read over it would throw away the one part that was fine.
  const n = raw({ sections: [{ heading: "Only", body: "Text." }] });
  assert.equal(n.sections.length, 1);
  assert.deepEqual(n.formulas, []);
  assert.deepEqual(n.takeaways, []);
  assert.equal(n.overview, "");
});

test("an entirely empty reply tidies to an empty result, not an error", () => {
  const n = raw();
  assert.deepEqual(n, {
    overview: "",
    sections: [],
    tables: [],
    formulas: [],
    takeaways: [],
  });
});