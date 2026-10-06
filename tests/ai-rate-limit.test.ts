import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * The AI routes cost money per call and the keys are server-side, so nothing in
 * the app stops one person from calling /api/ai/chat in a loop.
 *
 * Several of these routes never read a material, so before the quota there was
 * nothing at all in them to tell one student from another: the server answered
 * whoever asked, on your key. Verifying the bearer token is what makes the
 * allowance countable per person, and on its own it stops the anonymous caller.
 *
 * These read the code and the SQL as committed, because the failure mode is
 * silent: a route that quietly stops calling the guard still compiles, still
 * passes every unit test, and still spends money.
 */

const read = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");

/** Every route that reaches a provider. Written out, not globbed: a new route
 * that is not on this list is a route nothing is checking. */
const AI_ROUTES = [
  "chat",
  "cover",
  "flashcards",
  "import",
  "notes",
  "quiz",
  "summary",
  "syllabus",
];

/** The first thing on each route that can spend a key or a provider call. */
const SPEND = [
  "taskModel(",
  "completeJson(",
  "streamChat(",
  "loadMaterials(",
  "candidates(",
];

const routeSrc = (name: string) => read(`../src/app/api/ai/${name}/route.ts`);
const guardSrc = () => read("../src/lib/ai/rate-limit.ts");

