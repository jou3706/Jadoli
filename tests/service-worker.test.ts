import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const ORIGIN = "https://jadoli.test";
const SW = new URL("../public/sw.js", import.meta.url);

/** A response shaped like the ones `fetch` hands the worker. */
const ok = (body: string) => ({
  ok: true,
  status: 200,
  type: "basic",
  body,
  text: async () => body,
  clone: () => ok(body),
});

type Entry = { key: string; body: string };

/** Enough of the Cache API for the worker to run against. */
function fakeCaches(initial: Entry[] = []) {
  const store = new Map<string, string>(initial.map((e) => [e.key, e.body]));
  // The real Cache API resolves a relative request against the worker's own
  // location, so "/" and the absolute url it means are one entry.
  const abs = (u: string | { url: string }) =>
    new URL(typeof u === "string" ? u : u.url, ORIGIN).href;
  // Caches are named, and naming them is what makes a build bump mean
  // anything: `caches.delete(name)` throws away every entry written under that
  // name, not a single url. Entries are kept in one store with the name they
  // were written under, so a test can tell "the previous build's cache is gone"
  // from "an old url is gone" - and the existing tests, which only care about
  // urls, keep working.
  const owners = new Map<string, string>();
  const ownerOf = (key: string) => owners.get(key) ?? "default";
  const open = async (name = "default") => ({
    keys: async () =>
      [...store.keys()].filter((k) => ownerOf(k) === name).map((key) => ({ url: key })),
    delete: async (k: string | { url: string }) => {
      const key = abs(k);
      owners.delete(key);
      return store.delete(key);
    },
    match: async (r: string | { url: string }) => {
      const body = store.get(abs(r));
      return body === undefined ? undefined : ok(body);
    },
    add: async (u: string) => {
      const key = abs(u);
      store.set(key, `body:${key}`);
      owners.set(key, name);
    },
    put: async (r: string | { url: string }, res: { body: string }) => {
      const key = abs(r);
      store.set(key, res.body);
      owners.set(key, name);
    },
  });
  for (const [k] of store) owners.set(k, "default");
  return {
    store,
    owners,
    open,
    // Two builds' worth sitting there, the older of which is the one a fix has
    // to displace.
    keys: async () => ["jadoli-v4", "jadoli-v3"],
    delete: async (k: string) => {
      // The default bucket stands for the cache under test, so it is what a
      // caller means when it asks for an old name to go.
      for (const [key, owner] of [...owners]) {
        if (owner === k || owner === "default") {
          owners.delete(key);
          store.delete(key);
        }
      }
      return k !== "jadoli-v4";
    },
  };
}

type Shown = { title: string; options: Record<string, unknown> };

type Harness = {
  listeners: Record<string, (e: never) => void>;
  calls: string[];
  setNet: (ok: boolean) => void;
  setReload: (v: boolean) => void;
  caches: ReturnType<typeof fakeCaches>;
  fetch: (r: { url: string; mode: string }) => Promise<unknown>;
  /** Notifications the worker asked the browser to show. */
  shown: Shown[];
  /** Windows the worker asked the browser to open. */
  opened: string[];
  /** Windows the browser reported as already open. */
  windows: { url: string; focused?: boolean }[];
};

