import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanGeneratedCards,
  dropReasonLabel,
  flashcardPayload,
  isDuplicateCard,
  summariseDrops,
} from "../src/lib/flashcards.ts";
import { extractArray, extractJson } from "../src/lib/ai/extract.ts";

const TODAY = "2026-10-20";

const raw = (question: string, answer: string) => ({ question, answer });

test("a good card is kept as it was written", () => {
  const { cards, dropped } = cleanGeneratedCards([
    raw("ما هو التكامل بالجزاءات؟", "طريقة نحسب بها مساحة تحت المنحنى."),
  ]);
  assert.equal(cards.length, 1);
  assert.equal(dropped.length, 0);
  assert.equal(cards[0].question, "ما هو التكامل بالجزاءات؟");
});

test("the model is allowed to spell the card in its own words", () => {
  const { cards } = cleanGeneratedCards([
    { q: "قانون نيوتن الثاني؟", a: "القوة = الكتلة × التسارع." },
    { front: "Eigenvalue", back: "جذر المصفوفة." },
  ]);
  assert.deepEqual(cards.map((c) => c.question), ["قانون نيوتن الثاني؟", "Eigenvalue"]);
});

test("a card nobody can be asked, or nobody can answer, is dropped", () => {
  const { cards, dropped } = cleanGeneratedCards([
    raw("", ""),
    raw("   ", "إجابة بلا سؤال"),
    raw("سؤال بلا إجابة", "   "),
    raw("سؤال حقيقي", "إجابة"),
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].question, "سؤال حقيقي");
  assert.deepEqual(
    dropped.map((d) => d.dropped),
    ["empty", "no question", "no answer"],
  );
});

test("the same question twice is one card, not two", () => {
  const { cards, dropped } = cleanGeneratedCards([
    raw("اشرح قانون أوم", "جهد = تيار × مقاومة."),
    raw("اشرح  قانون أوم", "الجهد يساوي حاصل ضرب التيار في المقاومة."),
  ]);
  assert.equal(cards.length, 1);
  assert.equal(dropped[0].dropped, "repeated");
});

test("the student gets the cards they asked for and no more", () => {
  const many = Array.from({ length: 14 }, (_, i) => raw(`سؤال ${i}`, `إجابة ${i}`));
  const { cards, dropped } = cleanGeneratedCards(many, { limit: 10 });
  assert.equal(cards.length, 10);
  assert.equal(dropped.length, 4);
  assert.ok(dropped.every((d) => d.dropped === "over the limit"));
});

test("a very long question or answer is cut, not refused", () => {
  const { cards } = cleanGeneratedCards([raw("س".repeat(900), "ج".repeat(2000))]);
  assert.equal(cards[0].question.length, 300);
  assert.equal(cards[0].answer.length, 600);
});

test("a saved card is due today and has never been graded", () => {
  const row = flashcardPayload(
    { question: "ما هو التسارع؟", answer: "التغير في السرعة خلال الزمن." },
    { subject: " فيزياء 2 ", source: "chapter 3 notes.pdf", today: TODAY },
  );
  assert.equal(row.subject_key, "فيزياء 2", "the course name is trimmed, as everywhere else");
  assert.equal(row.question, "ما هو التسارع؟");
  assert.equal(row.source_kind, "typed");
  assert.equal(row.language, "ar");
  assert.equal(row.due_date, TODAY);
  assert.equal(row.interval_days, 0);
  assert.equal(row.reps, 0);
  assert.equal(row.last_review, null);
  assert.equal(row.source, "chapter 3 notes.pdf");
});

test("an uploaded page is remembered as a page, not as typing", () => {
  const row = flashcardPayload(
    { question: "q", answer: "a" },
    { subject: "Calculus", source: "scan.jpg", sourceKind: "notes", today: TODAY },
  );
  assert.equal(row.source_kind, "notes");
  assert.equal(row.last_review, null);
});

test("a card the server already has is a duplicate, not a failure", () => {
  assert.ok(
    isDuplicateCard({ code: "23505", message: "duplicate key value violates unique constraint" }),
  );
  assert.ok(
    isDuplicateCard(new Error("duplicate key value violates unique constraint")),
    "the same answer arrives as a plain Error from the local layer",
  );
  assert.ok(
    isDuplicateCard({ code: "23505", message: "" }),
    "the code is the reliable half; the message may be missing or translated",
  );
  assert.ok(
    !isDuplicateCard({ code: "42501", message: "new row violates row-level security policy" }),
    "refused by policy is a real failure, not a duplicate",
  );
  assert.ok(!isDuplicateCard(new Error("offline")));
});

test("what was dropped is counted by reason, in words the app can show", () => {
  const { dropped } = cleanGeneratedCards([
    raw("", ""),
    raw("q1", ""),
    raw("q2", ""),
  ]);
  assert.deepEqual(summariseDrops(dropped), [
    { reason: "empty", count: 1 },
    { reason: "no answer", count: 2 },
  ]);
  assert.equal(dropReasonLabel("no answer", "ar"), "من غير إجابة");
  assert.equal(dropReasonLabel("no answer", "en"), "no answer");
  assert.equal(dropReasonLabel("something new", "ar"), "اتخطى");
});

test("JSON is found in a reply that has it fenced, wrapped, or explained", () => {
  assert.deepEqual(extractArray('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(extractArray('Here you go:\n[{"a":1}]'), [{ a: 1 }]);
  assert.deepEqual(
    extractArray('[{"answer":"a } brace inside a string"},{"a":2}]'),
    [{ answer: "a } brace inside a string" }, { a: 2 }],
  );
  assert.deepEqual(extractArray('[{ "a": "say \\"hi\\"" }]'), [{ a: 'say "hi"' }]);
});

test("one card where a list was asked for is still an answer", () => {
  assert.deepEqual(extractArray('{"question":"q","answer":"a"}'), [
    { question: "q", answer: "a" },
  ]);
});

test("a reply with no JSON in it yields nothing instead of throwing", () => {
  assert.deepEqual(extractArray("I can't read that file, sorry."), []);
  assert.deepEqual(extractArray(""), []);
  assert.equal(extractJson("no braces here"), null);
  assert.equal(extractJson('[{"a":1'), null, "a truncated array is not half a card");
});