test("every AI route calls the guard", async () => {
  for (const name of AI_ROUTES) {
    const text = await routeSrc(name);
    assert.match(
      text,
      /guardAiRequest\(req/,
      `/api/ai/${name} never calls guardAiRequest, so it spends keys for anyone who asks`,
    );
    assert.match(
      text,
      /if \(refused\) return refused;/,
      `/api/ai/${name} calls the guard but never acts on a refusal`,
    );
  }
});

test("no key is spent before the allowance is taken", async () => {
  // The ordering is the whole point. A guard placed after the first provider call
  // reports a refusal while the money has already been spent, which is a limit
  // that does not limit.
  for (const name of AI_ROUTES) {
    const text = await routeSrc(name);
    const guardAt = text.indexOf("guardAiRequest(req");
    assert.ok(guardAt > 0, `/api/ai/${name} has no guard`);
    for (const call of SPEND) {
      const at = text.indexOf(call);
      if (at < 0) continue;
      assert.ok(
        guardAt < at,
        `/api/ai/${name} calls ${call} at offset ${at}, before the guard at ${guardAt}`,
      );
    }
  }
});

test("a malformed request costs nothing", async () => {
  // Validation is local and free, so it runs first: otherwise a request that was
  // never going to be served still spends an allowance unit.
  for (const name of AI_ROUTES) {
    const text = await routeSrc(name);
    const guardAt = text.indexOf("guardAiRequest(req");
    const at = text.indexOf("safeParse(");
    if (at < 0) continue;
    assert.ok(
      at < guardAt,
      `/api/ai/${name} takes quota before validating, so junk burns the allowance`,
    );
  }
});

test("the caller cannot say who they are", async () => {
  // The user id comes from the verified token, never from the request. If it were
  // read from the body, anyone could charge their spending to somebody else, or
  // to nobody by sending a random id.
  const text = await guardSrc();
  assert.match(
    text,
    /auth\.getUser\(token\)/,
    "the guard does not verify the token, so it cannot know who is calling",
  );
  assert.match(text, /p_user: data\.user\.id/, "the quota is not charged to the verified user");
  assert.doesNotMatch(
    text,
    /user_id\s*[:=]\s*\(body|body as[^)]*user/i,
    "the guard reads a user id out of the request body",
  );
});

test("a request with no token is refused", async () => {
  const text = await guardSrc();
  assert.match(text, /if \(!token\) return unauthenticated/, "a tokenless request is not refused");
  assert.match(text, /status: 401/, "an unauthenticated request is not answered with a 401");
});

test("running out says so, and says when", async () => {
  const text = await guardSrc();
  assert.match(text, /status: 429/, "an exhausted allowance is not a 429");
  // A bare 429 leaves the client to invent a message; the header and the body
  // field let it show the real time the allowance returns. The header is
  // seconds until the reset, worked out from the recorded reset moment, never
  // a hardcoded hour.
  assert.match(text, /"retry-after": retryAfter/);
  assert.match(text, /Date\.now\(\)/);
  assert.match(text, /AI_RATE_LIMIT/);
  assert.match(text, /resets_at/);
});

test("local-first keeps working with no accounts and no database", async () => {
  // Supabase is optional by design, and requiring a token where there is no auth
  // would break a setup that works on purpose: one student, no accounts.
  const text = await guardSrc();
  assert.match(
    text,
    /if \(!admin_\) return null;/,
    "the guard refuses requests when Supabase is not configured, breaking local-first",
  );
});

test("a missing migration does not take the AI features offline", async () => {
  // Deliberate, and the opposite of the auth check: a deployment that has not run
  // the migration yet should keep working with the exposure, rather than 503 on
  // every AI route for everybody.
  const text = await guardSrc();
  assert.match(
    text,
    /if \(rpcError\) return null;/,
    "the guard fails closed on an rpc error, so an unrun migration breaks the app",
  );
});

test("the allowance is taken atomically", async () => {
  // Read-then-write without the lock lets two simultaneous calls both read the
  // same count and both spend it, so the real ceiling is whatever the race allows.
  for (const rel of ["../supabase/10-ai-rate-limit.sql", "../supabase/schema.sql"]) {
    const sql = await read(rel);
    assert.match(sql, /create table if not exists public\.ai_usage\b/i, `${rel}: no ai_usage table`);
    assert.match(sql, /create or replace function public\.consume_ai_quota/i, `${rel}: no function`);
    assert.match(sql, /for update/i, `${rel}: the counter is not locked, so calls can race`);
    assert.match(
      sql,
      /security definer/i,
      `${rel}: the function is not security definer, so RLS blocks the update`,
    );
    // Without this, search_path is caller-controlled inside a definer function.
    assert.match(sql, /set search_path = public/i, `${rel}: search_path is not pinned`);
  }
});

test("the quota table is closed to the browser", async () => {
  // RLS on with no policy means the anon key, which is public, cannot read or
  // write the row. The function is the only way in.
  for (const rel of ["../supabase/10-ai-rate-limit.sql", "../supabase/schema.sql"]) {
    const sql = await read(rel);
    assert.match(
      sql,
      /alter table public\.ai_usage enable row level security/i,
      `${rel}: RLS is not enabled on ai_usage`,
    );
    assert.doesNotMatch(
      sql,
      /create policy[^;]*on public\.ai_usage/i,
      `${rel}: a policy lets a client touch the quota table directly`,
    );
  }
});

test("execute is granted to signed-in callers, and to nobody else", async () => {
  for (const rel of ["../supabase/10-ai-rate-limit.sql", "../supabase/schema.sql"]) {
    const sql = await read(rel);
    assert.match(
      sql,
      /revoke all on function public\.consume_ai_quota[\s\S]*?from public/i,
      `${rel}: execute is not revoked from public first`,
    );
    assert.match(
      sql,
      /grant execute on function public\.consume_ai_quota[\s\S]*?to authenticated/i,
      `${rel}: signed-in callers cannot call the function`,
    );
  }
});

test("the window is fixed when it starts, not slid by every call", async () => {
  // A window that restarts on each call lets a caller who keeps the gap just under
  // the limit run all day, which is the one thing a per-hour ceiling is for.
  for (const rel of ["../supabase/10-ai-rate-limit.sql", "../supabase/schema.sql"]) {
    const sql = await read(rel);
    assert.match(
      sql,
      /cur\.window_start \+ window_len <= now_ts/,
      `${rel}: the window does not expire from its own start`,
    );
  }
});

test("a fresh project and an existing one both get the quota", async () => {
  // schema.sql is the whole snapshot; the numbered file is the repair for a
  // database that already exists. Shipping only one of them leaves the other
  // kind of install unprotected, which is how the push tables were nearly missed.
  const schema = await read("../supabase/schema.sql");
  const migration = await read("../supabase/10-ai-rate-limit.sql");
  assert.match(schema, /create table if not exists public\.ai_usage\b/i);
  assert.match(migration, /create table if not exists public\.ai_usage\b/i);
  assert.match(migration, /create or replace function public\.consume_ai_quota/i);
});

test("the allowance is documented, not a buried default", async () => {
  const env = await read("../.env.example");
  assert.match(env, /AI_RATE_LIMIT_PER_HOUR/, ".env.example does not document the limit");
});

/**
 * The other half of the same mistake.
 *
 * Requiring a token on the server is only half the change: every caller in the
 * browser has to send one, and a caller that does not is now a 401 with nothing
 * to point at. The first pass at this checked the routes and missed three call
 * sites, so the chat, the timetable import and the cover all answered
 * UNAUTHENTICATED. Nothing in a route-level test can see that, because the missing
 * header is on the other side of the wire.
 *
 * So this reads the browser side: a POST to a guarded route must carry the token.
 */
test("every guarded route has a browser caller, and that caller sends the token", async () => {
  // Two shapes reach these routes. Most post to a literal "/api/ai/...", but the
  // summary and notes buttons go through the shared read() helper and pass the
  // route as an argument, so the fetch itself says only `fetch(route)`. Checking
  // one shape misses the other, which is how three of these call sites shipped
  // without a token.
  const files = await collectClientFetchers();

  for (const name of AI_ROUTES) {
    const literal = `/api/ai/${name}`;

    const direct = files.filter((f) => f.route.startsWith(literal) && f.method === "POST");
    if (direct.length > 0) {
      for (const { rel, text, headersAt } of direct) {
        assert.ok(
          /authHeader\(\)/.test(text.slice(headersAt, headersAt + 400)),
          `${rel} posts to ${literal} with no Authorization header, so the route answers UNAUTHENTICATED`,
        );
      }
      continue;
    }

    // No literal caller, so it must be passed to the shared read() helper, which
    // is what summary and notes do.
    const helper = await read("../src/components/print/material-read.ts");
    const every = await collectBrowserFiles();
    assert.ok(
      every.some((f) => f.text.includes(`"${literal}"`)),
      `nothing in the browser calls ${literal}: no literal caller and not passed to the shared read()`,
    );
    const fetchAt = helper.indexOf("await fetch(");
    assert.ok(fetchAt > 0, "the shared read() no longer calls fetch");
    assert.match(
      helper.slice(fetchAt, fetchAt + 400),
      /authHeader\(\)/,
      `read() posts to ${literal} for the summary and notes buttons without sending the token`,
    );
  }
});

test("the token helper exists in exactly one place", async () => {
  // It was written out a second time inside the cards dialog. Two copies is how
  // one of them ends up not being called on a new call site.
  const files = await collectClientFetchers();
  const definitions = files.filter((f) =>
    /async function authHeader|const authHeader\s*=|function authHeader/.test(f.text),
  );
  assert.deepEqual(
    definitions.map((f) => f.rel),
    [],
    `authHeader is defined outside supabase-client: ${definitions.map((f) => f.rel).join(", ")}`,
  );
});

/** Every browser-side file, whether or not it calls fetch. */
async function collectBrowserFiles() {
  const roots = ["../src/app", "../src/components"];
  const out: { rel: string; text: string }[] = [];
  for (const root of roots) {
    for (const rel of await walk(root)) {
      out.push({ rel, text: await read(rel) });
    }
  }
  return out;
}

/** Every `fetch("/api/...")` in the browser code, with where its headers are. */
async function collectClientFetchers() {
  const found: {
    rel: string;
    text: string;
    route: string;
    method: string;
    headersAt: number;
  }[] = [];

  for (const { rel, text } of await collectBrowserFiles()) {
    // Every occurrence, not just the first: the assistant page posts to the same
    // route twice and only one of them had the header.
    for (const m of text.matchAll(/fetch\(\s*[`"'](\/api\/[^`"']*)[`"']/g)) {
      const route = m[1];
      const start = m.index ?? 0;
      const headersAt = text.indexOf("headers", start);
      const segment = text.slice(start, start + 600);
      found.push({
        rel,
        text,
        route,
        method: /method:\s*"POST"/.test(segment) ? "POST" : "OTHER",
        headersAt: headersAt >= 0 && headersAt < start + 600 ? headersAt : start,
      });
    }
  }
  return found;
}

/** Files under a directory, as paths relative to the repo root. */
async function walk(rel: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const out: string[] = [];
  for (const entry of await readdir(new URL(rel, import.meta.url), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(child)));
    else if (/\.tsx?$/.test(entry.name)) out.push(child);
  }
  return out;
}