import { test } from "node:test";
import assert from "node:assert/strict";
import {
  safeImageUrl,
  subjectCover,
  subjectEmoji,
  subjectHash,
} from "../src/lib/subjects.ts";
import { formatBytes, safeFileName } from "../src/lib/db/storage.ts";

test("subjectHash is stable and unsigned", () => {
  assert.equal(subjectHash("Calculus 2"), subjectHash("Calculus 2"));
  assert.notEqual(subjectHash("Calculus 2"), subjectHash("Physics 1"));
  assert.ok(subjectHash("رياضيات") >= 0);
  assert.equal(subjectHash(""), subjectHash(""));
});

test("subjectCover is a readable gradient and deterministic", () => {
  const a = subjectCover("Organic Chemistry");
  const b = subjectCover("Organic Chemistry");
  assert.deepEqual(a, b, "same subject must always look the same");
  assert.match(a.background, /^linear-gradient\(135deg, hsl\(\d+ \d+% \d+%\), hsl\(\d+ \d+% \d+%\)\)$/);
  assert.equal(a.color, "#fff", "white text needs a dark-enough background");
  assert.ok(a.ring.includes("hsl("));
});

test("subjectCover spreads different names across hues", () => {
  const names = ["Calculus", "Physics", "Chemistry", "Biology", "Programming"];
  const hues = names.map((n) => subjectHash(n) % 360);
  assert.equal(new Set(hues).size, names.length, "covers should not all collide");
});

test("subjectEmoji prefers keywords over the hash", () => {
  assert.equal(subjectEmoji("Advanced Calculus I"), "📐");
  assert.equal(subjectEmoji("General Physics"), "⚛️");
  assert.equal(subjectEmoji("Organic Chemistry"), "🧪");
  assert.equal(subjectEmoji("Data Structures"), "💻"); // matches the programming rule first
  assert.equal(subjectEmoji("Computer Programming"), "💻");
  assert.equal(subjectEmoji("الفيزياء"), "⚛️");
  assert.equal(subjectEmoji("برمجة الحاسبات"), "💻");
});

test("subjectEmoji falls back to a stable pick", () => {
  const unknown = "Xyzzy Foobarbaz";
  assert.equal(subjectEmoji(unknown), subjectEmoji(unknown));
  assert.ok(subjectEmoji(unknown).length > 0);
});

test("safeImageUrl only accepts http(s)", () => {
  assert.equal(safeImageUrl("https://x.supabase.co/a.png"), "https://x.supabase.co/a.png");
  assert.equal(safeImageUrl(""), "");
  assert.equal(safeImageUrl(null), "");
  assert.equal(safeImageUrl("javascript:alert(1)"), "");
  assert.equal(safeImageUrl("data:image/png;base64,AAA"), "");
  assert.equal(safeImageUrl("file:///c:/x.png"), "");
  assert.equal(safeImageUrl("https://"), "");
});

test("safeFileName drops the path and keeps the extension", () => {
  assert.equal(safeFileName("lecture.pdf"), "lecture.pdf");
  assert.equal(safeFileName("C:\\Users\\me\\Desktop\\summary.docx"), "summary.docx");
  assert.equal(safeFileName("../../../etc/passwd"), "passwd");
  assert.equal(safeFileName("my<script>.pdf"), "my_script_.pdf");
  assert.equal(safeFileName(""), "file");
  assert.equal(safeFileName("..."), "file");
});

test("safeFileName keeps the extension when it truncates", () => {
  const long = `${"a".repeat(200)}.pdf`;
  const out = safeFileName(long);
  assert.ok(out.length <= 80, `got ${out.length} chars`);
  assert.ok(out.endsWith(".pdf"), `extension lost: ${out}`);
});

test("formatBytes is human readable", () => {
  assert.equal(formatBytes(0), "");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});
