import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_SUBJECT,
  busyByWeekday,
  planReviewSessions,
  proposalToRow,
  proposalTotals,
} from "../src/lib/review-plan.ts";
import { newCardState, type SrsCard } from "../src/lib/srs.ts";
import { addDays } from "../src/lib/srs.ts";

const TODAY = "2026-10-20"; // a Tuesday
const day = (n: number) => addDays(TODAY, n);

const card = (over: Partial<SrsCard> = {}): SrsCard => ({
  ...newCardState(TODAY),
  id: "c0",
  subject_key: "Calculus",
  question: "What is a derivative?",
  answer: "The slope at a point.",
  created_date: "2026-10-01T00:00:00Z",
  ...over,
});

/** Tuesday and Thursday are lecture days; the rest of the week is free. */
const lecturesByDay: Record<number, { start_time: string; end_time: string }[]> = {
  2: [
    { start_time: "10:00", end_time: "12:00" },
    { start_time: "14:00", end_time: "16:00" },
  ],
  4: [{ start_time: "09:00", end_time: "11:00" }],
};

const due_date = (subject: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    card({ subject_key: subject, due_date: TODAY, created_date: `2026-10-0${(i % 9) + 1}` }),
  );

test("nothing due means nothing proposed", () => {
  const none = planReviewSessions({
    today: TODAY,
    cards: [card({ due_date: day(5) })],
    lecturesByDay,
    booked: [],
  });
  assert.deepEqual(none, []);
});

test("a proposal lands in a hole, not on a lecture", () => {
  const plans = planReviewSessions({
    today: TODAY,
    cards: due_date("Calculus", 5),
    lecturesByDay,
    booked: [],
    days: 1,
  });

  assert.equal(plans.length, 1);
  assert.equal(plans[0].date, TODAY);
  assert.equal(plans[0].day, 2);
  assert.equal(plans[0].start_time, "08:00", "the earliest hole in the day");
  assert.equal(plans[0].end_time, "08:25");
  assert.equal(plans[0].subject_key, "Calculus");
  assert.equal(plans[0].card_count, 5);
});

test("a full day of lectures still leaves the holes between them", () => {
  const plans = planReviewSessions({
    today: TODAY,
    cards: due_date("Calculus", 60),
    lecturesByDay: {
      2: [
        { start_time: "08:00", end_time: "12:00" },
        { start_time: "12:30", end_time: "16:00" },
        { start_time: "16:30", end_time: "20:00" },
      ],
    },
    booked: [],
    days: 1,
    maxPerDay: 3,
  });
  assert.deepEqual(
    plans.map((p) => p.start_time),
    ["12:00", "16:00", "20:00"],
    "the half hour between two lectures is a session, and so is the evening",
  );
  assert.deepEqual(
    plans.map((p) => p.card_count),
    [20, 20, 20],
    "three sittings is exactly sixty cards, and nothing more is planned",
  );

  const thirty = planReviewSessions({
    today: TODAY,
    cards: due_date("Calculus", 30),
    lecturesByDay: {
      2: [
        { start_time: "08:00", end_time: "12:00" },
        { start_time: "12:30", end_time: "16:00" },
        { start_time: "16:30", end_time: "20:00" },
      ],
    },
    booked: [],
    days: 1,
    maxPerDay: 3,
  });
  assert.equal(thirty.length, 2, "a sitting is only planned if there are cards for it");
});

test("two sittings on one day are planned around each other", () => {
  const plans = planReviewSessions({
    today: TODAY,
    cards: due_date("Calculus", 60),
    lecturesByDay: {},
    booked: [],
    days: 1,
    maxPerDay: 3,
  });
  assert.equal(plans.length, 3, "the daily limit is a limit");
  assert.deepEqual(
    plans.map((p) => `${p.start_time}-${p.end_time}`),
    ["08:00-08:25", "08:25-08:50", "08:50-09:15"],
    "and they do not sit on top of each other",
  );
});

test("cards past one sitting are left for the next hole", () => {
  const plans = planReviewSessions({
    today: TODAY,
    cards: due_date("Calculus", 45),
    lecturesByDay: {},
    booked: [],
    days: 1,
    maxPerDay: 3,
  });
  assert.equal(proposalTotals(plans).cards, 45);
  const counts = plans.map((p) => p.card_count);
  assert.ok(
    counts.every((c) => c <= 20),
    `one sitting is about twenty cards: ${counts.join(", ")}`,
  );
  assert.equal(counts[0], 20, "and it fills up before it stops");
});

test("sessions already booked are not planned on", () => {
  const plans = planReviewSessions({
    today: TODAY,
    cards: due_date("Calculus", 5),
    lecturesByDay: {},
    booked: [{ date: TODAY, day: 2, start_time: "08:00", end_time: "09:00" }],
    days: 1,
  });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].start_time, "09:00", "it starts when the other one ends");
});

