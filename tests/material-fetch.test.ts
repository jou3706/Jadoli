import { readFile } from "node:fs/promises";

import { test } from "node:test";
import assert from "node:assert/strict";

import { isOwnPath, mimeForName } from "../src/lib/ai/material-path.ts";

/**
 * The route reads a student's own material file on their behalf.
 *
 * That is the one place in the app where a server acts using a path a client
 * named, so it is worth pinning down: a material id must not become a way to read
 * somebody else's file, and a stored path must not become a way to fetch
 * somewhere else on the network.
 */

const U = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const fetchSrc = () => readFile(new URL("../src/lib/ai/material-fetch.ts", import.meta.url), "utf8");
const dialogSrc = () => readFile(new URL("../src/components/review/generate-cards-dialog.tsx", import.meta.url), "utf8");
const routeSrc = () => readFile(new URL("../src/app/api/ai/flashcards/route.ts", import.meta.url), "utf8");
const schemaSrc = () => readFile(new URL("../src/lib/ai/schema.ts", import.meta.url), "utf8");
const cardsSrc = () => readFile(new URL("../src/lib/material-cards.ts", import.meta.url), "utf8");

test("a path in your own folder is yours to read", () => {
  assert.equal(isOwnPath(`${U}/files/a.pdf`, U), true);
  assert.equal(isOwnPath(`${U}/covers/abc.png`, U), true);
  assert.equal(isOwnPath(`/${U}/files/a.pdf`, U), true);
});

test("a path in someone else's folder is not", () => {
  assert.equal(isOwnPath(`${OTHER}/files/a.pdf`, U), false);
  assert.equal(isOwnPath("files/a.pdf", U), false);
  // A plain string prefix would let one account's id stand in for another's.
  assert.equal(isOwnPath(`${U}-other/files/a.pdf`, U), false);
  assert.equal(isOwnPath(`${U}other/files/a.pdf`, U), false);
});

test("traversal cannot climb out of the owner's folder", () => {
  for (const path of [
    `${U}/files/../../../etc/passwd`,
    `${U}/../${OTHER}/files/a.pdf`,
    `${U}/files/%2e%2e/%2e%2e/secret.pdf`,
    `${U}/files/..\\..\\secret.pdf`,
    `${U}/files/..`,
  ]) {
    assert.equal(isOwnPath(path, U), false, `${path} should be refused`);
  }
});

test("an empty path or an empty user is never a match", () => {
  assert.equal(isOwnPath("", U), false);
  assert.equal(isOwnPath("   ", U), false);
  assert.equal(isOwnPath(`${U}/files/a.pdf`, ""), false);
});

test("a filename with spaces is still yours", () => {
  // Real uploads arrive like this: the name is stored with its spaces intact, so
  // the ownership check has to see through them.
  assert.equal(isOwnPath(`${U}/files/lec 1_OS_.pdf`, U), true);
  assert.equal(isOwnPath(`${U}/files/summary (final) v2.pdf`, U), true);
  assert.equal(isOwnPath(`${OTHER}/files/lec 1_OS_.pdf`, U), false);
});

test("only the formats a model reads are given a mime", () => {
  assert.equal(mimeForName("Lecture 3.pdf"), "application/pdf");
  assert.equal(mimeForName("page.PNG"), "image/png");
  assert.equal(mimeForName("page.jpeg"), "image/jpeg");
  assert.equal(mimeForName("page.webp"), "image/webp");
  // The uploader accepts these; no model reads them as a page of notes.
  for (const name of ["a.pptx", "a.docx", "a.gif", "a.svg", "a.zip", "noext"]) {
    assert.equal(mimeForName(name), "", `${name} should have no mime`);
  }
});

test("a name with spaces still resolves to a mime", () => {
  assert.equal(mimeForName("lec 1_OS_.S._.pdf"), "application/pdf");
  assert.equal(mimeForName("my notes.docx"), "");
});

