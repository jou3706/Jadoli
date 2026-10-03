import { test } from "node:test";
import assert from "node:assert/strict";
import { newQuestions, questionKey, questionPayload } from "../src/lib/quiz-bank.ts";
import type { QuizQuestion } from "../src/lib/ai/schema.ts";

const q = (question: string, answer = "a"): QuizQuestion => ({
  type: "short",
  question,
  answer,
});

test("questionKey ignores case and extra spaces", () => {
  assert.equal(questionKey("OS", "What  is  a process?"), questionKey("os", "what is a process?"));
});

test("a question already in the bank is not saved again", () => {
  const existing = [{ subject_key: "OS", question: "What is a process?" }];
  const fresh = newQuestions([q("what is a process?")], existing, "OS");
  assert.equal(fresh.length, 0);
});

test("the same question twice in one batch is saved once", () => {
  const fresh = newQuestions([q("What is a process?"), q("what is  a process?")], [], "OS");
  assert.equal(fresh.length, 1);
});

test("the same question under a different course is kept", () => {
  const existing = [{ subject_key: "OS", question: "What is a process?" }];
  const fresh = newQuestions([q("What is a process?")], existing, "Networks");
  assert.equal(fresh.length, 1);
});

test("a blank question is dropped", () => {
  const fresh = newQuestions([q("   ")], [], "OS");
  assert.equal(fresh.length, 0);
});

test("questionPayload fills the bank row", () => {
  const row = questionPayload(
    {
      type: "mcq",
      question: "  Which is a process?  ",
      options: ["a", " b ", ""],
      answer: "a",
      explanation: "because",
    },
    { subjectKey: " OS ", source: "lec 1.pdf" },
  );
  assert.equal(row.subject_key, "OS");
  assert.equal(row.question, "Which is a process?");
  assert.deepEqual(row.options, ["a", "b"]);
  assert.equal(row.type, "mcq");
  assert.equal(row.source, "lec 1.pdf");
});

test("questionPayload gives a non-mcq an empty options list", () => {
  const row = questionPayload({ type: "truefalse", question: "q", answer: "true" }, {
    subjectKey: "OS",
    source: "",
  });
  assert.deepEqual(row.options, []);
});
