import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * Is the reminder delivery running?
 *
 * This is the question that could not be answered before, and the reason a
 * phone with a working push subscription sat silent through an exam: the
 * delivery job calls a database function that the database did not have, so it
 * failed on every tick, and a job that fails on every tick looks exactly like a
 * job that had nothing to send.
 *
 * The heartbeat is what tells the two apart, and the schema is what makes the
 * heartbeat possible.
 */

const sql = () => readFile(new URL("../supabase/09-push-subscriptions.sql", import.meta.url), "utf8");
const sendRoute = () =>
  readFile(new URL("../src/app/api/push/send/route.ts", import.meta.url), "utf8");
const healthRoute = () =>
  readFile(new URL("../src/app/api/push/health/route.ts", import.meta.url), "utf8");
const server = () =>
  readFile(new URL("../src/lib/push-server.ts", import.meta.url), "utf8");

test("the job reads its address through a function the database actually has", async () => {
  const text = await sql();
  // The getter is what the job calls. It has to exist, and it has to read the
  // column the database really has.
  assert.match(text, /create or replace function public\.get_secret\(p_name text\)/);
  assert.match(text, /select coalesce\(value, secret\) from public\.app_secrets/);
});

test("the secrets table is repaired rather than replaced", async () => {
  const text = await sql();
  // The live table was created with `secret`, this file writes `value`. Both are
  // added, and the values are copied across, so a database that already has the
  // table in either shape works.
  assert.match(text, /alter table public\.app_secrets add column if not exists value text/);
  assert.match(text, /alter table public\.app_secrets add column if not exists secret text/);
  assert.match(text, /update public\.app_secrets set value = secret where value is null/);
  assert.match(text, /update public\.app_secrets set secret = value where secret is null/);
  // And the setter writes both, because the live column is NOT NULL.
  assert.match(text, /insert into public\.app_secrets \(name, value, secret\)/);
});

test("running the file again cannot leave two delivery jobs", async () => {
  const text = await sql();
  // A job is identified by what it does, not by what it is called: a database
  // that ran an older version of this file has a job under a name this file
  // does not know, and two jobs means every reminder arrives twice.
  assert.match(text, /from cron\.job where command like '%api\/push\/send%'/);
  assert.match(text, /perform cron\.unschedule\(r\.jobid\)/);
});

test("the schedule can be applied without pg_cron being there yet", async () => {
  const text = await sql();
  // A `create extension` for an extension that is not enabled fails with a
  // permission error. The file has to survive that and say what to do, rather
  // than stopping half way through with a message about permissions.
  assert.match(text, /create extension if not exists pg_cron/);
  assert.match(text, /create extension if not exists pg_net/);
  assert.match(text, /exception when others then[\s\S]{0,200}raise notice/);
});

test("the job is told to read the address it should be calling", async () => {
  const text = await sql();
  assert.match(text, /cron\.schedule\(\s*'jadwali-push',\s*'\* \* \* \* \*'/);
  assert.match(text, /net\.http_post\(/);
  assert.match(text, /'x-cron-secret', public\.get_secret\('push_cron_secret'\)/);
});

test("every run of the job leaves a heartbeat", async () => {
  const text = await sendRoute();
  // Written whether or not anything was sent: "the job ran and had nothing to
  // say" and "the job did not run" have to look different.
  assert.match(text, /await recordTick\(sb, summary\)/);
});

test("the heartbeat has a table to live in", async () => {
  const text = await sql();
  assert.match(text, /create table if not exists public\.push_ticks/);
  assert.match(text, /at timestamptz not null default now\(\)/);
  // And it is closed to browsers, like the deliveries table.
  assert.match(text, /alter table public\.push_ticks enable row level security/);
});

test("the heartbeat is written through the service role, not a browser", async () => {
  const text = await server();
  assert.match(text, /from\(TICKS\)\.insert\(/);
  assert.match(text, /const TICKS = "push_ticks"/);
});

test("there is an endpoint that says whether the job is alive", async () => {
  const text = await healthRoute();
  assert.match(text, /lastTick\(sb\)/);
  assert.match(text, /deliveryConfig\(sb\)/);
  // It has to be able to say "no", and to say "never ran" as its own answer.
  assert.match(text, /jobAlive/);
  assert.match(text, /minutesSinceTick/);
});

test("the health endpoint never prints the secret", async () => {
  const text = await healthRoute();
  assert.ok(
    !/secret\s*[:,]/i.test(text.replace(/cronSecretSet/g, "")),
    "the endpoint reports whether a secret is set, never the secret itself",
  );
  assert.match(text, /cronSecretSet/);
});