test("the stored path is passed through verbatim, never encoded", async () => {
  const text = await fetchSrc();
  // This is the bug that made every real file unreadable: `lec 1_OS_.pdf` is
  // stored with a space, and `lec%201_OS_.pdf` is a different, absent object, so
  // the read returned a bare 400 and the app called the file unreadable.
  assert.ok(
    !/encodeURIComponent/.test(text),
    "the stored path must not be percent-encoded before the download",
  );
  assert.match(text, /\.download\(\s*path,\s*\{\},\s*\{\s*signal:\s*ac\.signal/);
});

test("the read goes through the caller's own storage client", async () => {
  const text = await fetchSrc();
  // Authorised by the caller's token, so RLS and the storage policies that allowed
  // the upload are the same ones that allow the read.
  assert.match(text, /storage\s*\n?\s*\.from\(BUCKET\)\s*\n?\s*\.download\(/);
  assert.match(text, /Authorization: `Bearer \$\{token\}`/);
  assert.ok(
    !/await fetch\(/i.test(text),
    "there should be no raw fetch of a storage url",
  );
});

test("the row decides the path, not the request body", async () => {
  const text = await fetchSrc();
  // The client's own file_path arrives on the schema but is never used: a
  // material id paired with someone else's path must not read that path.
  assert.match(text, /\.select\("file_path,title"\)/);
  assert.match(text, /isOwnPath\(path, userId\)/);
});

test("the request body carries a reference, not the file", async () => {
  const schema = await schemaSrc();
  const block = schema.slice(
    schema.indexOf("export const materialRef"),
    schema.indexOf("export const flashcardsBodySchema"),
  );
  assert.match(block, /id:/);
  assert.match(block, /file_path:/);
  assert.ok(
    !/dataUrl|base64/.test(block),
    "the material reference must not carry the file's bytes",
  );
});

test("the read is capped, and the cap is checked against the real size", async () => {
  const text = await fetchSrc();
  assert.match(text, /MAX_READ_BYTES = 10 \* 1024 \* 1024/);
  assert.match(text, /blob\.size > MAX_READ_BYTES/);
  assert.match(text, /bytes\.byteLength > MAX_READ_BYTES/);
});

test("the client and the server agree on the size cap", async () => {
  const [fetchText, cardsText] = await Promise.all([fetchSrc(), cardsSrc()]);
  const server = fetchText.match(/MAX_READ_BYTES = (\d+) \* 1024 \* 1024/)?.[1];
  const client = cardsText.match(/MAX_CARDABLE_BYTES = (\d+) \* 1024 \* 1024/)?.[1];
  // Two different numbers would grey out files the server would happily read, or
  // fail files the button promised would work.
  assert.equal(server, client, "the two caps must be the same size");
});

test("the dialog reads the body as text so a platform error survives", async () => {
  // A 413 arrives as plain text. `.json()` on it throws, and the old code threw
  // the reason away and showed "That did not work" instead.
  const text = await dialogSrc();
  assert.match(text, /await res\.text\(\)/);
  assert.ok(
    !/\.json\(\)\.catch/.test(text),
    "the dialog must not swallow a non-JSON error body",
  );
});

test("the bucket name is not imported from a client module", async () => {
  // The bug this guards: BUCKET used to come from db/storage.ts, which is
  // "use client". Server code importing a value from a client module gets a
  // client-reference proxy, not the string, so `storage.from(BUCKET)` named no
  // bucket and Supabase answered NoSuchBucket - which reads as a missing file.
  const text = await fetchSrc();
  assert.match(text, /import \{ BUCKET \} from "@\/lib\/db\/bucket"/);
  assert.ok(
    !/import \{[^}]*BUCKET[^}]*\} from "@\/lib\/db\/storage"/.test(text),
    "the bucket name must not come from the 'use client' storage module",
  );

  // And the constant itself must be a plain literal in a module with no directive.
  const bucket = await readFile(new URL("../src/lib/db/bucket.ts", import.meta.url), "utf8");
  assert.match(bucket, /export const BUCKET = "materials"/);
  // The directive itself, not the phrase: the file explains this hazard in prose.
  assert.ok(
    !/^\s*["']use client["'];?\s*$/m.test(bucket),
    "db/bucket.ts must stay free of the 'use client' directive so the server can read the value",
  );
});

test("no server module imports a value from a client-only module", async () => {
  const { readdir } = await import("node:fs/promises");
  const clientOnly = ["storage", "supabase-client", "events"];
  const bad: string[] = [];

  async function walk(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) { await walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(e.name)) continue;
      const text = await readFile(full, "utf8");
      if (!text.includes('"server-only"')) continue;
      for (const mod of clientOnly) {
        // storage/bucket.ts is the deliberate exception: a shared constant module.
        if (mod === "storage" && /from "@\/lib\/db\/bucket"/.test(text)) continue;
        const re = new RegExp(`import \\{[^}]*\\} from "@/lib/db/${mod}"`);
        if (re.test(text)) bad.push(`${full} imports @/lib/db/${mod}`);
      }
    }
  }
  await walk(new URL("../src", import.meta.url).pathname.replace(/^\//, "").replace(/^([A-Za-z]):/, "$1:/"));

  assert.deepEqual(bad, [], "server modules must not import from client-only modules");
});

test("a file that cannot be read is reported, not silently dropped", async () => {
  const route = await routeSrc();
  // Nothing readable at all is refused outright, rather than returning an empty
  // list that reads as "your notes had nothing in them".
  assert.match(route, /MATERIALS_UNREADABLE/);
  assert.match(route, /status: 422/);
  // A partial failure is reported alongside whatever did work.
  assert.match(route, /skipped:/);
});

test("every failure reason has a message the student can act on", async () => {
  const text = await fetchSrc();
  const block = text.slice(text.indexOf("export function skipReason"));
  for (const reason of ["NO_SESSION", "NOT_YOURS", "MISSING", "TOO_BIG", "EMPTY_FILE", "TIMEOUT", "READ_FAILED"]) {
    assert.match(block, new RegExp(`${reason}:`), `${reason} should have its own message`);
  }
  // A reason with no message of its own falls back to the generic one, which is
  // how a storage 400 originally reached the student as "could not read that file".
  assert.match(block, /table\[reason\] \?\? table\.READ_FAILED/);
});

test("the dialog sends the token the route needs to read the file", async () => {
  const text = await dialogSrc();
  // It used to carry its own copy of this helper, which is how a second copy
  // ended up not being called on some other call site. The token is read in one
  // place now, so all this has to do is use it.
  assert.match(
    text,
    /import \{ authHeader \} from "@\/lib\/db\/supabase-client"/,
    "the dialog does not use the shared authHeader",
  );
  assert.match(text, /authHeader\(\)/, "the dialog fetches without sending the token");
  // And the shared helper is the one that reads the session and builds the header.
  const shared = await readFile(
    new URL("../src/lib/db/supabase-client.ts", import.meta.url),
    "utf8",
  );
  assert.match(shared, /getSession\(\)/);
  assert.match(shared, /Authorization.*Bearer|access_token/);
});