import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  daysBetween,
  gradeCard,
  isDue,
  newCardState,
  nextInterval,
  previewGrades,
  reviewQueue,
  summarise,
  type SrsCard,
  type SrsState,
} from "../src/lib/srs.ts";

const TODAY = "2026-10-20";
const day = (n: number) => addDays(TODAY, n);

const state = (over: Partial<SrsState> = {}): SrsState => ({
  ...newCardState(TODAY),
  ...over,
});

const card = (over: Partial<SrsCard> = {}): SrsCard => ({
  ...newCardState(TODAY),
  id: "c0",
  subject_key: "Calculus",
  question: "What is a derivative?",
  answer: "The slope at a point.",
  created_date: "2026-10-01T00:00:00Z",
  ...over,
});

test("a forgotten card comes back today, and grows more slowly after", () => {
  const remembered = state({ interval_days: 10, ease: 2.5, reps: 3 });
  const again = gradeCard(remembered, "again", TODAY);

  assert.equal(again.interval_days, 0, "it is asked again today, not in a week");
  assert.equal(again.due_date, TODAY);
  assert.equal(again.lapses, 1, "and the forgetting is counted");
  assert.equal(again.reps, 3, "remembering it three times did not stop counting");
  assert.ok(again.ease < remembered.ease, "a card that is forgotten gets harder to grow");

  // And the slower growth is real: two cards identical but for their ease.
  const slower = gradeCard(state({ interval_days: 0, ease: 1.5, reps: 1 }), "good", TODAY);
  const quicker = gradeCard(state({ interval_days: 0, ease: 2.8, reps: 1 }), "good", TODAY);
  assert.equal(slower.interval_days, 1);
  assert.equal(quicker.interval_days, 1, "a first step is a first step either way");
  const a = gradeCard(state({ interval_days: 6, ease: 1.5, reps: 3 }), "good", TODAY);
  const b = gradeCard(state({ interval_days: 6, ease: 2.8, reps: 3 }), "good", TODAY);
  assert.ok(a.interval_days < b.interval_days, "past the first step the ease is what matters");
});

test("a new card is a day away when it was understood", () => {
  const first = gradeCard(newCardState(TODAY), "good", TODAY);
  assert.equal(first.interval_days, 1);
  assert.equal(first.due_date, day(1));
  assert.equal(first.reps, 1);

  // The second one is where the card's own memory starts to be used: not a day,
  // not a month, but three.
  const second = gradeCard(first, "good", day(1));
  assert.equal(second.interval_days, 3);
  assert.equal(second.due_date, day(4));

  const third = gradeCard(second, "good", day(4));
  assert.equal(third.interval_days, Math.round(3 * 2.5), "and then it is its own ease");
  assert.equal(third.due_date, day(4 + Math.round(3 * 2.5)));
});

test("hard is a short step and easy is a long one, whatever the card was", () => {
  const mature = state({ interval_days: 30, ease: 2.5, reps: 6 });
  const hard = gradeCard(mature, "hard", TODAY);
  const good = gradeCard(mature, "good", TODAY);
  const easy = gradeCard(mature, "easy", TODAY);
  assert.ok(hard.interval_days < good.interval_days, "hard is sooner than good");
  assert.ok(good.interval_days < easy.interval_days, "easy is later than good");
  assert.equal(hard.reps, 7, "a card found hard was still remembered");

  // On a brand new card the three answers are three different first steps.
  const fresh = newCardState(TODAY);
  assert.equal(gradeCard(fresh, "hard", TODAY).interval_days, 1);
  assert.equal(gradeCard(fresh, "good", TODAY).interval_days, 1);
  assert.equal(gradeCard(fresh, "easy", TODAY).interval_days, 3);
});

test("ease stays inside the range a card can actually use", () => {
  let s = newCardState(TODAY);
  for (let i = 0; i < 30; i += 1) s = gradeCard(s, "easy", s.due_date);
  assert.ok(s.ease <= 2.8, `ease ran away to ${s.ease}`);

  let t = newCardState(TODAY);
  for (let i = 0; i < 30; i += 1) t = gradeCard(t, "again", TODAY);
  assert.ok(t.ease >= 1.3, `ease collapsed to ${t.ease}`);
});

test("a card is never asked more than a year out", () => {
  const s = gradeCard(state({ interval_days: 300, ease: 2.8, reps: 12 }), "easy", TODAY);
  assert.equal(s.interval_days, 365);
  assert.equal(nextInterval({ interval_days: 900, ease: 2.8 }, "easy"), 365);
});

