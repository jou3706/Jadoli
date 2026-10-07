import { test } from "node:test";
import assert from "node:assert/strict";
import { browserStorage } from "./browser-shim.ts";
import {
  markTourSeen,
  readTourSeen,
  tourForPath,
  TOURS,
} from "../src/lib/tour.ts";
import { pageGuideFor } from "../src/lib/page-guides.ts";

browserStorage.clear();

test("a tour matches a real page and uses data-tour selectors", () => {
  for (const t of TOURS) {
    const guide = pageGuideFor(t.match);
    assert.ok(guide, `no page guide for tour page ${t.match}`);
    assert.equal(t.key, guide.key, `${t.match}: tour and guide keys must match`);
    assert.ok(t.steps.length >= 3, `${t.match}: too few tour steps`);
    for (const s of t.steps) {
      assert.match(s.selector, /^\[data-tour="/, `${t.match}: step must target a data-tour attribute`);
      assert.ok(s.title[0].length > 0 && s.title[1].length > 0, `${t.match}: empty title`);
      assert.ok(s.intro[0].length > 0 && s.intro[1].length > 0, `${t.match}: empty intro`);
    }
  }
});

test("a page the student has not toured yet shows its tour", () => {
  assert.equal(readTourSeen("u_fresh", "schedule"), false);
});

test("finishing or skipping records the tour for that account", () => {
  markTourSeen("u_fresh", "schedule");
  assert.equal(readTourSeen("u_fresh", "schedule"), true);
  assert.equal(readTourSeen("u_fresh", "week"), false);
});

test("tours are watched per account, not per device", () => {
  browserStorage.clear();
  markTourSeen("u_alice", "schedule");
  assert.equal(readTourSeen("u_alice", "schedule"), true);
  assert.equal(readTourSeen("u_bob", "schedule"), false);
});

test("unknown routes have no tour", () => {
  assert.equal(tourForPath("/login"), undefined);
  assert.equal(tourForPath("/week"), undefined);
});