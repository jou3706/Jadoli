/*
 * Offline shell, and the reminders that arrive with the app closed.
 *
 * Two jobs in one worker, because a page can only have one: the cache below is
 * what makes the app open without a network, and the push handlers further down
 * are what makes an exam reminder arrive when there is no page to show it in.
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

/**
 * Bumped whenever the shell changes, because it is the cache's name and the
 * only thing that retires the previous one. Leaving it alone across a deploy
 * means the browser keeps serving the build it cached: the old HTML, the old
 * chunks, and the old JavaScript, with no way to tell - the app loads, and it
 * is simply the app as it was before the fix.
 */
const VERSION = "jadwali-v13";
/**
 * Every route the app can open, because a page that is not cached is not
 * merely missing - it is worse than missing. The worker falls back to the home
 * page, and this is a client-routed app: the browser then has a URL for one
 * route and the data for another, asks the network for the route it is on, and
 * sits in its loading state until the network comes back. A route nobody can
 * reach offline is a route that looks like a broken app.
 */
const SHELL = [
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
  "/review",
  "/quiz",
  "/questions",
  "/import",
  "/assistant",
  "/widget",
  "/privacy",
  "/manifest.json",
  "/icon.svg",
];
/** Enough for a few builds' worth of chunks before the oldest are dropped. */
const MAX_STATIC = 150;

const OFFLINE_HTML =
  "<!doctype html><meta charset=utf-8><title>Offline</title>" +
  '<p style="font:16px system-ui;padding:2rem">You are offline and this page ' +
  "was never loaded while you were connected.</p>";

/** Hashed by the build, so a hit is correct by definition and never stale. */
const immutable = (path) => path.startsWith("/_next/static/");

/**
 * The build a cache belongs to, read off its name.
 *
 * The name carries the build number, so two generations can be compared
 * without keeping a list of them anywhere. The pre-rename names are read too:
 * a browser that has been here since before the rename still holds one, and
 * those are exactly the tabs that need it.
 */
const generation = (name) => {
  const m = /^(?:jadwali|jadoli)-v(\d+)$/.exec(name);
  return m ? Number(m[1]) : null;
};

/**
 * The app's own caches, newest build first.
 *
 * The worker keeps one generation back on purpose. A deploy renames every
 * chunk, so a tab that is still running the previous build asks for files the
 * server no longer has - and the only copy left is in the cache that build
 * wrote. Without it the tab's next navigation is a chunk that cannot be
 * loaded, which is a page that opens to nothing.
 */
const ownCaches = async () => {
  const keys = await caches.keys();
  const others = keys
    .filter((k) => generation(k) !== null && k !== VERSION)
    .sort((a, b) => (generation(b) ?? 0) - (generation(a) ?? 0));
  return [VERSION, ...others];
};

/** The caches to keep: this build, and the one before it. */
const keepers = async () => {
  const current = generation(VERSION) ?? 0;
  const keep = new Set();
  for (const name of await ownCaches()) {
    const g = generation(name);
    if (g !== null && g >= current - 1) keep.add(name);
  }
  return keep;
};

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
  event.waitUntil(
    caches
      .keys()
      .then((keys) => keepers().then((keep) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))))
      // Take over the open tabs straight away, otherwise the old worker keeps
      // answering until every one of them is closed.
      .then(() => self.clients.claim()),
  );
});

/**
 * When the page last said it was awake.
 *
 * A push and an open page both answer for the same event, and the one that
 * arrives second replaces the first in the tray. The in-app alarm asks to stay
 * on the screen until it is dismissed; the push's notification does not. So the
 * push is the one that steps aside - but only while the page is really in front
 * of the student and really answering its alarms. A page that has been closed,
 * crashed or left in the background must not silence the push, or a reminder
 * would arrive to nobody.
 */
let alarmsLiveAt = 0;

/**
 * How long a claim of "the page is awake" is believed.
 *
 * The page renews it every half minute; two minutes of silence is a page that
 * is gone. It is generous rather than tight on purpose: a claim that expires
 * early means a duplicate notification, and a duplicate that replaces a sticky
 * one is the exact thing this is here to prevent.
 */
const LIVE_FOR_MS = 120_000;

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
  // Both names are accepted: a page still running the build from before the
  // rename speaks the old one, and the worker it is talking to is this one.
  if (!data) return;
  if (data.type === "jadwali:alarms-live" || data.type === "jadoli:alarms-live") {
    // The page is awake and ringing its own alarms. See `alarmsLiveAt`.
    alarmsLiveAt = Date.now();
    return;
  }
  if (data.type !== "jadwali:warm" && data.type !== "jadoli:warm") return;
  if (!Array.isArray(data.urls)) return;
  const urls = data.urls.filter(
    (u) => typeof u === "string" && u.startsWith(self.location.origin),
  );
  event.waitUntil(
    caches.open(VERSION).then((cache) => Promise.allSettled(urls.map((u) => cache.add(u)))),
  );
});

/**
 * Reminders that arrive when the app is not open.
 *
 * The worker owns them because the worker is the only part of this app that is
 * still running when the tab is closed - which is the entire reason these are
 * sent as push rather than shown by the page. Everything here has to survive a
 * push event carrying something other than what we sent, because that is what a
 * truncated or unexpected payload looks like, and a reminder that throws while
 * it is being shown is a reminder that never arrives.
 */

/** The route a notification opens, when the payload does not name a better one. */
const PUSH_FALLBACK = "/events";