test("an unreadable date is treated as due rather than lost", () => {
  assert.ok(isDue({ due_date: "" }, TODAY), "a card with no date is asked, not skipped");
  assert.ok(isDue({ due_date: "not-a-date" }, TODAY));
  assert.ok(isDue({ due_date: "2026-10-19" }, TODAY), "yesterday is due");
  assert.ok(isDue({ due_date: TODAY }, TODAY), "today is due");
  assert.ok(!isDue({ due_date: day(1) }, TODAY), "tomorrow is not");
});

test("dates are added in UTC, so a day is always a day", () => {
  assert.equal(addDays("2026-10-20", 0), "2026-10-20");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01", "a month is not 30 days");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31", "and a year is not 365");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(daysBetween("2026-10-20", "2026-10-20"), 0);
  assert.equal(daysBetween("2026-11-02", "2026-10-20"), 13);
  assert.equal(daysBetween("2026-10-18", "2026-10-20"), -2);
  assert.equal(addDays("nonsense", 3), "nonsense", "a broken date is left alone");
});

test("the summary adds up, and says where the work is", () => {
  const cards: SrsCard[] = [
    card({ due_date: TODAY, reps: 4, interval_days: 30 }),
    card({ due_date: day(-2), reps: 2, interval_days: 6 }),
    card({ due_date: day(3), reps: 0, interval_days: 0 }),
    card({ subject_key: "Physics", due_date: TODAY, reps: 1, interval_days: 2 }),
    card({ subject_key: "", due_date: TODAY, reps: 0, interval_days: 0 }),
  ];
  const s = summarise(cards, TODAY);

  assert.equal(s.total, 5);
  assert.equal(s.due, 4);
  assert.equal(s.fresh, 2, "never seen");
  assert.equal(s.young, 2);
  assert.equal(s.mature, 1, "three weeks or more of interval_days");
  assert.equal(
    s.bySubject.reduce((n, b) => n + b.due, 0),
    s.due,
    "the subject split is the same number as the headline",
  );
  assert.equal(s.bySubject[0].subject_key, "Calculus", "the busiest course first");
  assert.ok(
    s.bySubject.some((b) => b.subject_key === "—"),
    "a card with no course is still counted, not dropped",
  );
});

test("the queue is oldest first, and one course does not fill it", () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    card({ id: `c${i}`, due_date: TODAY, subject_key: "Calculus", created_date: `2026-10-0${i + 1}` }),
  );
  const physics = card({ id: "p1", subject_key: "Physics", due_date: day(-1) });
  const later = card({ id: "later", due_date: day(5) });
  const queue = reviewQueue([...many, physics, later], TODAY);

  assert.equal(queue.length, 13, "the card due tomorrow is not in today's queue");
  assert.equal(queue[0].id, "p1", "the card that has waited longest is asked first");
  assert.ok(
    new Set(queue.map((c) => c.subject_key)).size === 2,
    "courses are mixed rather than run one after another",
  );
  assert.equal(
    queue[1].subject_key,
    "Calculus",
    "with one physics card there is nothing to alternate with, so calculus takes over",
  );

  assert.equal(reviewQueue(many, TODAY, 5).length, 5, "a sitting is a sitting");
  assert.equal(reviewQueue([], TODAY).length, 0);
});

test("two courses are asked in turns, not one after the other", () => {
  const calculus = Array.from({ length: 5 }, (_, i) =>
    card({ id: `c${i}`, subject_key: "Calculus", created_date: `2026-10-0${i + 1}` }),
  );
  const physics = Array.from({ length: 5 }, (_, i) =>
    card({ id: `p${i}`, subject_key: "Physics", created_date: `2026-10-0${i + 1}` }),
  );
  const queue = reviewQueue([...calculus, ...physics], TODAY);
  assert.deepEqual(
    queue.map((c) => c.subject_key),
    [
      "Calculus",
      "Physics",
      "Calculus",
      "Physics",
      "Calculus",
      "Physics",
      "Calculus",
      "Physics",
      "Calculus",
      "Physics",
    ],
  );
  assert.deepEqual(
    queue.filter((c) => c.subject_key === "Calculus").map((c) => c.id),
    ["c0", "c1", "c2", "c3", "c4"],
    "inside a course the ranking it was given is kept",
  );
});

test("what each button does is known before it is pressed", () => {
  const preview = previewGrades(state({ interval_days: 5, ease: 2.5, reps: 2 }), TODAY);
  assert.deepEqual(
    preview.map((p) => p.id),
    ["again", "hard", "good", "easy"],
  );
  const intervals = preview.map((p) => p.interval_days);
  assert.ok(
    intervals.every((v, i) => i === 0 || v >= intervals[i - 1]),
    `buttons should get steadily further away: ${intervals.join(", ")}`,
  );
  assert.equal(preview[0].due_date, TODAY);
});