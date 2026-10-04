import { test } from "node:test";
import assert from "node:assert/strict";
import { gpaTotals, gpaWith, gradeNeeded, pointsFor } from "../src/lib/gpa.ts";
import type { Grade } from "../src/lib/db/types.ts";

const grade = (letter: string, hours: number, subject = letter + hours): Grade =>
  ({
    id: subject,
    subject_name: subject,
    code: "",
    credit_hours: hours,
    letter,
    grade_point: pointsFor(letter),
    semester: "",
  }) as Grade;

test("the average is weighted by hours", () => {
  // A on 3 hours and D on 1 hour is 13 points over 4 hours.
  const t = gpaTotals([grade("A", 3), grade("D", 1)]);
  assert.equal(t.hours, 4);
  assert.equal(t.points, 13);
  assert.ok(Math.abs(t.gpa - 3.25) < 1e-9);
});

test("no grades is no average, not a zero average", () => {
  const t = gpaTotals([]);
  assert.deepEqual(t, { gpa: 0, points: 0, hours: 0 });
});

test("one course can be priced before it is taken", () => {
  // 3.25 over 4 hours, then an A on 3: 25 points over 7.
  const g = [grade("A", 3), grade("D", 1)];
  assert.ok(Math.abs(gpaWith(g, 3, "A") - 25 / 7) < 1e-9);
  assert.ok(gpaWith(g, 3, "A") > gpaTotals(g).gpa);
  assert.ok(gpaWith(g, 3, "F") < gpaTotals(g).gpa);
});

test("a course with no hours changes nothing", () => {
  const g = [grade("A", 3)];
  assert.equal(gpaWith(g, 0, "F"), gpaTotals(g).gpa);
});

test("the lowest grade that clears a target is the one offered", () => {
  // 3.25 over 4 hours, and a 3-hour course. A C gives 19/7 = 2.71, a B gives
  // 22/7 = 3.14, so B is the cheapest way to stay at 3.0 or above.
  const g = [grade("A", 3), grade("D", 1)];
  const need = gradeNeeded(g, 3, 3.0);
  assert.ok(need);
  assert.equal(need.letter, "B");
  assert.ok(need.gpa >= 3.0);
  assert.ok(gpaWith(g, 3, "C") < 3.0, "the next grade down does not clear it");
});

test("a target already met needs the worst grade that keeps it", () => {
  // An A on 3 hours is 4.0; an F on 3 more drops it to 2.0, a D holds 2.5.
  const g = [grade("A", 3)];
  const need = gradeNeeded(g, 3, 2.5);
  assert.ok(need);
  assert.equal(need.letter, "D");
  assert.ok(gpaWith(g, 3, "F") < 2.5);
});

test("a target out of reach says so instead of promising a grade", () => {
  // A D on 1 hour, then 3 more hours: an A there averages 13/4 = 3.25.
  const g = [grade("D", 1)];
  const need = gradeNeeded(g, 3, 3.5);
  assert.ok(need);
  assert.equal(need.reachable, false);
  assert.ok(need.gpa < 3.5);
});

test("a second A can lift an average, so 3.9 is not out of reach here", () => {
  const need = gradeNeeded([grade("A", 3)], 3, 3.9);
  assert.ok(need);
  assert.equal(need.reachable, true);
  assert.equal(need.letter, "A");
});

test("a target with no current average is answered from the course alone", () => {
  // An A on 4 hours is 4.0, so anything up to 4.0 is reachable with the top grade.
  assert.equal(gradeNeeded([], 4, 4)?.letter, "A");
  assert.equal(gradeNeeded([], 4, 3)?.letter, "B");
  assert.equal(gradeNeeded([], 4, 4)?.reachable, true);
});

test("zero hours cannot be priced", () => {
  assert.equal(gradeNeeded([grade("A", 3)], 0, 3), null);
});