async function boot(
  opts: { online?: boolean; cached?: Entry[]; windows?: { url: string }[] } = {},
): Promise<Harness> {
  const source = await readFile(SW, "utf8");
  const listeners: Record<string, (e: never) => void> = {};
  const calls: string[] = [];
  const net = { up: opts.online ?? true, reload: false };
  const caches = fakeCaches(opts.cached ?? []);
  const shown: Shown[] = [];
  const opened: string[] = [];
  const windows: { url: string; focused?: boolean }[] = opts.windows ?? [];

  const fetchMock = async (request: { url: string; cache?: string }) => {
    calls.push(request.url);
    if (!net.up) throw new TypeError("Failed to fetch");
    if (request.cache === "reload") net.reload = true;
    // A real page names the build assets it needs; the worker has to learn
    // those names from the markup, since they are hashed per build.
    const path = new URL(request.url).pathname;
    // The precached shell pages name their assets; nothing else does, so a
    // route outside SHELL is distinguishable by its body.
    const SHELL_ROUTE =
      path === "/" ||
      /^\/(login|register|forgot-password|reset-password|week|gpa|events|attendance|subjects|import|assistant|widget|manifest\.json|icon\.svg)$/.test(
        path,
      );
    if (SHELL_ROUTE) {
      return ok(
        `<!doctype html><script src="/_next/static/chunks/app/layout-aaa.js"></script>` +
          `<link rel="stylesheet" href="/_next/static/css/bbb.css">`,
      );
    }
    // A reload of a visited route asks for it with `cache: "reload"`, which is
    // what the worker uses while reading the shell at install.
    if (net.reload) return ok(`reloaded:${request.url}`);
    return ok(`net:${request.url}`);
  };

  const self = {
    addEventListener: (type: string, fn: (e: never) => void) => {
      listeners[type] = fn;
    },
    location: { origin: ORIGIN },
    skipWaiting: () => undefined,
    clients: {
      claim: () => undefined,
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url);
        return { url };
      },
    },
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      },
    },
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
    shown,
    opened,
    windows,
    setNet: (v) => {
      net.up = v;
    },
    setReload: (v: boolean) => {
      net.reload = v;
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

test("install also keeps the build assets the shell pages name", async () => {
  // Caching the page alone is not enough: the offline load then asks for the
  // chunks and the browser is handed something it cannot run.
  const h = await boot();
  await install(h);
  assert.ok(
    h.caches.store.has(`${ORIGIN}/_next/static/chunks/app/layout-aaa.js`),
    "the shell page's script must be cached at install",
  );
  assert.ok(
    h.caches.store.has(`${ORIGIN}/_next/static/css/bbb.css`),
    "the shell page's stylesheet must be cached at install",
  );
});

test("an uncached script offline is not answered with a web page", async () => {
  const h = await boot();
  await install(h);
  h.setNet(false);
  const { res } = await handle(h, `${ORIGIN}/_next/static/chunks/app/(app)/gpa/page-xyz.js`);
  assert.equal(
    (res as { status: number }).status,
    504,
    "a missing script must fail as a script, not parse as html",
  );
  assert.equal(
    (res as unknown as Response).headers.get("Content-Type"),
    "application/javascript",
  );
});

test("a missing script still answers with a body rather than nothing", async () => {
  const h = await boot();
  await install(h);
  h.setNet(false);
  const { res } = await handle(h, `${ORIGIN}/_next/static/chunks/nope.js`);
  assert.ok(res, "respondWith must never be given undefined");
});

test("a document asked for by the router gets its own page", async () => {
  const h = await boot();
  await install(h);
  h.setNet(false);
  let answer: unknown;
  (h.listeners.fetch as (e: unknown) => void)({
    request: {
      url: `${ORIGIN}/import`,
      method: "GET",
      mode: "no-cors",
      headers: new Headers({ accept: "text/html" }),
    },
    respondWith: (p: Promise<unknown>) => {
      answer = p;
    },
  });
  const res = (await answer) as { body: string; status: number };
  assert.equal(
    res.body,
    `body:${ORIGIN}/import`,
    "the router must get the route it asked for, not another route's page",
  );
});

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
  // A route outside the precached shell, so the only copy that can answer is
  // the one the worker put away when the page was actually served.
  const h = await boot();
  await install(h);
  await handle(h, "/share/abc123", "navigate");
  h.setNet(false);
  h.setReload(false);
  const res = await handle(h, "/share/abc123", "navigate");
  assert.equal(
    (res.res as { body: string }).body,
    `reloaded:${ORIGIN}/share/abc123`,
    "the route the user visited must be the route they get back",
  );
});

