/*
 * Offline shell.
 *
 * The cache name is a hand-written constant, bumped by hand. Next.js puts a
 * content hash in every chunk filename, so a new deploy always produces new
 * URLs, and bumping the name is what lets `activate` drop the previous cache
 * instead of leaving it to sit in storage forever.
 *
 * Navigations go to the network first and fall back to the shell. Everything
 * else is served from the cache only when the network is unreachable, so a
 * release reaches people on their next load instead of whenever they happen to
 * clear a cache.
 *
 * Build assets are the exception: their names are hashed by the build, so a
 * cached one is always the right file and can never go stale. They are served
 * from the cache first, which is what makes the first offline load work at all
 * - see `warm` below.
 */

const VERSION = "jadoli-v4";
const SHELL = ["/", "/week", "/gpa", "/events", "/manifest.json", "/icon.svg"];
/** Enough for a few builds' worth of chunks before the oldest are dropped. */
const MAX_STATIC = 150;

const OFFLINE_HTML =
  "<!doctype html><meta charset=utf-8><title>Offline</title>" +
  '<p style="font:16px system-ui;padding:2rem">You are offline and this page ' +
  "was never loaded while you were connected.</p>";

/** Hashed by the build, so a hit is correct by definition and never stale. */
const immutable = (path) => path.startsWith("/_next/static/");

const unavailable = () =>
  new Response(OFFLINE_HTML, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });

/**
 * The answer for something that is not in the cache and cannot be fetched.
 *
 * A page gets a page. Anything else gets an empty body of its own kind:
 * handing an HTML document to the engine that asked for a script, or to the
 * router that asked for flight data, turns a missing file into a parse error
 * that takes the page down instead of one file quietly failing.
 */
const missing = (path) =>
  immutable(path)
    ? new Response("", { status: 504, headers: { "Content-Type": "application/javascript" } })
    : new Response("", { status: 504, headers: { "Content-Type": "text/plain" } });

/** Cache storage is not unbounded; drop the oldest entries once it is. */
const trim = (cache) =>
  cache
    .keys()
    .then((keys) =>
      keys.length > MAX_STATIC
        ? Promise.all(keys.slice(0, keys.length - MAX_STATIC).map((k) => cache.delete(k)))
        : undefined,
    )
    .catch(() => undefined);

const remember = (cache, request, res) => {
  if (!res || !res.ok) return;
  const copy = res.clone();
  cache.put(request, copy).then(() => trim(cache)).catch(() => undefined);
};

/**
 * Reads the pages just cached and keeps the build assets they name.
 *
 * Precaching a page is only half of it: an offline load gets the HTML and then
 * asks for `/_next/static/...`, and if those are missing the browser is handed
 * something it cannot run and the page comes up blank. The chunk names are
 * hashed per build, so they can only be learned from markup that has actually
 * been served - which is what this does for the shell pages.
 */
const warmShellAssets = async (cache) => {
  const pages = await Promise.allSettled(
    SHELL.map((p) => {
      // Resolved here rather than left to `new Request` so the worker does not
      // depend on an implicit base, and so the same code can be exercised off
      // a browser.
      const url = new URL(p, self.location.origin).href;
      return fetch(new Request(url, { cache: "reload" }))
        .then((r) => (r.ok ? r.text() : ""))
        .catch(() => "");
    }),
  );
  const assets = new Set();
  for (const page of pages) {
    if (page.status !== "fulfilled" || !page.value) continue;
    for (const m of page.value.matchAll(/\/_next\/static\/[^"'\\\s<>]+/g)) assets.add(m[0]);
  }
  await Promise.allSettled([...assets].map((a) => cache.add(a)));
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // Individually, so one page that has moved cannot leave the app with no
      // worker at all. `addAll` rejects as a unit, and a rejected install means
      // the next load has nothing to answer from when the network is gone.
      .then((cache) =>
        Promise.allSettled(SHELL.map((p) => cache.add(p))).then(() => warmShellAssets(cache)),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([VERSION]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      // Take over the open tabs straight away, otherwise the old worker keeps
      // answering until every one of them is closed.
      .then(() => self.clients.claim()),
  );
});

/**
 * The page reports the assets it actually used, so they are in the cache
 * before the user loses signal.
 *
 * The install step can only precache the handful of pages listed in SHELL, and
 * it cannot know the hashed chunk names - those exist only once a build has
 * been served. On a first visit the page loads its own chunks before this
 * worker is even in control, so without this the cache holds HTML whose
 * JavaScript was never stored, and going offline shows a blank page.
 */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "jadoli:warm" || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter(
    (u) => typeof u === "string" && u.startsWith(self.location.origin),
  );
  event.waitUntil(
    caches.open(VERSION).then((cache) => Promise.allSettled(urls.map((u) => cache.add(u)))),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live data must never be served stale; the store refetches on reconnect.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      caches.open(VERSION).then((cache) =>
        fetch(request)
          .then((res) => {
            // Store the page that was actually served, so a route visited while
            // online is the route that opens while offline.
            if (res.ok) remember(cache, request, res);
            return res;
          })
          .catch(async () => {
            const hit = await cache.match(request);
            if (hit) return hit;
            const shell = await cache.match("/");
            // A rejected or undefined promise here takes the whole page down
            // with an InvalidStateError, so there is always an answer.
            return shell ?? unavailable();
          }),
      ),
    );
    return;
  }

  if (immutable(url.pathname)) {
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        try {
          const res = await fetch(request);
          remember(cache, request, res);
          return res;
        } catch {
          return missing(url.pathname);
        }
      }),
    );
    return;
  }

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      try {
        const res = await fetch(request);
        if (res.ok) remember(cache, request, res);
        return res;
      } catch {
        const hit = await cache.match(request);
        // A route asked for by the router rather than typed in the bar: the
        // shell is the closest thing to the answer, and it is a real page.
        if (hit) return hit;
        const isDocument = request.headers.get("accept")?.includes("text/html");
        if (isDocument) return (await cache.match("/")) ?? unavailable();
        return missing(url.pathname);
      }
    }),
  );
});
