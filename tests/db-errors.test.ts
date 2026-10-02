import { test } from "node:test";
import assert from "node:assert/strict";
import { isUniqueViolation } from "../src/lib/db/errors.ts";

test("a unique index is recognised from the code, or from the message", () => {
  const rows = [
    { code: "23505", message: "duplicate key value violates unique constraint" },
    { code: "23505", message: "" },
    { code: "", message: "duplicate key value violates unique constraint" },
    { code: "", message: 'insert failed: duplicate key' },
    new Error("duplicate key value violates unique constraint flashcards_user_subject_question_key"),
    { code: "23505", details: "Key (user_id, question)=(a, b) already exists." },
  ];
  for (const row of rows) {
    assert.ok(isUniqueViolation(row), `should be a duplicate: ${JSON.stringify(row)}`);
  }
});

test("everything else is a real failure, not a duplicate", () => {
  const rows = [
    { code: "42501", message: "new row violates row-level security policy" },
    { code: "PGRST116", message: "no rows found" },
    { code: "23503", message: "foreign key violation" },
    new Error("Failed to fetch"),
    new Error("offline"),
    null,
    undefined,
    "",
  ];
  for (const row of rows) {
    assert.ok(!isUniqueViolation(row), `should not be a duplicate: ${String(row)}`);
  }
});

test("the same error read two ways is still the same answer", () => {
  // The local backend throws an Error, the network layer hands back an object
  // with a code, and an offline retry can produce either. The caller treats a
  // duplicate as "already there", so it has to agree in both directions.
  const asError = new Error("duplicate key value violates unique constraint");
  const asObject = { code: "23505", message: "duplicate key value violates unique constraint" };
  assert.equal(isUniqueViolation(asError), isUniqueViolation(asObject));
});