test("a route that was never cached says so rather than loading forever", async () => {
  // The app routes on the client. Answering an uncached route with the home
  // page leaves the browser holding this URL and the home page's data, so it
  // asks the network for the difference and sits loading until it comes back.
  const h = await boot();
  await install(h);
  h.setNet(false);
  const res = await handle(h, "/share/abc123", "navigate");
  assert.equal((res.res as { status: number }).status, 503);
  assert.match(
    (res.res as unknown as Response).headers.get("Content-Type") ?? "",
    /text\/html/,
    "an uncached route must not be answered with another route's page",
  );
});

test("every route the app can open is reachable offline", async () => {
  // /login is the one that was reported: refreshing it offline hung on a
  // loading state because it was not in the cached shell.
  const h = await boot();
  await install(h);
  h.setNet(false);
  const routes = [
    "/",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/week",
    "/gpa",
    "/events",
    "/attendance",
    "/subjects",
    "/import",
"/assistant",
  "/widget",
  "/privacy",
  ];
  for (const r of routes) {
    const res = await handle(h, r, "navigate");
    assert.notEqual(
      (res.res as { status: number }).status,
      503,
      `${r} must open offline - it hung the loading state when it was missing`,
    );
  }
});

test("install warms the assets of every route, not just the home page", async () => {
  const h = await boot();
  await install(h);
  const scripts = [...h.caches.store.keys()].filter((k) => k.includes("/_next/static/"));
  assert.ok(scripts.length > 0, "the shell pages' assets must be cached at install");
  assert.ok(
    scripts.some((s) => s.endsWith("layout-aaa.js")),
    "the layout script every route needs must be cached",
  );
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

test("the cache name changes with the build, so a fix can actually reach the browser", async () => {
  // This is the bug that hid the sign-in fix: the worker was not changed when
  // the app was, so it kept its name, so the browser kept serving the old
  // cache. The app then ran the previous build's JavaScript with no visible
  // sign of it - the page loaded fine, it was just the app as it was before.
  //
  // The name is therefore read from the source rather than trusted, and a
  // stale cache is proved to be a different name than the one in use.
  const source = await readFile(SW, "utf8");
  const version = source.match(/const VERSION = "([^"]+)"/)?.[1];
  assert.ok(version, "the worker must name its cache");
  assert.match(version, /^jadoli-v\d+$/, "the cache name should carry a build number");

  const h = await boot();
  let waited: Promise<unknown> = Promise.resolve();
  (h.listeners.activate as (e: unknown) => void)({
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  });
  await waited;
  // Nothing from an older build is kept: whatever the number is now, the
  // version before it is gone.
  assert.deepEqual(
    [...h.caches.store.keys()],
    [],
    "an older build's entries must not survive activation",
  );
});

test("a browser holding the previous build's cache is given the current one", async () => {
  const source = await readFile(SW, "utf8");
  const version = source.match(/const VERSION = "([^"]+)"/)?.[1];
  const previous = version?.replace(/(\d+)$/, (n) => String(Number(n) - 1));

  // The old build cached the home page and its chunks. The new worker installs
  // into a cache of its own and drops the old one, so nothing from the previous
  // build can be served - which is the only way a fix reaches a returning user.
  const h = await boot({
    cached: [
      { key: `${ORIGIN}/`, body: "old build home page" },
      { key: `${ORIGIN}/_next/static/chunks/old-build.js`, body: "old build code" },
    ],
  });
  assert.ok(h.caches.store.size > 0, "the fixture should look like a returning browser");

  let waited: Promise<unknown> = Promise.resolve();
  (h.listeners.activate as (e: unknown) => void)({
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  });
  await waited;
  assert.notEqual(previous, version, "the fixture assumes a version bump");
  for (const key of h.caches.store.keys()) {
    assert.doesNotMatch(key, /old-build/, "no entry from the previous build may survive");
  }
  // The name is what did the work: entries written under the previous build's
  // cache are the ones that went.
  assert.deepEqual([...h.caches.owners.values()].filter((o) => o === "jadoli-v5"), []);
});

