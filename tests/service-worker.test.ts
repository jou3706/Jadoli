import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const ORIGIN = "https://jadoli.test";
const SW = new URL("../public/sw.js", import.meta.url);

/** A response shaped like the ones `fetch` hands the worker. */
const ok = (body: string) => {
  const res = { ok: true, status: 200, type: "basic", body, clone: () => ok(body) };
  return res;
};

type Entry = { key: string; body: string };

/** Enough of the Cache API for the worker to run against. */
function fakeCaches(initial: Entry[] = []) {
  const store = new Map<string, string>(initial.map((e) => [e.key, e.body]));
  // The real Cache API resolves a relative request against the worker's own
  // location, so "/" and the absolute url it means are one entry.
  const abs = (u: string | { url: string }) =>
    new URL(typeof u === "string" ? u : u.url, ORIGIN).href;
  const open = async () => ({
    keys: async () => [...store.keys()].map((key) => ({ url: key })),
    delete: async (k: string | { url: string }) => store.delete(abs(k)),
    match: async (r: string | { url: string }) => {
      const body = store.get(abs(r));
      return body === undefined ? undefined : ok(body);
    },
    add: async (u: string) => {
      const key = abs(u);
      store.set(key, `body:${key}`);
    },
    put: async (r: string | { url: string }, res: { body: string }) => {
      store.set(abs(r), res.body);
    },
  });
  return {
    store,
    open,
    keys: async () => ["jadoli-v4", "jadoli-v3"],
    delete: async (k: string) => k === "jadoli-v3",
  };
}

type Harness = {
  listeners: Record<string, (e: never) => void>;
  calls: string[];
  setNet: (ok: boolean) => void;
  caches: ReturnType<typeof fakeCaches>;
  fetch: (r: { url: string; mode: string }) => Promise<unknown>;
};

async function boot(opts: { online?: boolean; cached?: Entry[] } = {}): Promise<Harness> {
  const source = await readFile(SW, "utf8");
  const listeners: Record<string, (e: never) => void> = {};
  const calls: string[] = [];
  const net = { up: opts.online ?? true };
  const caches = fakeCaches(opts.cached ?? []);

  const fetchMock = async (request: { url: string }) => {
    calls.push(request.url);
    if (!net.up) throw new TypeError("Failed to fetch");
    return ok(`net:${request.url}`);
  };

  const self = {
    addEventListener: (type: string, fn: (e: never) => void) => {
      listeners[type] = fn;
    },
    location: { origin: ORIGIN },
    skipWaiting: () => undefined,
    clients: { claim: () => undefined },
  };

  const ctx = vm.createContext({
    self,
    caches,
    fetch: fetchMock,
    Response,
    Request,
    URL,
    Promise,
  });
  vm.runInContext(source, ctx, { filename: "sw.js" });

  return {
    listeners,
    calls,
    caches,
    setNet: (v) => {
      net.up = v;
    },
    fetch: fetchMock,
  };
}

/** Runs a request through the worker's fetch handler, as a browser would. */
async function handle(
  h: Harness,
  url: string,
  mode: "navigate" | "no-cors" = "no-cors",
): Promise<{ res: unknown; waited: Promise<unknown> }> {
  const request = { url: url.startsWith("http") ? url : ORIGIN + url, method: "GET", mode };
  let answer: unknown;
  let waited: Promise<unknown> = Promise.resolve();
  const event = {
    request,
    respondWith: (p: Promise<unknown>) => {
      answer = p;
    },
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  };
  (h.listeners.fetch as (e: unknown) => void)(event);
  return { res: await answer, waited };
}

const install = async (h: Harness) => {
  let waited: Promise<unknown> = Promise.resolve();
  (h.listeners.install as (e: unknown) => void)({
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  });
  await waited;
};

test("a first visit online fills the shell cache", async () => {
  const h = await boot();
  await install(h);
  for (const p of ["/", "/week", "/gpa", "/events", "/manifest.json", "/icon.svg"]) {
    assert.ok(h.caches.store.has(ORIGIN + p), `${p} must be precached`);
  }
});