/**
 * The notification's own wording, when the payload is not usable.
 *
 * Says what happened rather than that something happened: an unnamed
 * notification on a phone at 8am reads as an error, and a student who cannot
 * tell a reminder from a failure stops trusting the whole channel.
 */
const pushTitle = (data) => (typeof data.title === "string" && data.title.trim()) || "Jadwali";
const pushBody = (data) =>
  typeof data.body === "string" && data.body.trim() ? data.body.trim() : "You have something due";

/**
 * The payload, or an empty object.
 *
 * `event.data.json()` throws on anything that is not JSON, and a push event with
 * no data at all has `data` as null. Both are ordinary enough - a browser that
 * sends a test message, a payload that got cut - that neither is worth losing a
 * reminder over.
 */
const readPush = (event) => {
  try {
    const parsed = event.data ? event.data.json() : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * The windows this app has open, and whether one of them is in front.
 *
 * `visibilityState` is the honest answer to "is the student looking at this":
 * a tab in the background is hidden, and a notification raised for a hidden tab
 * is a notification nobody looks at.
 */
const ownWindows = async () => {
  const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return list.filter((c) => {
    try {
      return c.url && new URL(c.url).origin === self.location.origin;
    } catch {
      return false;
    }
  });
};

self.addEventListener("push", (event) => {
  const data = readPush(event);
  event.waitUntil(
    (async () => {
      const windows = await ownWindows();
      const inFront = windows.some((c) => c.visibilityState === "visible");
      const awake = Date.now() - alarmsLiveAt < LIVE_FOR_MS;
      if (inFront && awake) {
        // The page is in front of the student and it is ringing this alarm
        // itself. Its notification is the sticky one; showing a second one
        // under the same tag would replace it with one that times out.
        return;
      }
      await self.registration.showNotification(pushTitle(data), {
        body: pushBody(data),
        // The tag is the reminder's identity, so a second push for the same
        // reminder replaces the first in the tray instead of stacking up beside
        // it. Without it, a retry looks like two exams.
        tag: typeof data.tag === "string" && data.tag ? data.tag : undefined,
        data: { url: typeof data.url === "string" ? data.url : PUSH_FALLBACK },
        icon: "/icon.svg",
        badge: "/icon.svg",
        // Silent:false would be the default, but a reminder that arrives while the
        // app is open should not make a sound the page has already made.
        silent: false,
        vibrate: [200, 100, 200],
        lang: "ar",
      });
    })(),
  );
});

/**
 * Tapping a notification.
 *
 * Focuses a window that is already open rather than opening a second one. Two
 * copies of a client-routed app is not a small annoyance: they disagree about
 * which route is showing, and the one the student did not tap keeps its own copy
 * of the data.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    event.notification.data && typeof event.notification.data.url === "string"
      ? event.notification.data.url
      : PUSH_FALLBACK;
  // Resolved against our own origin and then checked, because `new URL` happily
  // accepts an absolute url of any origin and would send the tap there. Nothing
  // in the payload is trusted: a reminder's text is built out of an event title,
  // which is a student's own typing, so the route is treated as untrusted input
  // rather than as something the server would never send.
  let url = `${self.location.origin}${PUSH_FALLBACK}`;
  try {
    const resolved = new URL(target, self.location.origin);
    if (resolved.origin === self.location.origin) url = resolved.href;
  } catch {
    /* an unparseable route is not a reason to lose the tap */
  }

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        // An open Jadwali window anywhere is the one to reuse, whichever route it
        // happens to be showing: the app navigates on the client, so posting a
        // message to it lands on the right screen without a reload.
        const open = list.find((c) => {
          try {
            return c.url && new URL(c.url).origin === self.location.origin;
          } catch {
            return false;
          }
        });
        if (!open) return self.clients.openWindow(url);
        if ("focus" in open) return open.focus();
        return undefined;
      })
      .catch(() => self.clients.openWindow(url)),
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
            // The retired caches hold the pages the previous build served, and
            // an open tab may still be on one of them.
            for (const name of (await ownCaches()).slice(1)) {
              const older = await (await caches.open(name)).match(request);
              if (older) return older;
            }
            // A page for a different route is not a fallback, it is a wrong
            // answer: this app routes on the client, so the browser would hold
            // the URL it asked for and the data for the home page, ask the
            // network for the difference, and wait on it. Better to say plainly
            // that this page is not available offline.
            return unavailable();
          }),
      ),
    );
    return;
  }

  if (immutable(url.pathname)) {
    event.respondWith(
      (async () => {
        // Every build's cache, newest first: a chunk name belongs to the build
        // that produced it, so the retired caches can only ever hold chunks
        // this build has no use for - except for the tab that is still running
        // that build and needs exactly them.
        for (const name of await ownCaches()) {
          const hit = await (await caches.open(name)).match(request);
          if (hit) return hit;
        }
        try {
          const res = await fetch(request);
          remember(await caches.open(VERSION), request, res);
          return res;
        } catch {
          return missing(url.pathname);
        }
      })(),
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
        if (hit) return hit;
        // The router asking for a route it has not cached gets the route's own
        // page when there is one, and otherwise the plain offline notice - not
        // another route's data, which the client router cannot reconcile.
        const path = url.pathname;
        const isDocument = request.headers.get("accept")?.includes("text/html");
        if (isDocument) {
          const same = await cache.match(path);
          if (same) return same;
          for (const name of (await ownCaches()).slice(1)) {
            const older = await (await caches.open(name)).match(path);
            if (older) return older;
          }
          return unavailable();
        }
        return missing(path);
      }
    }),
  );
});
