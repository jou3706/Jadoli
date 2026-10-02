import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countdownLabel,
  daysUntil,
  eventsForSubject,
  isDuplicateEvent,
  kindClass,
  kindLabel,
  sameSubject,
  splitByToday,
  todayISO,
} from "../src/lib/subject-events.ts";
import { ENTITY_NAMES } from "../src/lib/db/types.ts";
import type { SubjectEvent } from "../src/lib/db/types.ts";

const ev = (over: Partial<SubjectEvent> = {}): SubjectEvent => ({
  id: "e1",
  subject_key: "Calculus",
  title: "Quiz 1",
  kind: "quiz",
  date: "2026-10-20",
  start_time: "10:00",
  end_time: "10:45",
  hall: "",
  note: "",
  created_date: "2026-10-01T00:00:00Z",
  ...over,
});

test("course names match the way the database matches them", () => {
  assert.equal(sameSubject("Calculus", "calculus"), true, "case is not a different course");
  assert.equal(sameSubject(" Calculus ", "calculus"), true, "nor is surrounding space");
  assert.equal(sameSubject("Calculus", "Physics"), false);
  assert.equal(sameSubject("", "  "), true, "two blanks are the same missing name");
  assert.equal(sameSubject(null, undefined), true, "absent and empty agree");
});

test("only the asked-for course's events come back", () => {
  const events = [
    ev({ id: "a", subject_key: "Calculus" }),
    ev({ id: "b", subject_key: "Physics", title: "Midterm" }),
    ev({ id: "c", subject_key: "  calculus  ", title: "Quiz 2" }),
  ];
  const mine = eventsForSubject(events, "CALCULUS");
  assert.deepEqual(
    mine.map((e) => e.id),
    ["a", "c"],
  );
});

test("events come back soonest first, timed ones ahead of untimed", () => {
  const events = [
    ev({ id: "late", date: "2026-11-02", start_time: "09:00" }),
    ev({ id: "untimed", date: "2026-10-15", start_time: "" }),
    ev({ id: "early", date: "2026-10-15", start_time: "08:00" }),
  ];
  assert.deepEqual(
    eventsForSubject(events, "Calculus").map((e) => e.id),
    ["early", "untimed", "late"],
  );
});

test("the order does not shift between renders of the same data", () => {
  const events = [
    ev({ id: "b", title: "B", date: "2026-10-20", start_time: "10:00" }),
    ev({ id: "a", title: "A", date: "2026-10-20", start_time: "10:00" }),
  ];
  const once = eventsForSubject(events, "Calculus").map((e) => e.id);
  const twice = eventsForSubject([...events].reverse(), "Calculus").map((e) => e.id);
  assert.deepEqual(once, twice, "same events, same order, whichever way round they arrive");
  assert.deepEqual(once, ["a", "b"], "ties break on the title");
});

test("all of a course's events are offered, not just today's", () => {
  // The point of looking at a course is finding out what is coming, so an
  // exam three weeks out has to be visible while you decide what to drop.
  const events = [
    ev({ id: "past", date: "2026-10-01" }),
    ev({ id: "soon", date: "2026-10-20" }),
    ev({ id: "later", date: "2026-12-01" }),
  ];
  assert.deepEqual(
    eventsForSubject(events, "Calculus").map((e) => e.id),
    ["past", "soon", "later"],
  );
});

test("upcoming and past are separated on today's date", () => {
  const events = [
    ev({ id: "before", date: "2026-10-19" }),
    ev({ id: "today", date: "2026-10-20" }),
    ev({ id: "after", date: "2026-10-21" }),
  ];
  const { upcoming, past } = splitByToday(events, "2026-10-20");
  assert.deepEqual(
    upcoming.map((e) => e.id),
    ["today", "after"],
    "today counts as upcoming, not as past",
  );
  assert.deepEqual(
    past.map((e) => e.id),
    ["before"],
  );
});

test("day counts are whole days, and a bad date is zero rather than NaN", () => {
  assert.equal(daysUntil("2026-10-20", "2026-10-20"), 0);
  assert.equal(daysUntil("2026-10-21", "2026-10-20"), 1);
  assert.equal(daysUntil("2026-10-19", "2026-10-20"), -1);
  assert.equal(daysUntil("2026-11-20", "2026-10-20"), 31);
  assert.equal(daysUntil("not-a-date", "2026-10-20"), 0, "no NaN reaching the screen");
});

test("the countdown says the words people want, not a number of days", () => {
  assert.equal(countdownLabel("2026-10-20", "2026-10-20", "en"), "today");
  assert.equal(countdownLabel("2026-10-21", "2026-10-20", "en"), "tomorrow");
  assert.equal(countdownLabel("2026-10-19", "2026-10-20", "en"), "yesterday");
  assert.equal(countdownLabel("2026-10-23", "2026-10-20", "en"), "in 3d");
  assert.equal(countdownLabel("2026-10-20", "2026-10-20", "ar"), "النهارده");
  assert.equal(countdownLabel("2026-10-23", "2026-10-20", "ar"), "بعد 3 يوم");
});

test("a date far enough out reads as a date, since a day count stops helping", () => {
  // "in 94d" is arithmetic, not information. The date is what a person wants.
  const far = countdownLabel("2027-01-22", "2026-10-20", "en");
  assert.doesNotMatch(far, /in \d+d/, "too far out for a countdown");
});

test("an unknown kind still gets a label and a colour", () => {
  assert.equal(kindLabel("quiz", "ar"), "كويز");
  assert.equal(kindLabel("exam", "en"), "Exam");
  assert.equal(kindLabel("something-new", "en"), "Event", "never renders blank");
  assert.equal(kindLabel("something-new", "ar"), "حدث");
  assert.ok(kindClass("something-new"), "never renders an undefined class");
  assert.equal(kindClass("quiz"), kindClass("quiz"), "stable for a known kind");
});

test("today is written in the shape the rows are stored in", () => {
  // A local date, not a UTC one: toISOString would roll back a day for anyone
  // east of Greenwich in the evening, and the app is Arabic-first.
  const iso = todayISO(new Date(2026, 9, 5));
  assert.equal(iso, "2026-10-05");
  const single = todayISO(new Date(2026, 0, 9));
  assert.equal(single, "2026-01-09", "months and days are padded");
});

test("subject events are a registered entity, so they are stored and synced", () => {
  // ENTITY_NAMES is what the local database, the offline snapshot and the
  // outbox each walk. An event that is not in it is an event that exists on the
  // server and nowhere else: no offline read, no replay, no other tab.
  assert.ok(
    ENTITY_NAMES.includes("SubjectEvent"),
    "events must be in ENTITY_NAMES or they are not offline data",
  );
});

test("a refused duplicate reads as the row already being there", () => {
  // The database refuses a second copy of the same event on the same day. The
  // person should be told that plainly, not shown the raw database complaint.
  assert.equal(
    isDuplicateEvent(new Error('Supabase 409: {"code":"23505"} duplicate key value')),
    true,
  );
  assert.equal(isDuplicateEvent(new Error("offline: could not reach the server")), false);
  assert.equal(isDuplicateEvent(new Error('Supabase 400: {"column":"hall"} bad')), false);
});