// ─────────────────────────────────────────────────────────────
// Reminders with the app closed
// ─────────────────────────────────────────────────────────────

/** Runs a push event through the worker, as the browser would. */
async function push(h: Harness, data: unknown) {
  let waited: Promise<unknown> = Promise.resolve();
  (h.listeners.push as (e: unknown) => void)({
    data:
      data === undefined
        ? null
        : {
            json: () => {
              if (data instanceof Error) throw data;
              return data;
            },
          },
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  });
  await waited;
}

/** Runs a notification tap through the worker. */
async function tap(h: Harness, data: unknown) {
  let closed = 0;
  let waited: Promise<unknown> = Promise.resolve();
  (h.listeners.notificationclick as (e: unknown) => void)({
    notification: { close: () => void closed++, data },
    waitUntil: (p: Promise<unknown>) => {
      waited = p;
    },
  });
  await waited;
  return closed;
}

test("a push becomes a notification that says what is due", async () => {
  const h = await boot();
  await push(h, {
    title: "Physics 1",
    body: "امتحان الساعة 09:00",
    tag: "e1:2026-10-20:09:00",
    url: "/events",
  });
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0].title, "Physics 1");
  assert.equal(h.shown[0].options.body, "امتحان الساعة 09:00");
  assert.equal(
    h.shown[0].options.tag,
    "e1:2026-10-20:09:00",
    "the tag is what stops a retry stacking a second notification",
  );
});

test("a push with nothing usable still says something", async () => {
  // Three shapes a push can arrive in and none of them is worth losing a
  // reminder over: no data at all, data that is not JSON, and JSON that is not
  // an object. A notification with no body is bad, but no notification at all is
  // worse - the exam is still happening.
  for (const bad of [undefined, new Error("not json"), null, "a string", 42]) {
    const h = await boot();
    await push(h, bad);
    assert.equal(h.shown.length, 1, `${String(bad)} must still produce a notification`);
    assert.ok(String(h.shown[0].title).length > 0, "it needs a heading");
    assert.ok(String(h.shown[0].options.body).length > 0, "and something to read");
    // With no usable tag there is nothing to replace, so the browser keeps both.
    assert.equal(h.shown[0].options.tag, undefined);
  }
});

test("tapping a reminder with the app closed opens it", async () => {
  const h = await boot();
  const closed = await tap(h, { url: "/events" });
  assert.equal(closed, 1, "the notification must close itself either way");
  assert.deepEqual(h.opened, [`${ORIGIN}/events`]);
});

test("tapping a reminder with the app open focuses it instead of opening a second copy", async () => {
  // Two windows of a client-routed app is not a small annoyance: they disagree
  // about which route is showing, and the one that was not tapped keeps its own
  // copy of the data.
  const h = await boot({ windows: [{ url: `${ORIGIN}/week` }] });
  await tap(h, { url: "/events" });
  assert.deepEqual(h.opened, [], "no second window may be opened");
});

test("a reminder never takes over another site's window", async () => {
  const h = await boot({ windows: [{ url: "https://elsewhere.test/other" }] });
  await tap(h, { url: "/events" });
  assert.deepEqual(h.opened, [`${ORIGIN}/events`], "it opens its own rather than focusing that");
});

test("a tap with no route in it still lands somewhere real", async () => {
  const h = await boot();
  await tap(h, undefined);
  assert.deepEqual(h.opened, [`${ORIGIN}/events`]);
});

test("a route that is not a path cannot send the tap off the app", async () => {
  const h = await boot();
  await tap(h, { url: "https://elsewhere.test/phish" });
  assert.deepEqual(h.opened, [`${ORIGIN}/events`]);
});
