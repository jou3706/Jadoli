import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * The client's writer and the database schema have to agree on every column.
 *
 * The generic writer in src/lib/db/supabase.ts stamps `updated_date` on every
 * row it inserts, and PostgREST rejects the entire row when the table has no
 * such column (PGRST204). That is not a cosmetic mismatch: it failed the whole
 * insert, so adding a material to a course reported "Could not save" while the
 * row never existed and the student had no way to tell why.
 *
 * These tests read the SQL as it is committed, so the two cannot drift apart
 * again without a failure here.
 */

const SCHEMA = new URL("../supabase/schema.sql", import.meta.url);
const MIGRATION = new URL("../supabase/07-updated-date.sql", import.meta.url);
const read = (url: URL) => readFile(url, "utf8");

/**
 * `CreateSubject` in types.ts -> `subjects` in Postgres.
 *
 * Written out rather than derived, because `Attendance` -> `attendance` is not
 * a rule you can generate and a wrong guess here silently checks a table that
 * does not exist.
 */
const TABLE_OF: Record<string, string> = {
  Lecture: "lectures",
  Attendance: "attendance",
  Grade: "grades",
  Hall: "halls",
  Material: "materials",
  Subject: "subjects",
  SubjectEvent: "subject_events",
  UniversityEvent: "university_events",
  Flashcard: "flashcards",
  ReviewSession: "review_sessions",
  Chat: "chats",
  Message: "messages",
};

/** The entities the client writes through the generic writer. */
const CLIENT_ENTITIES = [
  "Lecture",
  "Attendance",
  "Grade",
  "Hall",
  "Material",
  "Subject",
  "SubjectEvent",
  "UniversityEvent",
  "Flashcard",
  "ReviewSession",
  "Chat",
  "Message",
];

/** The columns the writer sends on every insert, whatever the table. */
const ALWAYS_SENT = ["id", "created_date", "updated_date"];

async function tableBody(table: string): Promise<string> {
  const re = new RegExp(
    `create table if not exists public\\.${table} \\(([\\s\\S]*?)\\n\\);`,
    "i",
  );
  const found = (await read(SCHEMA)).match(re);
  assert.ok(found, `${table} has no create table in schema.sql`);
  return found[1];
}

const columns = async (table: string) =>
  (await tableBody(table))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("--"))
    .map((l) => l.split(/[\s(]/)[0]);

test("every table the client writes has updated_date", async () => {
  // This is the exact set that was missing the column and failed to insert.
  for (const entity of CLIENT_ENTITIES) {
    const table = TABLE_OF[entity];
    assert.ok(
      (await columns(table)).includes("updated_date"),
      `public.${table} has no updated_date column, so every insert into it fails with PGRST204`,
    );
  }
});

test("the tables that broke first are the ones now fixed", async () => {
  // Named individually so the failure says which feature broke, not just that
  // something did.
  for (const table of ["materials", "subjects", "attendance", "messages", "flashcards"]) {
    assert.ok(
      (await columns(table)).includes("updated_date"),
      `public.${table} is still missing it`,
    );
  }
});

test("no entity table is missing any column the writer always sends", async () => {
  for (const entity of CLIENT_ENTITIES) {
    const table = TABLE_OF[entity];
    const cols = await columns(table);
    for (const col of ALWAYS_SENT) {
      assert.ok(cols.includes(col), `public.${table} has no ${col} column`);
    }
  }
});

test("user_id is on every table, because RLS compares against it", async () => {
  for (const entity of CLIENT_ENTITIES) {
    const table = TABLE_OF[entity];
    assert.ok(
      (await columns(table)).includes("user_id"),
      `public.${table} has no user_id, so its policy cannot scope rows to one student`,
    );
  }
});

test("row level security is enabled on every table the client writes", async () => {
  const text = await read(SCHEMA);
  for (const entity of CLIENT_ENTITIES) {
    const table = TABLE_OF[entity];
    assert.ok(
      new RegExp(`alter table public\\.${table}\\s+enable row level security`, "i").test(text),
      `public.${table} does not have RLS enabled`,
    );
  }
});

test("updated_date moves on its own, not only when the client sends it", async () => {
  // The client does not stamp it on every edit path, so a column that means
  // "when this row was last touched" needs a trigger to stay true.
  const text = await read(SCHEMA);
  assert.match(text, /create or replace function public\.set_updated_date\(\)/);
  assert.match(text, /before update on public\.%I/);
  // One trigger per table, built by a loop over the same list. The assertion is
  // that the loop exists at all; a table missing from the list is caught by the
  // column tests above.
  assert.match(text, /drop trigger if exists %I_set_updated_date on public\.%I/);
});

test("the migration that fixes a deployed database ends by reloading the cache", async () => {
  // PostgREST answers from a cached schema. A migration that adds a column and
  // does not reload leaves the original PGRST204 in place, which looks exactly
  // like the migration having done nothing.
  const migration = await read(MIGRATION);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
});

test("the migration adds the column to every table that lacked it", async () => {
  const migration = await read(MIGRATION);
  for (const table of ["attendance", "materials", "subjects", "messages"]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table}\\s+add column if not exists updated_date`, "i"),
      `07-updated-date.sql does not add updated_date to public.${table}`,
    );
  }
});

test("every migration is safe to run twice", async () => {
  // Each file is meant to be pasted by hand and may be pasted again after a
  // half-failure, so nothing may be a bare `create table` or `create column`.
  const files = [
    "../supabase/02-subjects-and-storage.sql",
    "../supabase/05-subject-events.sql",
    "../supabase/06-flashcards-and-review.sql",
    "../supabase/07-updated-date.sql",
  ];
  for (const rel of files) {
    const text = await read(new URL(rel, import.meta.url));
    assert.ok(
      !/^\s*create table (?!if not exists)/im.test(text),
      `${rel} has a create table that would fail on a second run`,
    );
    assert.ok(
      !/add column (?!if not exists)/i.test(text),
      `${rel} has an add column that would fail on a second run`,
    );
  }
});