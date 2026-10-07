import { test } from "node:test";
import assert from "node:assert/strict";
import { browserStorage } from "./browser-shim.ts";
import {
  PAGE_GUIDES,
  pageGuideFor,
  readPageSeen,
  markPageSeen,
} from "../src/lib/page-guides.ts";

browserStorage.clear();

/** Every destination in the sidebar, so a new page cannot be added silently. */
const NAV = [
  "/",
  "/week",
  "/attendance",
  "/subjects",
  "/review",
  "/quiz",
  "/questions",
  "/gpa",
  "/events",
  "/assistant",
  "/import",
];

test("every sidebar page has a guide with features and exact steps", () => {
  for (const to of NAV) {
    const g = pageGuideFor(to);
    assert.ok(g, `missing guide for ${to}`);
    assert.ok(g.features.length >= 2, `${to}: too few features`);
    assert.ok(g.steps.length >= 2, `${to}: too few steps`);
    for (const [ar, en] of [...g.features, ...g.steps]) {
      assert.ok(ar.length > 0, `${to}: empty Arabic`);
      assert.ok(en.length > 0, `${to}: empty English`);
    }
  }
  assert.equal(PAGE_GUIDES.length, NAV.length);
});

test("a page the student has not seen yet shows its guide", () => {
  assert.equal(readPageSeen("u_fresh", "subjects"), false);
});

test("dismissing records the page for that account, not other pages", () => {
  markPageSeen("u_fresh", "subjects");
  assert.equal(readPageSeen("u_fresh", "subjects"), true);
  assert.equal(readPageSeen("u_fresh", "quiz"), false);
});

test("pages are watched per account, not per device", () => {
  browserStorage.clear();
  markPageSeen("u_alice", "subjects");
  assert.equal(readPageSeen("u_alice", "subjects"), true);
  assert.equal(readPageSeen("u_bob", "subjects"), false);
});

test("unknown routes have no guide", () => {
  assert.equal(pageGuideFor("/login"), undefined);
  assert.equal(pageGuideFor("/subjects/extra"), undefined);
});