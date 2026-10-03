import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mcqCorrectIndex,
  parseQuiz,
  quizSourceSchema,
  type QuizQuestion,
} from "../src/lib/ai/schema.ts";

const mcq = (answer: string, options = ["Alpha", "Beta", "Gamma", "Delta"]): QuizQuestion => ({
  type: "mcq",
  question: "q",
  options,
  answer,
});

test("mcq marks the right option when the answer is the full text", () => {
  assert.equal(mcqCorrectIndex(mcq("Gamma")), 2);
});

test("mcq marks the right option when the answer is a letter", () => {
  assert.equal(mcqCorrectIndex(mcq("A")), 0);
  assert.equal(mcqCorrectIndex(mcq("d")), 3);
});

test("mcq marks the right option when the answer is a 1-based number", () => {
  assert.equal(mcqCorrectIndex(mcq("1")), 0);
  assert.equal(mcqCorrectIndex(mcq("4")), 3);
});

test("mcq returns -1 when the answer matches nothing", () => {
  assert.equal(mcqCorrectIndex(mcq("E")), -1);
  assert.equal(mcqCorrectIndex(mcq("none of them")), -1);
  assert.equal(mcqCorrectIndex({ ...mcq("A"), options: [] }), -1);
});

test("parseQuiz reads bare JSON", () => {
  const raw = JSON.stringify({ questions: [{ type: "short", question: "q", answer: "a" }] });
  assert.equal(parseQuiz(raw)?.questions.length, 1);
});

test("parseQuiz reads JSON inside a markdown fence", () => {
  const raw = 'Here you go:\n```json\n{"questions":[{"type":"truefalse","question":"q","answer":"true"}]}\n```';
  assert.equal(parseQuiz(raw)?.questions[0].type, "truefalse");
});

test("parseQuiz reads JSON embedded in prose", () => {
  const raw = 'Sure! {"questions":[{"type":"short","question":"q","answer":"a"}]} hope that helps';
  assert.equal(parseQuiz(raw)?.questions.length, 1);
});

test("parseQuiz returns null for a clarifying question, not a quiz", () => {
  assert.equal(parseQuiz("أي مادة تحب أن أختبرك فيها؟"), null);
});

test("a material quiz needs a material id", () => {
  const r = quizSourceSchema.safeParse({ subjectKey: "OS", source: "material" });
  assert.equal(r.success, false);
});

test("a topic quiz needs a topic", () => {
  const r = quizSourceSchema.safeParse({ subjectKey: "OS", source: "topic" });
  assert.equal(r.success, false);
});

test("a well-formed material quiz passes", () => {
  const r = quizSourceSchema.safeParse({
    subjectKey: "OS",
    source: "material",
    materialId: "2f1b0e5a-1111-4222-8333-444455556666",
    count: 5,
    language: "ar",
  });
  assert.equal(r.success, true);
});
