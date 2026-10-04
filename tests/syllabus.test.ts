import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseEventDate,
  parseEventTime,
  sameEvent,
  syllabusDrafts,
  type RawSyllabusEvent,
} from "../src/lib/ai/syllabus.ts";

const TODAY = "2026-03-01";
const ev = (over: Partial<RawSyllabusEvent> = {}): RawSyllabusEvent => ({
  subject_key: "Maths",
  title: "Midterm",
  kind: "exam",
  date: "2026-03-20",
  start_time: "",
  end_time: "",
  hall: "",
  note: "",
  ...over,
});

test("a date in the stored shape passes straight through", () => {
  assert.equal(parseEventDate("2026-03-20", TODAY), "2026-03-20");
});

test("slashes and a timestamp are read as the same date", () => {
  assert.equal(parseEventDate("2026/3/2", TODAY), "2026-03-02");
  assert.equal(parseEventDate("2026-03-02T09:30:00", TODAY), "2026-03-02");
});

test("a day-first date is day-first, as it is written here", () => {
  assert.equal(parseEventDate("20/03/2026", TODAY), "2026-03-20");
  assert.equal(parseEventDate("20-3-26", TODAY), "2026-03-20");
});

test("a month name is read, and a past one lands in the next year", () => {
  assert.equal(parseEventDate("12 March", TODAY), "2026-03-12");
  assert.equal(parseEventDate("March 12", TODAY), "2026-03-12");
  // January has already gone by when this is read in March.
  assert.equal(parseEventDate("20 January", TODAY), "2027-01-20");
});

test("a date that does not exist is refused rather than rolled over", () => {
  assert.equal(parseEventDate("2026-02-31", TODAY), null);
  assert.equal(parseEventDate("31/02/2026", TODAY), null);
});

test("no date means no row, because nothing can be counted down to it", () => {
  assert.equal(parseEventDate("", TODAY), null);
  assert.equal(parseEventDate("week 7", TODAY), null);
  assert.equal(parseEventDate("next month", TODAY), null);
  assert.equal(parseEventDate("2026-03-20 10:00", TODAY), "2026-03-20");
});

test("a time is normalised or refused", () => {
  assert.equal(parseEventTime("9:05"), "09:05");
  assert.equal(parseEventTime("09.30"), "09:30");
  assert.equal(parseEventTime("9"), "");
  assert.equal(parseEventTime("25:00"), "");
  assert.equal(parseEventTime(""), "");
});

test("an exam gets more warning than a quiz", () => {
  const [exam] = syllabusDrafts([ev({ kind: "exam" })], { today: TODAY });
  const [quiz] = syllabusDrafts([ev({ kind: "quiz" })], { today: TODAY });
  assert.ok(exam.remind_minutes > quiz.remind_minutes);
});

test("the course on the material stands in when the file does not name it", () => {
  const [draft] = syllabusDrafts([ev({ subject_key: "" })], {
    today: TODAY,
    fallbackSubject: "Physics",
  });
  assert.equal(draft.subject_key, "Physics");
});

test("an event with no course at all is left out", () => {
  assert.deepEqual(syllabusDrafts([ev({ subject_key: "  " })], { today: TODAY }), []);
});

test("rows come back in date order, so the next thing due is first", () => {
  const drafts = syllabusDrafts(
    [ev({ title: "Later", date: "2026-04-01" }), ev({ title: "Sooner", date: "2026-03-10" })],
    { today: TODAY },
  );
  assert.deepEqual(drafts.map((d) => d.title), ["Sooner", "Later"]);
});

test("the same line read twice is one row", () => {
  const drafts = syllabusDrafts([ev(), ev({ start_time: "10:00" })], { today: TODAY });
  assert.equal(drafts.length, 1);
});

test("the same title on a different day is a different event", () => {
  const drafts = syllabusDrafts([ev(), ev({ date: "2026-04-01" })], { today: TODAY });
  assert.equal(drafts.length, 2);
});

test("a row with no time has no end time either", () => {
  const [draft] = syllabusDrafts([ev({ end_time: "11:00" })], { today: TODAY });
  assert.equal(draft.start_time, "");
  assert.equal(draft.end_time, "");
});

test("two events are the same when the course, title and day match", () => {
  const a = { subject_key: "Maths", title: "Midterm", date: "2026-03-20" };
  assert.ok(sameEvent(a, { ...a, title: " midterm " }));
  assert.ok(sameEvent(a, { ...a, subject_key: "maths" }));
  assert.ok(!sameEvent(a, { ...a, date: "2026-03-21" }));
  assert.ok(!sameEvent(a, { ...a, subject_key: "Physics" }));
});

test("nothing dated in the file is a valid answer, not a failure", () => {
  const drafts = syllabusDrafts([ev({ date: "week 7" }), ev({ date: "" })], { today: TODAY });
  assert.deepEqual(drafts, []);
});