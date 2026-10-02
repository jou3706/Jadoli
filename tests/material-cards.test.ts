import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CARDABLE_BYTES,
  MAX_CARDABLE_MATERIALS,
  blockedLabel,
  capSelection,
  cardSourceLabel,
  cardableMaterial,
  cardableMaterials,
  readableMaterials,
  type MaterialRef,
} from "../src/lib/material-cards.ts";

/** A material as the app stores it: title, url, and a path only when uploaded. */
const mat = (over: Partial<MaterialRef> = {}): MaterialRef => ({
  id: "m1",
  title: "Lecture 3.pdf",
  url: "https://proj.supabase.co/storage/v1/object/public/materials/u/f/a.pdf",
  type: "pdf",
  file_path: "uid/files/a.pdf",
  size: 2 * 1024 * 1024,
  ...over,
});

test("an uploaded PDF is readable", () => {
  const c = cardableMaterial(mat());
  assert.equal(c.ok, true);
  assert.equal(c.reason, "ready");
  assert.equal(c.mime, "application/pdf");
});

test("an uploaded picture is readable", () => {
  for (const [title, mime] of [
    ["page.png", "image/png"],
    ["page.JPG", "image/jpeg"],
    ["page.jpeg", "image/jpeg"],
    ["page.webp", "image/webp"],
  ]) {
    const c = cardableMaterial(mat({ title, url: `https://x.co/${title}` }));
    assert.equal(c.ok, true, `${title} should be readable`);
    assert.equal(c.mime, mime);
  }
});

test("a saved link cannot be read, and says so", () => {
  const c = cardableMaterial(
    mat({ title: "Lecture notes", url: "https://example.com/notes", file_path: "" }),
  );
  assert.equal(c.ok, false);
  assert.equal(c.reason, "link");
});

test("a YouTube link is not just a link - it has no transcript", () => {
  const c = cardableMaterial(
    mat({
      title: "Recording",
      url: "https://www.youtube.com/watch?v=abc",
      type: "video",
      file_path: "",
    }),
  );
  assert.equal(c.ok, false);
  assert.equal(c.reason, "video");
});

test("slides and documents are named apart from a plain link", () => {
  const slides = cardableMaterial(
    mat({ title: "a.pptx", url: "https://x.co/a.pptx", type: null, file_path: "" }),
  );
  assert.equal(slides.reason, "slides");

  const doc = cardableMaterial(
    mat({ title: "a.docx", url: "https://x.co/a.docx", type: null, file_path: "" }),
  );
  assert.equal(doc.reason, "doc");
});

test("an uploaded pptx is still a zip, not something to read", () => {
  const c = cardableMaterial(
    mat({ title: "a.pptx", url: "https://x.co/a.pptx", type: "slides", file_path: "u/a.pptx" }),
  );
  assert.equal(c.ok, false);
  assert.equal(c.reason, "slides");
});

test("a file the app accepted but cannot read is not offered", () => {
  // The uploader takes .gif and .svg; no model reads them as a page of notes.
  for (const title of ["a.gif", "a.svg"]) {
    const c = cardableMaterial(
      mat({ title, url: `https://x.co/${title}`, type: "image", file_path: "u/a" }),
    );
    assert.equal(c.ok, false, `${title} should not be offered`);
  }
});

test("an oversized file is refused before it costs anything", () => {
  const c = cardableMaterial(mat({ size: MAX_CARDABLE_BYTES + 1 }));
  assert.equal(c.ok, false);
  assert.equal(c.reason, "too-big");

  // Exactly at the limit is still allowed.
  assert.equal(cardableMaterial(mat({ size: MAX_CARDABLE_BYTES })).ok, true);
});

test("a stored row with no usable URL is refused", () => {
  const c = cardableMaterial(mat({ url: "not a url", file_path: "" }));
  assert.equal(c.ok, false);
  assert.equal(c.reason, "bad-url");
});

test("a list keeps its order and each row gets a verdict", () => {
  const rows = [
    mat({ id: "a", title: "a.pdf", url: "https://x.co/a.pdf" }),
    mat({ id: "b", title: "video", url: "https://youtu.be/x", type: "video", file_path: "" }),
    mat({ id: "c", title: "c.png", url: "https://x.co/c.png" }),
  ];
  const judged = cardableMaterials(rows);
  assert.deepEqual(
    judged.map((j) => j.reason),
    ["ready", "video", "ready"],
  );
  assert.deepEqual(
    readableMaterials(rows).map((r) => r.id),
    ["a", "c"],
  );
});

test("a pick is capped without swapping in a file that was not chosen", () => {
  const rows = Array.from({ length: MAX_CARDABLE_MATERIALS + 3 }, (_, i) =>
    mat({ id: `m${i}`, title: `${i}.pdf`, url: `https://x.co/${i}.pdf` }),
  );
  const { kept, over } = capSelection(rows);
  assert.equal(kept.length, MAX_CARDABLE_MATERIALS);
  assert.equal(over, 3);
  assert.deepEqual(
    kept.map((r) => r.id),
    rows.slice(0, MAX_CARDABLE_MATERIALS).map((r) => r.id),
  );
});

test("a pick under the cap loses nothing", () => {
  const { kept, over } = capSelection([mat()]);
  assert.equal(kept.length, 1);
  assert.equal(over, 0);
  assert.deepEqual(capSelection([]), { kept: [], over: 0 });
});

test("every blocked reason has words in both languages", () => {
  for (const reason of [
    "link",
    "video",
    "slides",
    "doc",
    "too-big",
    "missing-file",
    "bad-url",
  ] as const) {
    const ar = blockedLabel(reason, "ar");
    const en = blockedLabel(reason, "en");
    assert.ok(ar.length > 0, `${reason} needs Arabic`);
    assert.ok(en.length > 0, `${reason} needs English`);
    assert.notEqual(ar, en, `${reason} should not be the same string twice`);
  }
});

test("a blocked material says what to do, not just that it failed", () => {
  assert.match(blockedLabel("link", "en"), /upload/i);
  assert.match(blockedLabel("slides", "en"), /pdf/i);
});

test("the saved source points back at the file", () => {
  assert.equal(cardSourceLabel([mat({ title: "Lecture 3.pdf" })], "en"), "Lecture 3.pdf");

  const many = [
    mat({ id: "a", title: "Lecture 3.pdf" }),
    mat({ id: "b", title: "Lecture 4.pdf" }),
    mat({ id: "c", title: "Lab.pdf" }),
  ];
  assert.equal(cardSourceLabel(many, "en"), "Lecture 3.pdf +2 more");
  assert.equal(cardSourceLabel(many, "ar"), "Lecture 3.pdf +2 كمان");
  assert.equal(cardSourceLabel([], "en"), "");
});

test("an untitled material still gets a source rather than a blank", () => {
  assert.equal(cardSourceLabel([mat({ title: "" })], "en"), "material");
});

test("a long title cannot push the source column over its limit", () => {
  const long = cardSourceLabel([mat({ title: "x".repeat(400) })], "en");
  assert.equal(long.length, 200);
});