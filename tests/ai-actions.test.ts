import { test } from "node:test";
import assert from "node:assert/strict";
import { clearStorage } from "./browser-shim.ts";
import { applyActions } from "../src/lib/ai/apply-actions.ts";
import { splitAction } from "../src/lib/ai/schema.ts";
import { getBackend } from "../src/lib/db/store.ts";

const reset = () => {
  clearStorage();
  const b = getBackend();
  b.refresh();
  return b;
};

const lectureRows = async () => getBackend().table("Lecture").list();
const gradeRows = async () => getBackend().table("Grade").list();

const goodLecture = {
  subject_name: "Physics",
  day: 2,
  start_time: "08:00",
  end_time: "10:00",
  hall: "A1",
};

test("adds a valid lecture and normalises it", async () => {
  reset();
  const out = await applyActions([{ type: "add_lecture", lecture: goodLecture }]);
  assert.deepEqual(out, [{ ok: true, label: "+ Physics" }]);
  const rows = await lectureRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "lecture", "an unknown kind falls back to lecture");
  assert.ok(rows[0].color, "a colour is always assigned");
  assert.equal(rows[0].created_date !== undefined, true);
});

test("rejects lectures that would corrupt the week table", async () => {
  reset();
  const bad = [
    { ...goodLecture, day: 7 },
    { ...goodLecture, day: -1 },
    { ...goodLecture, day: 1.5 },
    { ...goodLecture, subject_name: "  " },
    { ...goodLecture, start_time: "25:00" },
    { ...goodLecture, end_time: "9:50" },
    { ...goodLecture, start_time: "10:00", end_time: "08:00" },
  ];
  for (const lecture of bad) {
    const out = await applyActions([{ type: "add_lecture", lecture }]);
    assert.equal(out[0].ok, false, `should reject ${JSON.stringify(lecture)}`);
  }
  assert.equal((await lectureRows()).length, 0, "nothing may be written");
});

test("rejects grades with an unknown letter or non-positive hours", async () => {
  reset();
  const cases = [
    { subject_name: "Math", letter: "Z", credit_hours: 3 },
    { subject_name: "Math", letter: "A", credit_hours: 0 },
    { subject_name: "Math", letter: "A", credit_hours: -2 },
    { subject_name: "", letter: "A", credit_hours: 3 },
  ];
  for (const grade of cases) {
    const out = await applyActions([{ type: "add_grade", grade }]);
    assert.equal(out[0].ok, false, `should reject ${JSON.stringify(grade)}`);
  }
  assert.equal((await gradeRows()).length, 0);
});

test("derives the grade point from the letter instead of trusting the model", async () => {
  reset();
  await applyActions([
    {
      type: "add_grade",
      grade: {
        subject_name: "Math",
        letter: "b",
        credit_hours: 3,
        grade_point: 4,
      },
    },
  ]);
  const rows = await gradeRows();
  assert.equal(rows[0].letter, "B", "the letter is upper-cased");
  assert.notEqual(rows[0].grade_point, 4, "a model cannot invent the point value");
  assert.ok(rows[0].grade_point > 0);
});

test("updates an existing lecture and leaves others alone", async () => {
  const db = reset();
  const keep = await db.table("Lecture").create({ subject_name: "Keep", day: 0 });
  const target = await db.table("Lecture").create({
    subject_name: "Old",
    day: 1,
    start_time: "08:00",
    end_time: "10:00",
  });
  const out = await applyActions([
    {
      type: "update_lecture",
      id: target.id,
      fields: { subject_name: "New", start_time: "12:00", end_time: "14:00", day: 3 },
    },
  ]);
  assert.equal(out[0].ok, true);
  const rows = await lectureRows();
  assert.equal(rows.length, 2);
  const updated = rows.find((l) => l.id === target.id);
  assert.equal(updated?.subject_name, "New");
  assert.equal(updated?.start_time, "12:00");
  assert.equal(rows.find((l) => l.id === keep.id)?.subject_name, "Keep");
});

test("a partial update still needs the full lecture to validate", async () => {
  const db = reset();
  const row = await db.table("Lecture").create(goodLecture);
  const out = await applyActions([
    { type: "update_lecture", id: row.id, fields: { start_time: "12:00" } },
  ]);
  assert.equal(out[0].ok, false, "a half-filled lecture must not overwrite the row");
  assert.equal((await lectureRows())[0].start_time, "08:00");
});