test("the busiest course is served first, and ties are settled by name", () => {
  const plans = planReviewSessions({
    today: TODAY,
    cards: [...due_date("Physics", 3), ...due_date("Calculus", 9), ...due_date("Zoology", 9)],
    lecturesByDay: {},
    booked: [],
    days: 1,
    maxPerDay: 3,
  });
  assert.equal(plans[0].subject_key, "Calculus", "alphabetically first of the two tied at nine");
  assert.equal(plans[1].subject_key, "Zoology");
  assert.equal(plans[2].subject_key, "Physics");
});

test("the plan reaches forward over days, nearest first", () => {
  const plans = planReviewSessions({
    today: TODAY,
    cards: due_date("Calculus", 100),
    lecturesByDay,
    booked: [],
    days: 7,
    maxPerDay: 2,
  });
  const dates = plans.map((p) => p.date);
  assert.deepEqual(dates, [...dates].sort(), "in order, so the queue shortens now");
  assert.ok(dates[0] === TODAY, "today is used before tomorrow");
  const totals = proposalTotals(plans);
  assert.equal(totals.cards, 100, "every due_date card is accounted for");
  assert.equal(totals.days, 3, "two sittings a day covers twenty cards at a time");
  assert.equal(totals.sessions, 5);
  assert.equal(totals.minutes, 125);
});

test("a week with no room at all proposes nothing rather than inventing it", () => {
  const plans = planReviewSessions({
    today: TODAY,
    cards: due_date("Calculus", 10),
    lecturesByDay: {
      0: [{ start_time: "08:00", end_time: "22:00" }],
      1: [{ start_time: "08:00", end_time: "22:00" }],
      2: [{ start_time: "08:00", end_time: "22:00" }],
      3: [{ start_time: "08:00", end_time: "22:00" }],
      4: [{ start_time: "08:00", end_type: "22:00", end_time: "22:00" } as never],
      5: [{ start_time: "08:00", end_time: "22:00" }],
      6: [{ start_time: "08:00", end_time: "22:00" }],
    },
    booked: [],
    days: 7,
  });
  assert.deepEqual(plans, []);
});

test("the totals are what a person is asked to agree to", () => {
  const totals = proposalTotals([
    { date: TODAY, day: 2, start_time: "08:00", end_time: "08:25", subject_key: "A", card_count: 20 },
    { date: day(1), day: 3, start_time: "10:00", end_time: "10:25", subject_key: "B", card_count: 8 },
  ]);
  assert.deepEqual(totals, { sessions: 2, minutes: 50, cards: 28, days: 2 });
  assert.deepEqual(proposalTotals([]), { sessions: 0, minutes: 0, cards: 0, days: 0 });
});

test("the day can be bounded, for a student who is not out at eight", () => {
  const plans = planReviewSessions({
    today: TODAY,
    cards: due_date("Calculus", 5),
    lecturesByDay: {},
    booked: [],
    days: 1,
    dayStart: "16:00",
    dayEnd: "18:00",
    sessionMinutes: 30,
  });
  assert.deepEqual(
    plans.map((p) => `${p.start_time}-${p.end_time}`),
    ["16:00-16:30"],
  );
});
test("a sitting with no course goes in with no course, not a dash", () => {
  const plans = planReviewSessions({
    today: TODAY,
    cards: [card({ subject_key: "" })],
    lecturesByDay: {},
    booked: [],
    days: 1,
  });
  assert.equal(plans[0].subject_key, NO_SUBJECT, "shown as something, so a list reads right");
  assert.deepEqual(proposalToRow(plans[0]), {
    date: TODAY,
    start_time: "08:00",
    end_time: "08:25",
    subject_key: "",
    card_count: 1,
    source: "auto",
    done: false,
  });
});

test("a row says who put it there", () => {
  const row = proposalToRow({
    date: TODAY,
    day: 2,
    start_time: "08:00",
    end_time: "08:25",
    subject_key: "Calculus",
    card_count: 12,
  });
  assert.equal(row.source, "auto", "the planner is not a person");
  assert.equal(row.done, false, "a session nobody has sat through yet");
  assert.equal(row.subject_key, "Calculus");
});

test("the timetable is grouped by the weekday the planner asks about", () => {
  const byDay = busyByWeekday([
    { day: 2, start_time: "10:00", end_time: "12:00" },
    { day: 2, start_time: "14:00", end_time: "16:00" },
    { day: 6, start_time: "09:00", end_time: "11:00" },
    { day: 2, start_time: "", end_time: "16:00" },
    { day: 9, start_time: "09:00", end_time: "10:00" },
    { day: Number.NaN, start_time: "09:00", end_time: "10:00" },
  ]);
  assert.deepEqual(byDay[2], [
    { start_time: "10:00", end_time: "12:00" },
    { start_time: "14:00", end_time: "16:00" },
  ]);
  assert.equal(byDay[6].length, 1);
  assert.deepEqual(byDay[9], undefined, "there is no ninth weekday to plan for");
});
