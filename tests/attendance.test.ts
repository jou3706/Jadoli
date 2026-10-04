import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTENDANCE_THRESHOLD,
  attendanceByCourse,
  lectureChances,
  trackedWeeks,
} from "../src/lib/attendance.ts";
import type { Attendance, Lecture } from "../src/lib/db/types.ts";

const lecture = (id: string, subject: string, created = "2026-01-04"): Lecture =>
  ({
    id,
    subject_name: subject,
    subject_en: "",
    code: "",
    doctor: "",
    hall: "",
    day: 0,
    start_time: "08:00",
    end_time: "09:00",
    kind: "lecture",
    color: "",
    notes: "",
    department: "",
    created_date: created,
  }) as Lecture;

const here = (id: string, week: string): Attendance =>
  ({
    id: `a-${id}-${week}`,
    lecture_id: id,
    date: week,
    week_start: week,
  }) as Attendance;

// 2026-01-04 is a Sunday, so these are consecutive Egyptian weeks.
const W = ["2026-01-04", "2026-01-11", "2026-01-18", "2026-01-25"];
const THIS = W[3];

test("the current week counts as a chance even before it is marked", () => {
  const records = [here("l1", W[0]), here("l1", "2026-02-01")];
  assert.deepEqual(trackedWeeks(records, THIS), [W[0], THIS]);
});

test("a weekly session gets one chance per tracked week since it was added", () => {
  const l = lecture("l1", "Maths", W[1]);
  assert.equal(lectureChances(l, W, W[0]), 3, "added in week 2 of 4");
  assert.equal(lectureChances(lecture("l2", "Maths", W[0]), W, W[0]), 4);
});

test("two sessions of one course share one allowance", () => {
  // 12 chances across a morning and an afternoon section, 10 attended.
  const lectures = [lecture("l1", "Maths"), lecture("l2", "Maths")];
  const records = W.flatMap((w) => [here("l1", w), here("l2", w)]).slice(0, 10);
  const [course] = attendanceByCourse(lectures, records, THIS);
  assert.equal(course.chances, 8, "two sections over four weeks");
  assert.equal(course.attended, 8);
  assert.equal(course.pct, 1);
});

test("sitting exactly on the line leaves no room for a miss", () => {
  const lectures = [lecture("l1", "Maths")];
  const records = W.slice(0, 3).map((w) => here("l1", w));
  const [course] = attendanceByCourse(lectures, records, THIS);
  assert.equal(course.pct, ATTENDANCE_THRESHOLD);
  assert.equal(course.margin, 0);
  // 3 attended over 4 sessions: missing one more makes 3/5, under the line.
  assert.equal(course.allowance, 0);
  assert.equal(course.risk, "risk", "no slack is not a safe place to be");
});

test("a full record allows misses in proportion to the slack", () => {
  const lectures = [lecture("l1", "Maths")];
  const records = W.map((w) => here("l1", w));
  const [course] = attendanceByCourse(lectures, records, THIS);
  assert.equal(course.risk, "safe");
  // 4 attended: 4 / (4 + k) >= 0.75 holds up to k = 1.
  assert.equal(course.allowance, 1);
});

test("a course already under the line has a negative allowance", () => {
  const lectures = [lecture("l1", "Maths")];
  const records = W.slice(0, 2).map((w) => here("l1", w));
  const [course] = attendanceByCourse(lectures, records, THIS);
  // Three chances: the two marked weeks and this one, which carries no record.
  assert.equal(course.chances, 3);
  assert.ok(course.pct < ATTENDANCE_THRESHOLD);
  assert.equal(course.risk, "risk");
  assert.ok(course.allowance < 0, "no number of extra misses gets it back to the line");
});

test("a repeated record in one week is one attendance", () => {
  const lectures = [lecture("l1", "Maths")];
  const records = [here("l1", W[0]), here("l1", W[0]), here("l1", W[1])];
  const [course] = attendanceByCourse(lectures, records, THIS);
  assert.equal(course.attended, 2, "not 3");
});

test("courses are listed worst first, because that is the one worth reading", () => {
  const lectures = [lecture("l1", "Physics"), lecture("l2", "Maths"), lecture("l3", "Art")];
  const records = [
    ...W.map((w) => here("l1", w)),
    ...W.slice(0, 3).map((w) => here("l2", w)),
    ...W.slice(0, 1).map((w) => here("l3", w)),
  ];
  const order = attendanceByCourse(lectures, records, THIS).map((c) => c.subjectKey);
  assert.deepEqual(order, ["Art", "Maths", "Physics"], "25% before 75% before 100%");
});

test("a lecture with no subject name is not a course", () => {
  const lectures = [lecture("l1", "   ")];
  assert.deepEqual(attendanceByCourse(lectures, [here("l1", W[0])], THIS), []);
});

test("a course with nothing tracked is left out rather than shown as zero", () => {
  // A lecture added last week has no chance to have been missed yet.
  const lectures = [lecture("l1", "Maths", "2026-02-01")];
  assert.deepEqual(attendanceByCourse(lectures, [], THIS), []);
});