import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findConflicts,
  findNext,
  groupBySubject,
  lectureStatus,
  searchLectures,
  sortByWeek,
} from "../src/lib/schedule.ts";
import type { Lecture } from "../src/lib/db/types.ts";

const lecture = (over: Partial<Lecture> = {}): Lecture =>
  ({
    id: "l1",
    subject_name: "Physics",
    subject_en: "Physics",
    code: "PHY101",
    doctor: "Dr. Ahmed",
    hall: "Hall 3",
    day: 0,
    start_time: "08:00",
    end_time: "10:00",
    kind: "lecture",
    color: "",
    notes: "",
    department: "",
    created_date: "2026-09-01T00:00:00.000Z",
    ...over,
  }) as Lecture;

test("flags a lecture that overlaps in time", () => {
  const list = [lecture({ id: "a", start_time: "10:00", end_time: "12:00" })];
  const hit = findConflicts(list, {
    day: 0,
    start_time: "11:00",
    end_time: "13:00",
  });
  assert.equal(hit.length, 1);
});

test("touching lectures are not a conflict", () => {
  const list = [lecture({ start_time: "08:00", end_time: "10:00" })];
  assert.equal(
    findConflicts(list, { day: 0, start_time: "10:00", end_time: "12:00" }).length,
    0,
  );
  assert.equal(
    findConflicts(list, { day: 0, start_time: "06:00", end_time: "08:00" }).length,
    0,
  );
});

test("a fully contained lecture is a conflict", () => {
  const list = [lecture({ start_time: "10:00", end_time: "12:00" })];
  assert.equal(
    findConflicts(list, { day: 0, start_time: "09:00", end_time: "13:00" }).length,
    1,
  );
});

test("the same slot on another day is not a conflict", () => {
  const list = [lecture({ day: 1, start_time: "08:00", end_time: "10:00" })];
  assert.equal(
    findConflicts(list, { day: 4, start_time: "08:00", end_time: "10:00" }).length,
    0,
  );
});

test("an incomplete or inverted draft is not a conflict", () => {
  const list = [lecture()];
  assert.equal(findConflicts(list, { day: 0, start_time: "09:00" }).length, 0);
  assert.equal(findConflicts(list, {}).length, 0);
  assert.equal(
    findConflicts(list, { day: 0, start_time: "12:00", end_time: "10:00" }).length,
    0,
  );
});

test("editing a lecture does not conflict with itself", () => {
  const self = lecture({ id: "me" });
  const hit = findConflicts(
    [self],
    { day: 0, start_time: "08:30", end_time: "09:30" },
    "me",
  );
  assert.equal(hit.length, 0);
});

test("sorts by day then start time", () => {
  const sorted = sortByWeek([
    lecture({ id: "b", day: 3, start_time: "08:00" }),
    lecture({ id: "a", day: 1, start_time: "14:00" }),
    lecture({ id: "c", day: 1, start_time: "09:00" }),
  ]);
  assert.deepEqual(
    sorted.map((l) => l.id),
    ["c", "a", "b"],
  );
});

test("searches the fields students actually search by", () => {
  const list = [
    lecture({ id: "a", subject_name: "فيزياء" }),
    lecture({ id: "b", subject_name: "Chemistry", doctor: "Dr. Mona", code: "CHE2" }),
  ];
  assert.deepEqual(searchLectures(list, "فيزياء").map((l) => l.id), ["a"]);
  assert.deepEqual(searchLectures(list, "mona").map((l) => l.id), ["b"]);
  assert.deepEqual(searchLectures(list, "che2").map((l) => l.id), ["b"]);
  assert.deepEqual(searchLectures(list, "Hall 3").map((l) => l.id), ["a", "b"]);
  assert.equal(searchLectures(list, "").length, 2);
  assert.equal(searchLectures(list, "zzz").length, 0);
});

test("status is only reported for today", () => {
  // 2026-09-30 is a Wednesday (day 3).
  const wed10am = new Date(2026, 8, 30, 10, 0);
  assert.equal(lectureStatus(lecture({ day: 3, start_time: "08:00", end_time: "12:00" }), wed10am), "live");
  assert.equal(lectureStatus(lecture({ day: 3, start_time: "12:00", end_time: "14:00" }), wed10am), "upcoming");
  assert.equal(lectureStatus(lecture({ day: 3, start_time: "06:00", end_time: "08:00" }), wed10am), "past");
  assert.equal(lectureStatus(lecture({ day: 0 }), wed10am), null);
});

test("finds the next lecture, wrapping into next week", () => {
  const wed10am = new Date(2026, 8, 30, 10, 0);
  const res = findNext(
    [
      lecture({ id: "past", day: 3, start_time: "08:00", end_time: "09:00" }),
      lecture({ id: "today", day: 3, start_time: "14:00", end_time: "16:00" }),
      lecture({ id: "later", day: 5, start_time: "10:00", end_time: "12:00" }),
    ],
    wed10am,
  );
  assert.equal(res?.lecture.id, "today");

  const lateNight = new Date(2026, 8, 30, 23, 0);
  const wrapped = findNext(
    [
      lecture({ id: "past", day: 3, start_time: "08:00", end_time: "09:00" }),
      lecture({ id: "sun", day: 0, start_time: "10:00", end_time: "12:00" }),
    ],
    lateNight,
  );
  assert.equal(wrapped?.lecture.id, "sun", "must wrap to the next week");
});

test("groups by subject and keeps week order inside each group", () => {
  const groups = groupBySubject([
    lecture({ id: "a", subject_name: "Math", day: 3, start_time: "10:00" }),
    lecture({ id: "b", subject_name: "Math", day: 1, start_time: "08:00" }),
    lecture({ id: "c", subject_name: "Physics", day: 2 }),
  ]);
  const math = groups.find((g) => g[0].subject_name === "Math");
  assert.deepEqual(math?.map((l) => l.id), ["b", "a"]);
  assert.equal(groups.length, 2);
});
