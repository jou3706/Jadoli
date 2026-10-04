import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFixes, parseVerdict, verdictInput } from "../src/lib/ai/quiz-verify.ts";
import type { QuizSet } from "../src/lib/ai/schema.ts";

const set = (): QuizSet => ({
  title: "exam",
  questions: [
    {
      type: "mcq",
      question: "capital of France?",
      options: ["Paris", "Rome", "Berlin", "Madrid"],
      answer: "Paris",
    },
    {
      type: "mcq",
      question: "2 + 2?",
      options: ["3", "4", "5", "6"],
      answer: "5",
    },
    {
      type: "truefalse",
      question: "water boils at 100C at sea level",
      answer: "true",
    },
    { type: "short", question: "capital of Japan", answer: "Tokyo" },
  ],
});

test("the checker is shown the marked answer, numbered from zero", () => {
  const input = verdictInput(set());
  assert.match(input, /0\. \[mcq\] capital of France\?/);
  assert.match(input, /- Paris/);
  assert.match(input, /marked answer: Paris/);
});

test("a correction is read out of the reply", () => {
  const fixes = parseVerdict('{"fixes":[{"i":1,"answer":"4"}]}');
  assert.deepEqual(fixes, [{ index: 1, answer: "4" }]);
});

test("the reply shape does not have to be exactly right", () => {
  const expected = [{ index: 1, answer: "4" }];
  assert.deepEqual(parseVerdict('{"corrections":[{"index":1,"correct":"4"}]}'), expected);
  assert.deepEqual(parseVerdict('[{"n":1,"correctAnswer":"4"}]'), expected);
  assert.deepEqual(parseVerdict('Sure:\n```json\n{"fixes":[{"i":1,"answer":"4"}]}\n```'), expected);
});

test("an unusable reply means no corrections, not an error", () => {
  assert.deepEqual(parseVerdict("the key looks correct to me"), []);
  assert.deepEqual(parseVerdict(""), []);
  assert.deepEqual(parseVerdict('{"fixes":"none"}'), []);
  assert.deepEqual(parseVerdict('{"fixes":[{"i":"first","answer":"4"}]}'), []);
  assert.deepEqual(parseVerdict('{"fixes":[{"i":1}]}'), []);
});

test("a question cannot be corrected twice", () => {
  assert.deepEqual(parseVerdict('{"fixes":[{"i":0,"answer":"Rome"},{"i":0,"answer":"Paris"}]}'), [
    { index: 0, answer: "Rome" },
  ]);
});

test("a correction is applied only when it names one of the options", () => {
  const out = applyFixes(set(), [{ index: 1, answer: "4" }]);
  assert.equal(out.applied, 1);
  assert.equal(out.set.questions[1].answer, "4");
  assert.equal(out.set.questions[0].answer, "Paris", "other questions are untouched");
});

test("the correction is stored as the option's own text", () => {
  const out = applyFixes(set(), [{ index: 1, answer: "  4 " }]);
  assert.equal(out.set.questions[1].answer, "4");
});

test("a correction that invents an answer is ignored", () => {
  const out = applyFixes(set(), [{ index: 1, answer: "Seven" }]);
  assert.equal(out.applied, 0);
  assert.equal(out.set.questions[1].answer, "5");
});

test("a correction outside the exam is ignored", () => {
  assert.equal(applyFixes(set(), [{ index: 99, answer: "4" }]).applied, 0);
  assert.equal(applyFixes(set(), [{ index: -1, answer: "4" }]).applied, 0);
});

test("a short question is never corrected", () => {
  const out = applyFixes(set(), [{ index: 3, answer: "Kyoto" }]);
  assert.equal(out.applied, 0);
  assert.equal(out.set.questions[3].answer, "Tokyo");
});

test("a true/false question is corrected to exactly true or false", () => {
  assert.equal(applyFixes(set(), [{ index: 2, answer: "FALSE" }]).applied, 1);
  assert.equal(applyFixes(set(), [{ index: 2, answer: "yes" }]).applied, 0);
});

test("an exam that came back clean is returned untouched", () => {
  const before = set();
  const out = applyFixes(before, []);
  assert.equal(out.applied, 0);
  assert.equal(out.set, before);
});

test("more corrections than the exam can hold means the checker misread it", () => {
  const out = applyFixes(set(), [
    { index: 0, answer: "Rome" },
    { index: 1, answer: "4" },
    { index: 2, answer: "false" },
    { index: 3, answer: "Kyoto" },
  ]);
  assert.equal(out.applied, 0, "the answer key is left as the writer left it");
  assert.equal(out.set.questions[1].answer, "5");
});