test("the page can hand the worker its build assets to keep", async () => {
  const h = await boot();
  const chunk = `${ORIGIN}/_next/static/chunks/app/(app)/week/page-abc123.js`;
  let waited: Promise<unknown> = Promise.resolve();
  (h.listeners.message as (e: unknown) => void)({
    data: { type: "jadoli:warm", urls: [chunk, "https://elsewhere.test/x.js", 42] },
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  });
  await waited;
  assert.ok(h.caches.store.has(chunk), "the hashed chunk must now be cached");
  assert.ok(
    !h.caches.store.has("https://elsewhere.test/x.js"),
    "another origin must not be cached",
  );
});

test("going offline after one online visit still opens the app", async () => {
  // The bug this file exists for: the first visit loads the page's JavaScript
  // before the worker is in control, so unless the page reports those chunks
  // the cache holds HTML that cannot run. Offline then shows a blank page.
  const h = await boot();
  await install(h);
  const chunk = `${ORIGIN}/_next/static/chunks/app/(app)/week/page-abc123.js`;
  await handle(h, chunk);
  let waited: Promise<unknown> = Promise.resolve();
  (h.listeners.message as (e: unknown) => void)({
    data: { type: "jadoli:warm", urls: [chunk] },
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  });
  await waited;

  h.setNet(false);
  h.calls.length = 0;
  const nav = await handle(h, "/", "navigate");
  assert.equal((nav.res as { ok: boolean }).ok, true, "the shell must still open");
  const js = await handle(h, chunk);
  assert.equal(
    (js.res as { body: string }).body,
    `body:${chunk}`,
    "the script the page reported must be the one that loads",
  );
  assert.ok(!h.calls.includes(chunk), "a cached script must not need the network");
});

test("every branch answers offline instead of rejecting", async () => {
  // A resolved `undefined` is rejected by respondWith with an InvalidStateError,
  // which blanks the page rather than showing a message.
  const h = await boot();
  await install(h);
  h.setNet(false);
  const seen = ["/", "/week", "/manifest.json", `${ORIGIN}/_next/static/chunks/nope.js`];
  for (const url of seen) {
    const { res } = await handle(h, url, url === "/week" ? "navigate" : "no-cors");
    assert.ok(res, `${url} must resolve to a response`);
    assert.equal((res as { status: number }).status > 0, true, `${url} needs a status`);
  }
});

test("a page visited online is the page that opens offline", async () => {
  const h = await boot();
  await install(h);
  await handle(h, "/events", "navigate");
  h.setNet(false);
  const res = await handle(h, "/events", "navigate");
  assert.equal((res.res as { body: string }).body, `net:${ORIGIN}/events`);
});

test("an unvisited route offline falls back to the shell", async () => {
  const h = await boot();
  await install(h);
  h.setNet(false);
  // /import is a real route but not in the precached shell, so there is
  // nothing but the home page to answer it.
  const res = await handle(h, "/import", "navigate");
  assert.equal((res.res as { body: string }).body, `body:${ORIGIN}/`);
});

test("live data and the server routes are never answered from the cache", async () => {
  const h = await boot();
  await install(h);
  // A stale lecture list or a re-run of the import would be worse than an
  // error, so the worker must not answer for these at all.
  const data = await handle(h, "https://db.supabase.co/rest/v1/Lecture?select=*");
  assert.equal(data.res, undefined, "another origin must reach the network untouched");
  const api = await handle(h, "/api/ai/import");
  assert.equal(api.res, undefined, "an api route must reach the network untouched");
});

test("a hashed script is served from the cache and never refetched", async () => {
  const h = await boot();
  await install(h);
  const chunk = `${ORIGIN}/_next/static/chunks/runtime-aaa.js`;
  await handle(h, chunk);
  await handle(h, chunk);
  await handle(h, chunk);
  assert.equal(h.calls.filter((u) => u === chunk).length, 1, "fetched once, then cached");
});

test("the previous build's cache is dropped on activate", async () => {
  const h = await boot();
  let waited: Promise<unknown> = Promise.resolve();
  (h.listeners.activate as (e: unknown) => void)({
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  });
  await waited;
  assert.deepEqual(h.caches.store.size, 0, "v3 entries must not survive into v4");
});
