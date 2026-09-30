import { test } from "node:test";
import assert from "node:assert/strict";
import { buildContext, withContext } from "../src/lib/ai/context.ts";
import type { Grade, Lecture, Material, UniversityEvent } from "../src/lib/db/types.ts";

const now = new Date("2026-03-04T10:00:00");

const lectures: Lecture[] = [
  {
    id: "l1",
    subject_name: "Physics 2",
    day: 1,
    start_time: "10:00",
    end_time: "12:00",
    hall: "A1",
  },
  {
    id: "l2",
    subject_name: "Chemistry",
    day: 2,
    start_time: "09:00",
    end_time: "11:00",
  },
] as Lecture[];

const grades: Grade[] = [
  {
    id: "g1",
    subject_name: "Physics 2",
    credit_hours: 3,
    letter: "A",
    grade_point: 4,
  },
] as Grade[];

const events: UniversityEvent[] = [
  { id: "e1", date: "2026-03-20", type: "exam", title: "Midterm" },
] as UniversityEvent[];

const materials: Material[] = [
  {
    id: "m1",
    title: "Chapter 3 summary",
    subject_key: "Physics 2",
    url: "https://example.com/s.pdf",
    type: "pdf",
  },
  {
    id: "m2",
    title: "Loose cheat sheet",
    subject_key: "",
    url: "https://example.com/x",
    type: "link",
  },
] as Material[];

const data = { lectures, grades, events, materials, now, lang: "ar" as const };

test("general mode feeds the assistant the whole timetable", () => {
  const out = buildContext(data);
  assert.match(out, /mode: general/);
  assert.match(out, /lectures:/);
  assert.match(out, /grades:/);
  assert.match(out, /cumulative_gpa: 4.00/);
  assert.match(out, /upcoming_events:/);
  assert.match(out, /Midterm/);
  assert.match(out, /materials:/);
});

test("materials mode injects no schedule, grades or events at all", () => {
  const out = buildContext({ ...data, mode: "materials" });
  assert.match(out, /mode: materials/);
  assert.match(out, /materials:/);
  assert.match(out, /Chapter 3 summary/);
  assert.match(out, /courses:/);
  assert.match(out, /Physics 2/, "the course list is still available");

  // The point of the mode: these must not be present.
  assert.doesNotMatch(out, /lectures:/);
  assert.doesNotMatch(out, /grades:/);
  assert.doesNotMatch(out, /cumulative_gpa/);
  assert.doesNotMatch(out, /upcoming_events:/);
  assert.doesNotMatch(out, /Midterm/);
  assert.doesNotMatch(out, /A1/, "hall names come from the timetable");
  assert.doesNotMatch(out, /10:00-12:00/);
  assert.doesNotMatch(out, /letter=A/);
});

test("materials mode tells the model when the list is empty", () => {
  const out = buildContext({ ...data, materials: [], mode: "materials" });
  assert.match(out, /materials:\n\(none saved yet\)/);
  assert.match(out, /courses:\n- Physics 2\n- Chemistry/);
});

test("materials mode carries material ids so they can be referenced", () => {
  const out = buildContext({ ...data, mode: "materials" });
  assert.match(out, /id=m1/);
  assert.match(out, /id=m2/);
});

test("the general context caps how many materials are sent", () => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    id: `m${i}`,
    title: `Doc ${i}`,
    subject_key: "Physics",
    url: `https://example.com/${i}`,
    type: "link",
  })) as Material[];
  const out = buildContext({ ...data, materials: many, mode: "general" });
  assert.match(out, /Doc 39/);
  assert.doesNotMatch(out, /Doc 40/);
});

test("withContext wraps the data in a tag and keeps the question", () => {
  const wrapped = withContext("what is next?", "materials:\n- x");
  assert.equal(
    wrapped,
    "<student_data>\nmaterials:\n- x\n</student_data>\n\nwhat is next?",
  );
});
