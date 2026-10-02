import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_END,
  DAY_START,
  MIN_SLOT_MINUTES,
  freeSlots,
  minutesToTime,
  overlaps,
  upcomingDays,
} from "../src/lib/gaps.ts";

const busy = (start_time: string, end_time: string) => ({ start_time, end_time });
const times = (slots: { start: string; end: string }[]) =>
  slots.map((s) => `${s.start}-${s.end}`);

test("an empty day is one long gap", () => {
  assert.deepEqual(times(freeSlots([])), [`${DAY_START}-${DAY_END}`]);
  assert.equal(freeSlots([])[0].minutes, 14 * 60);
});

test("a lecture takes its slice out of the day", () => {
  assert.deepEqual(
    times(freeSlots([busy("10:00", "12:00")])),
    ["08:00-10:00", "12:00-22:00"],
  );
  assert.deepEqual(
    times(freeSlots([busy("10:00", "12:00"), busy("14:00", "15:00")])),
    ["08:00-10:00", "12:00-14:00", "15:00-22:00"],
  );
});

test("two lectures that clash leave no hole between them", () => {
  // The ordinary case after a bad import, and the reason ranges are merged
  // rather than subtracted one at a time.
  const slots = freeSlots([busy("10:00", "12:00"), busy("11:00", "13:00")]);
  assert.deepEqual(times(slots), ["08:00-10:00", "13:00-22:00"]);
  assert.equal(
    freeSlots([busy("10:00", "11:00"), busy("11:00", "12:00")]).length,
    2,
    "touching lectures are one busy block, not two",
  );
});

test("a gap too small to be useful is not offered", () => {
  // The ten minutes between these two is not a session; the two hours before and
  // the four after are, and a planner that threw those away would be wrong in
  // the other direction.
  assert.deepEqual(
    times(freeSlots([busy("09:00", "10:00"), busy("10:10", "18:00")])),
    ["08:00-09:00", "18:00-22:00"],
  );
  assert.deepEqual(
    times(freeSlots([busy("09:00", "10:00"), busy("10:20", "18:00")])),
    ["08:00-09:00", "10:00-10:20", "18:00-22:00"],
    "exactly twenty minutes is a session, which is the minimum on purpose",
  );
  assert.equal(MIN_SLOT_MINUTES, 20);
  assert.deepEqual(
    times(freeSlots([busy("09:00", "10:00"), busy("10:20", "18:00")], { minMinutes: 30 })),
    ["08:00-09:00", "18:00-22:00"],
    "and a longer session needs a longer hole",
  );
});

test("lectures outside the day are clipped, not ignored", () => {
  assert.deepEqual(times(freeSlots([busy("06:00", "09:00")])), ["09:00-22:00"]);
  assert.deepEqual(times(freeSlots([busy("21:00", "23:30")])), ["08:00-21:00"]);
  assert.deepEqual(times(freeSlots([busy("05:00", "23:00")])), [], "all day busy");
});

test("a range that runs backwards is a mistake, not a free day", () => {
  assert.deepEqual(
    times(freeSlots([busy("12:00", "10:00")])),
    [`${DAY_START}-${DAY_END}`],
  );
  assert.deepEqual(times(freeSlots([busy("10:00", "10:00")])), [`${DAY_START}-${DAY_END}`]);
  assert.deepEqual(times(freeSlots([busy("", "")])), [`${DAY_START}-${DAY_END}`]);
});

test("a lecture that starts after the day ends does not extend it", () => {
  assert.deepEqual(
    times(freeSlots([busy("23:00", "24:00")])),
    [`${DAY_START}-${DAY_END}`],
    "clipped to nothing, so it takes nothing: the evening is not free time",
  );
  assert.deepEqual(
    times(freeSlots([busy("23:00", "24:00"), busy("12:00", "14:00")])),
    [`${DAY_START}-12:00`, `14:00-${DAY_END}`],
    "the real lecture still splits the day",
  );
  assert.deepEqual(
    times(freeSlots([busy("03:00", "05:00")], { start: "09:00", end: "17:00" })),
    ["09:00-17:00"],
    "and the same at the other end of the day",
  );
});

test("the day can be asked for, when a student's day is not eight to ten", () => {
  assert.deepEqual(
    times(freeSlots([busy("09:00", "10:00")], { start: "07:00", end: "12:00" })),
    ["07:00-09:00", "10:00-12:00"],
  );
  assert.deepEqual(freeSlots([], { start: "22:00", end: "08:00" }), [], "an inverted day is no day");
});

test("two things are on top of each other when they share a minute", () => {
  assert.ok(overlaps(busy("10:00", "12:00"), busy("11:00", "13:00")));
  assert.ok(!overlaps(busy("10:00", "12:00"), busy("12:00", "13:00")), "back to back is not a clash");
  assert.ok(!overlaps(busy("10:00", "12:00"), busy("09:00", "10:00")));
  assert.ok(!overlaps(busy("12:00", "10:00"), busy("10:30", "11:00")), "a broken range clashes with nothing");
  assert.ok(!overlaps(null, busy("10:00", "11:00")));
});

test("minutes and times are two ways of writing the same thing", () => {
  assert.equal(minutesToTime(0), "00:00");
  assert.equal(minutesToTime(510), "08:30");
  assert.equal(minutesToTime(1439), "23:59");
});

test("the days ahead are named with the weekday the timetable uses", () => {
  // 2026-10-20 is a Tuesday, and 0 is Sunday in `Lecture.day`.
  assert.deepEqual(upcomingDays("2026-10-20", 1), [{ date: "2026-10-20", day: 2 }]);
  assert.deepEqual(upcomingDays("2026-10-20", 3).map((d) => d.day), [2, 3, 4]);
  assert.deepEqual(upcomingDays("2026-10-24", 2), [
    { date: "2026-10-24", day: 6 },
    { date: "2026-10-25", day: 0 },
  ]);
  assert.deepEqual(upcomingDays("2026-10-20", 0), []);
  assert.deepEqual(upcomingDays("2026-10-31", 2).map((d) => d.date), [
    "2026-10-31",
    "2026-11-01",
  ]);
});