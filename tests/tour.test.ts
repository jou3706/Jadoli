import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { browserStorage } from "./browser-shim.ts";
import {
  markTourSeen,
  readTourSeen,
  tourForPath,
  TOURS,
} from "../src/lib/tour.ts";
import { pageGuideFor } from "../src/lib/page-guides.ts";

browserStorage.clear();

/** Every file under the app's source, so the anchors can be read as text. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

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

test("every anchor on a page is a step of that page's tour", () => {
  // The other direction: a step that points at nothing is a tour that stalls
  // on an empty tooltip, and an anchor no step points at is a marker that
  // says "teach me here" to nobody.
  const anchored = new Set<string>();
  for (const file of sources(fileURLToPath(new URL("../src", import.meta.url)))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/data-tour="([^"]+)"/g)) {
      // The names in the source are lower-case words; anything else is prose
      // that happens to mention the attribute.
      if (/^[a-z][a-z0-9-]*$/.test(m[1])) anchored.add(m[1]);
    }
  }

  const stepped = new Set<string>();
  for (const t of TOURS) {
    for (const s of t.steps) {
      const m = /^\[data-tour="([^"]+)"\]$/.exec(s.selector);
      assert.ok(m, `${t.match}: a step must target one anchor: ${s.selector}`);
      stepped.add(m![1]);
    }
  }

  for (const name of anchored) {
    assert.ok(stepped.has(name), `no tour step points at data-tour="${name}"`);
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
  assert.equal(tourForPath("/widget"), undefined);
});