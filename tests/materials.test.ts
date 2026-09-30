import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MATERIAL_KINDS,
  detectKind,
  groupMaterials,
  kindMeta,
  safeUrl,
} from "../src/lib/materials.ts";

test("guesses the kind from the extension", () => {
  assert.equal(detectKind("https://x.com/a.pdf"), "pdf");
  assert.equal(detectKind("https://x.com/a.PDF"), "pdf");
  assert.equal(detectKind("https://x.com/a.pdf?download=1"), "pdf");
  assert.equal(detectKind("https://x.com/a.pptx"), "slides");
  assert.equal(detectKind("https://x.com/a.key"), "slides");
  assert.equal(detectKind("https://x.com/a.docx"), "doc");
  assert.equal(detectKind("https://x.com/notes.md"), "doc");
  assert.equal(detectKind("https://x.com/a.png"), "image");
  assert.equal(detectKind("https://x.com/a.JPEG"), "image");
});

test("recognises video and Google Drive by host", () => {
  assert.equal(detectKind("https://www.youtube.com/watch?v=abc"), "video");
  assert.equal(detectKind("https://youtu.be/abc"), "video");
  assert.equal(detectKind("https://drive.google.com/file/d/1"), "link");
  assert.equal(detectKind("https://docs.google.com/document/d/1"), "link");
});

test("falls back to a plain link", () => {
  assert.equal(detectKind("https://example.com/page"), "link");
  assert.equal(detectKind(""), "link");
  assert.equal(detectKind("not a url at all"), "link");
});

test("an explicit choice beats the guess", () => {
  assert.equal(detectKind("https://x.com/a.pdf", "link"), "link");
  assert.equal(detectKind("https://x.com/page", "pdf"), "pdf");
  // An unknown stored value must not throw.
  assert.equal(detectKind("https://x.com/a.pdf", "bogus"), "pdf");
});

test("does not match an extension in the middle of a path", () => {
  assert.equal(detectKind("https://x.com/pdf/index.html"), "link");
  assert.equal(detectKind("https://x.com/a.pdf.html"), "link");
});

test("safeUrl allows only http and https", () => {
  assert.equal(safeUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(safeUrl("  http://example.com  "), "http://example.com");
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("JavaScript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,<script>"), "");
  assert.equal(safeUrl("vbscript:msgbox"), "");
  assert.equal(safeUrl("file:///etc/passwd"), "");
  assert.equal(safeUrl("//example.com"), "");
  assert.equal(safeUrl(""), "");
  assert.equal(safeUrl(null), "");
});

test("kindMeta always returns a label", () => {
  for (const k of MATERIAL_KINDS) {
    assert.equal(kindMeta(k.id).id, k.id);
    assert.ok(kindMeta(k.id).ar.length > 0);
  }
  // @ts-expect-error deliberately wrong id
  assert.equal(kindMeta("nope").id, "link");
});

test("groups by course, largest first, untitled last resort", () => {
  const rows = [
    { subject_key: "Physics" },
    { subject_key: "Math" },
    { subject_key: "Physics" },
    { subject_key: "Physics" },
    { subject_key: "" },
    { subject_key: "   " },
  ];
  const groups = groupMaterials(rows);
  assert.equal(groups[0][0], "Physics");
  assert.equal(groups[0][1].length, 3);
  assert.equal(groups.length, 3, "Physics, Math, and the untitled bucket");
  const untitled = groups.find(([k]) => k === "—");
  assert.equal(untitled?.[1].length, 2, "blank keys share one bucket");
});

test("grouping an empty list yields nothing", () => {
  assert.deepEqual(groupMaterials([]), []);
});
