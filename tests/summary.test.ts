import { test } from "node:test";
import assert from "node:assert/strict";
import { tidySummary, summarySchema } from "../src/lib/ai/summary.ts";

const parse = (raw: unknown) => tidySummary(summarySchema.parse(raw));

test("the three parts survive a good reply", () => {
  const out = parse({
    summary: "  The file covers\n\ntwo chapters.  ",
    key_points: ["Fourier transforms", ""],
    glossary: [{ term: "Convolution", meaning: "multiplying in the frequency domain" }],
  });
  assert.equal(out.summary, "The file covers\n\ntwo chapters.");
  assert.deepEqual(out.keyPoints, ["Fourier transforms"]);
  assert.equal(out.glossary.length, 1);
});

test("a glossary that repeats a term keeps the first meaning", () => {
  const out = parse({
    glossary: [
      { term: "Eigenvector", meaning: "a vector that keeps its direction" },
      { term: "eigenvector", meaning: "something else" },
    ],
  });
  assert.equal(out.glossary.length, 1);
  assert.match(out.glossary[0].meaning, /keeps its direction/);
});

test("an entry missing half of itself is dropped", () => {
  const out = parse({
    glossary: [{ term: "Kernel", meaning: "" }, { term: "", meaning: "nothing" }],
  });
  assert.deepEqual(out.glossary, []);
});

test("a summary with nothing else is still a summary", () => {
  const out = parse({ summary: "Two chapters, one of them scanned." });
  assert.equal(out.summary, "Two chapters, one of them scanned.");
  assert.deepEqual(out.keyPoints, []);
  assert.deepEqual(out.glossary, []);
});

test("an empty reply is empty, not a crash", () => {
  const out = parse({});
  assert.equal(out.summary, "");
});

test("a reply of the wrong shape is refused rather than half-read", () => {
  // A number where a paragraph belongs means the model ignored the contract;
  // the route answers 502 and the student tries again, which is better than
  // rendering "42" as the summary.
  assert.equal(summarySchema.safeParse("a string").success, false);
  assert.equal(summarySchema.safeParse({ summary: 42 }).success, false);
  assert.equal(summarySchema.safeParse({ key_points: "one" }).success, false);
});