test("deleting something that is not there reports a failure", async () => {
  reset();
  const out = await applyActions([{ type: "delete_lecture", id: "ghost" }]);
  assert.equal(out[0].ok, false);
  assert.equal(out[0].label.length > 0, true);
});

test("deletes a real lecture", async () => {
  const db = reset();
  const row = await db.table("Lecture").create(goodLecture);
  const out = await applyActions([{ type: "delete_lecture", id: row.id }]);
  assert.equal(out[0].ok, true);
  assert.equal((await lectureRows()).length, 0);
});

test("an unknown action type is reported, not executed", async () => {
  reset();
  const out = await applyActions([
    { type: "drop_database" },
    { type: "add_lecture", lecture: goodLecture },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].ok, false);
  assert.match(out[0].label, /drop_database/);
  assert.equal(out[1].ok, true, "later valid actions still run");
});

test("splitAction pulls actions out of the visible text", () => {
  const reply = [
    "تمام، ضفت المحاضرة.",
    "",
    "```action",
    '[{"type":"add_lecture","lecture":{"subject_name":"Physics","day":1,',
    '"start_time":"08:00","end_time":"10:00"}}]',
    "```",
  ].join("\n");
  const { visible, actions } = splitAction(reply);
  assert.equal(visible, "تمام، ضفت المحاضرة.");
  assert.equal(actions.length, 1);
  assert.equal((actions[0] as { type: string }).type, "add_lecture");
});

test("splitAction survives a broken code fence", () => {
  const { visible, actions } = splitAction("نص\n```action\n{not json}\n```");
  assert.equal(actions.length, 0);
  assert.equal(visible.includes("{not json}"), false);
});

test("splitAction handles several blocks and a single object", () => {
  const { actions } = splitAction(
    '```action\n[{"type":"a"},{"type":"b"}]\n```\n```action\n{"type":"c"}\n```',
  );
  assert.equal(actions.length, 3);
});

test("materials mode only touches materials", async () => {
  reset();
  const out = await applyActions(
    [
      { type: "delete_lecture", id: "whatever" },
      { type: "add_grade", grade: { subject_name: "Physics", credit_hours: 3, letter: "A" } },
      { type: "add_lecture", lecture: goodLecture },
    ],
    "materials",
  );
  assert.equal(out.length, 3);
  for (const o of out) assert.equal(o.ok, false, "schedule actions are refused");
  assert.equal((await lectureRows()).length, 0, "no lecture was created");
  assert.equal((await gradeRows()).length, 0, "no grade was created");
  assert.match(out[0].label, /not allowed in materials mode/);
});

test("materials mode can save a material and derives its kind", async () => {
  reset();
  const out = await applyActions(
    [
      {
        type: "add_material",
        material: {
          title: "Chapter 3 summary",
          subject_key: "Physics 2",
          url: "https://example.com/paper.pdf",
          type: "totally-made-up",
        },
      },
    ],
    "materials",
  );
  assert.deepEqual(out, [{ ok: true, label: "+ Chapter 3 summary" }]);
  const rows = await getBackend().table("Material").list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, "pdf", "a bogus type is replaced by the guess");
  assert.equal(rows[0].subject_key, "Physics 2");
  const subjects = await getBackend().table("Subject").list();
  assert.equal(subjects.length, 1, "the course gets a card on the subjects page");
  assert.equal(subjects[0].name, "Physics 2");
});

test("adding a material twice does not duplicate the subject", async () => {
  reset();
  await applyActions(
    [
      { type: "add_material", material: { title: "A", subject_key: "Chemistry", url: "https://x.com/a" } },
      { type: "add_material", material: { title: "B", subject_key: "Chemistry", url: "https://x.com/b" } },
    ],
    "materials",
  );
  const subjects = await getBackend().table("Subject").list();
  assert.equal(subjects.length, 1);
  assert.equal((await getBackend().table("Material").list()).length, 2);
});

test("a material needs a title and an http(s) link", async () => {
  reset();
  const out = await applyActions(
    [
      { type: "add_material", material: { title: "  ", url: "https://x.com/a" } },
      { type: "add_material", material: { title: "bad", url: "javascript:alert(1)" } },
      { type: "add_material", material: { title: "bad2", url: "" } },
    ],
    "materials",
  );
  assert.equal(out.length, 3);
  for (const o of out) assert.equal(o.ok, false);
  assert.equal((await getBackend().table("Material").list()).length, 0);
});

test("general mode still refuses actions it does not know", async () => {
  reset();
  const out = await applyActions([{ type: "drop_database" }], "general");
  assert.equal(out.length, 1);
  assert.equal(out[0].ok, false);
});
