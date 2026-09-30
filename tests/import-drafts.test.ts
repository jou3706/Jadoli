import { test } from "node:test";
import assert from "node:assert/strict";
import {
  draftKey,
  emptyPreview,
  isRemoved,
  keptRows,
  removeAt,
  removedRows,
  renameAt,
  restoreAll,
  restoreAt,
  type Draft,
  type Preview,
} from "../src/lib/import-drafts.ts";

const row = (name: string, day = 0, start = "08:00"): Draft => ({
  subject_name: name,
  subject_en: "",
  code: "",
  doctor: "",
  hall: "",
  day,
  start_time: start,
  end_time: "10:00",
  kind: "lecture",
  notes: "",
  department: "",
  color: "#000",
});

const previewOf = (...names: string[]): Preview => ({
  all: names.map((n, i) => row(n, i, `0${8 + i}:00`)),
  removed: [],
});

test("a mis-removed lecture can be put back", () => {
  const p = removeAt(previewOf("A", "B", "C"), 1);
  assert.deepEqual(
    keptRows(p).map(({ row: r }) => r.subject_name),
    ["A", "C"],
  );
  assert.equal(removedRows(p).length, 1);

  const back = restoreAt(p, 1);
  assert.deepEqual(
    keptRows(back).map(({ row: r }) => r.subject_name),
    ["A", "B", "C"],
  );
  assert.equal(removedRows(back).length, 0);
});

test("a restored lecture returns to the spot it was read, not to the end", () => {
  let p = previewOf("A", "B", "C", "D", "E");
  p = removeAt(p, 1);
  p = removeAt(p, 3);
  assert.deepEqual(
    keptRows(p).map(({ row: r }) => r.subject_name),
    ["A", "C", "E"],
  );

  // B goes back second, where it was read, rather than after E.
  p = restoreAt(p, 1);
  assert.deepEqual(
    keptRows(p).map(({ row: r }) => r.subject_name),
    ["A", "B", "C", "E"],
  );
});

test("removing several and restoring all gives back the original list", () => {
  const p0 = previewOf("A", "B", "C", "D");
  const p = removeAt(removeAt(removeAt(p0, 0), 2), 3);
  assert.equal(keptRows(p).length, 1);

  const back = restoreAll(p);
  assert.deepEqual(
    keptRows(back).map(({ row: r }) => r.subject_name),
    ["A", "B", "C", "D"],
  );
  assert.equal(removedRows(back).length, 0);
});

test("a removed row keeps the name the user corrected by hand", () => {
  // The name is edited on screen, then the row is removed and put back: the
  // correction must survive, otherwise restoring loses the user's typing.
  let p = renameAt(previewOf("Alogorethm"), 0, "Algorithm");
  p = removeAt(p, 0);
  p = restoreAt(p, 0);
  assert.equal(keptRows(p)[0].row.subject_name, "Algorithm");
});

test("a removed row is not saved even though it is still in the list", () => {
  const p = removeAt(previewOf("A", "B"), 0);
  // `all` still holds both rows, so anything that saves from `all` instead of
  // the kept rows would quietly put the removed lecture back in the schedule.
  assert.equal(p.all.length, 2);
  assert.equal(keptRows(p).length, 1);
});

test("removing the same row twice does not lose it", () => {
  const p0 = previewOf("A", "B");
  const once = removeAt(p0, 1);
  const twice = removeAt(once, 1);
  assert.deepEqual(twice.removed, [1]);
  assert.equal(removedRows(twice).length, 1);
  assert.equal(keptRows(twice)[0].row.subject_name, "A");
});

test("removing and restoring out of range leaves the preview alone", () => {
  const p0 = previewOf("A");
  assert.equal(removeAt(p0, 5), p0);
  assert.equal(restoreAt(p0, 5), p0);
  assert.equal(renameAt(p0, 5, "X"), p0);
  assert.equal(isRemoved(p0, 0), false);
});

test("an empty preview has nothing to save and nothing to restore", () => {
  const p = emptyPreview();
  assert.equal(keptRows(p).length, 0);
  assert.equal(removedRows(p).length, 0);
  assert.equal(restoreAll(p), p);
});

test("a restored row that duplicates the schedule is still flagged", () => {
  // draftKey is what the save path and the duplicate check both use, so a
  // row that comes back must be recognised as the same lecture as before.
  const a = row(" Operating Systems ", 6, "13:00");
  const b = row("operating systems", 6, "13:00");
  assert.equal(draftKey(a), draftKey(b));
  assert.notEqual(draftKey(a), draftKey(row("Operating Systems", 4, "13:00")));
});
