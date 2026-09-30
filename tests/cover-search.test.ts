import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coverQuery,
  isFreeLicence,
  rankCandidates,
  stripHtml,
} from "../src/lib/cover-search.ts";

const page = (title: string, info: Record<string, unknown>) => ({
  title,
  imageinfo: [info],
});

const jpg = (over: Record<string, unknown> = {}) => ({
  mime: "image/jpeg",
  width: 1200,
  height: 900,
  thumburl: "https://upload.wikimedia.org/x/y/a.jpg/1024px-a.jpg",
  descriptionurl: "https://commons.wikimedia.org/wiki/File:A.jpg",
  extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: "Someone" } },
  ...over,
});

test("coverQuery drops numbers and forces bitmaps", () => {
  assert.equal(coverQuery("Calculus 2"), "Calculus filetype:bitmap");
  assert.equal(coverQuery("Data Structures & Algorithms"), "Data Structures & Algorithms filetype:bitmap");
  assert.equal(coverQuery("  ??  "), "university filetype:bitmap");
  assert.ok(coverQuery("PHYS 101").startsWith("PHYS"));
});

test("stripHtml removes tags and never returns an empty label", () => {
  assert.equal(stripHtml("<a href='#'>A. Author</a>"), "A. Author");
  assert.equal(stripHtml(undefined), "");
  assert.equal(stripHtml("x".repeat(200)).length, 80);
});

test("isFreeLicence accepts public domain and CC0", () => {
  assert.equal(isFreeLicence("Public domain"), true);
  assert.equal(isFreeLicence("CC0"), true);
  assert.equal(isFreeLicence("CC BY-SA 4.0"), false);
});

test("rankCandidates drops pdf page renders, logos and small scans", () => {
  const out = rankCandidates(
    [
      page("File:Chimie.jpg", jpg()),
      page("File:manual.pdf", jpg({ thumburl: "https://x/a.pdf/page1-500px-a.pdf.jpg" })),
      page("File:logo.png", jpg({ mime: "image/png" })),
      page("File:tiny.jpg", jpg({ width: 200, height: 150 })),
      page("File:vector.svg", jpg({ mime: "image/svg+xml" })),
    ],
    "Chemistry",
  );
  assert.deepEqual(out.map((c) => c.title), ["Chimie.jpg"]);
});

test("rankCandidates puts public domain and on-topic images first", () => {
  const out = rankCandidates(
    [
      page("File:unrelated photo.jpg", jpg({ extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" } } })),
      page("File:Calculus diagram.jpg", jpg({ extmetadata: { LicenseShortName: { value: "Public domain" } } })),
      page("File:Calculus small.jpg", jpg({ width: 640, height: 480, extmetadata: { LicenseShortName: { value: "Public domain" } } })),
    ],
    "Calculus",
  );
  assert.equal(out[0].title, "Calculus diagram.jpg");
  assert.equal(out[0].free, true);
});

test("rankCandidates caps the grid and keeps attribution", () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    page(`File:img${i}.jpg`, jpg({ thumburl: `https://x/${i}.jpg` })),
  );
  const out = rankCandidates(many, "Physics");
  assert.equal(out.length, 8);
  assert.equal(out[0].license, "CC BY-SA 4.0");
  assert.equal(out[0].artist, "Someone");
  assert.match(out[0].page, /commons\.wikimedia\.org/);
});
