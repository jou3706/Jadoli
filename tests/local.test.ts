import { test } from "node:test";
import assert from "node:assert/strict";
import { browserStorage, localStorageShim } from "./browser-shim.ts";
import { LocalBackend } from "../src/lib/db/local.ts";

const fresh = () => {
  browserStorage.clear();
  return new LocalBackend();
};

test("creates rows with an id and a timestamp", async () => {
  const db = fresh();
  const row = await db.table("Lecture").create({ subject_name: "Math" });
  assert.ok(row.id, "an id must be generated");
  assert.ok(row.created_date);
  const list = await db.table("Lecture").list();
  assert.equal(list.length, 1);
  assert.equal(list[0].subject_name, "Math");
});

test("returns a copy, so mutating the result cannot corrupt the store", async () => {
  const db = fresh();
  await db.table("Lecture").create({ subject_name: "Math" });
  const first = await db.table("Lecture").list();
  first[0].subject_name = "hacked";
  const second = await db.table("Lecture").list();
  assert.equal(second[0].subject_name, "Math");
});

test("updates by id and rejects unknown ids", async () => {
  const db = fresh();
  const row = await db.table("Lecture").create({ subject_name: "Math" });
  const next = await db.table("Lecture").update(row.id, { hall: "A1" });
  assert.equal(next.hall, "A1");
  assert.equal(next.subject_name, "Math", "a patch must not clear other fields");
  await assert.rejects(() => db.table("Lecture").update("nope", { hall: "A" }));
});

test("filters with equality, ranges and lists", async () => {
  const db = fresh();
  const t = db.table("Lecture");
  await t.create({ subject_name: "A", day: 1 });
  await t.create({ subject_name: "B", day: 3 });
  await t.create({ subject_name: "C", day: 5 });

  assert.equal((await t.filter({ day: 3 })).length, 1);
  assert.equal((await t.filter({ day: { $gte: 3 } })).length, 2);
  assert.equal((await t.filter({ day: { $lte: 1 } })).length, 1);
  assert.equal((await t.filter({ day: { $ne: 1 } })).length, 2);
  assert.equal((await t.filter({ day: { $in: [1, 5] } })).length, 2);
  assert.equal((await t.filter({ subject_name: ["A", "C"] })).length, 2);
  assert.equal((await t.filter({ day: 99 })).length, 0);
});

test("sorts ascending and descending, and keeps nulls last", async () => {
  const db = fresh();
  const t = db.table("Lecture");
  await t.create({ subject_name: "b" });
  await t.create({ subject_name: "a" });
  await t.create({ subject_name: undefined });
  assert.deepEqual(
    (await t.list("subject_name")).map((r) => r.subject_name),
    ["a", "b", undefined],
  );
  assert.deepEqual(
    (await t.list("-subject_name")).map((r) => r.subject_name),
    ["b", "a", undefined],
    "nulls stay at the end in both directions",
  );
});

test("sorts by an array of keys, in order", async () => {
  const db = fresh();
  const t = db.table("Lecture");
  await t.create({ subject_name: "b", day: 1 });
  await t.create({ subject_name: "a", day: 2 });
  await t.create({ subject_name: "a", day: 1 });
  assert.deepEqual(
    (await t.list(["subject_name", "day"])).map((r) => `${r.subject_name}${r.day}`),
    ["a1", "a2", "b1"],
  );
  assert.deepEqual(
    (await t.list(["-day", "subject_name"])).map((r) => `${r.subject_name}${r.day}`),
    ["a2", "a1", "b1"],
    "day 2 first, then the two day-1 rows in name order",
  );
});

test('accepts the explicit "field,desc" form', async () => {
  const db = fresh();
  const t = db.table("Lecture");
  await t.create({ subject_name: "a" });
  await t.create({ subject_name: "b" });
  assert.deepEqual(
    (await t.list("subject_name,desc")).map((r) => r.subject_name),
    ["b", "a"],
  );
  assert.deepEqual(
    (await t.list("subject_name,asc")).map((r) => r.subject_name),
    ["a", "b"],
  );
});

test("honours the limit", async () => {
  const db = fresh();
  const t = db.table("Lecture");
  for (let i = 0; i < 5; i++) await t.create({ subject_name: `s${i}` });
  assert.equal((await t.list(undefined, 3)).length, 3);
});

test("bulkCreate and bulkUpdate write many rows", async () => {
  const db = fresh();
  const t = db.table("Lecture");
  const made = await t.bulkCreate([
    { subject_name: "A" },
    { subject_name: "B" },
  ]);
  assert.equal(made.length, 2);
  assert.notEqual(made[0].id, made[1].id);
  const patched = await t.bulkUpdate([
    { id: made[0].id, hall: "H1" },
    { id: made[1].id, hall: "H2" },
  ]);
  assert.deepEqual(
    patched.map((p) => p.hall),
    ["H1", "H2"],
  );
});

test("bulkUpdate skips ids that are not there", async () => {
  const db = fresh();
  const t = db.table("Lecture");
  const row = await t.create({ subject_name: "A" });
  const out = await t.bulkUpdate([
    { id: row.id, hall: "H1" },
    { id: "ghost", hall: "H9" },
  ]);
  assert.equal(out.length, 1);
  assert.equal((await t.list())[0].hall, "H1");
});

test("deletes one row and many rows", async () => {
  const db = fresh();
  const t = db.table("Lecture");
  const a = await t.create({ subject_name: "A", day: 1 });
  await t.create({ subject_name: "B", day: 1 });
  await t.create({ subject_name: "C", day: 2 });

  await t.delete(a.id);
  assert.equal((await t.list()).length, 2);

  await t.deleteMany({ day: 1 });
  const left = await t.list();
  assert.equal(left.length, 1);
  assert.equal(left[0].subject_name, "C");
});

test("survives a quota error instead of throwing at the user", async () => {
  const db = fresh();
  const t = db.table("Lecture");
  await t.create({ subject_name: "A" });
  // Simulate a full quota on the next write.
  const real = localStorageShim.setItem;
  localStorageShim.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  await t.create({ subject_name: "B" });
  localStorageShim.setItem = real;
  assert.equal((await t.list()).length, 2, "the in-memory copy stays consistent");
});

test("a new instance reads what the previous one wrote", async () => {
  const first = fresh();
  await first.table("Lecture").create({ subject_name: "Persisted" });
  const second = new LocalBackend();
  const rows = await second.table("Lecture").list();
  assert.equal(rows[0].subject_name, "Persisted");
});
