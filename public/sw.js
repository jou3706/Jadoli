/*
 * Offline shell.
 *
 * The cache name is tied to the build rather than left fixed. Next.js puts a
 * content hash in every chunk filename, so a new deploy always produces new
 * URLs, but a fixed cache name would keep serving whatever was stored under
 * those URLs before - which is how a deploy could be live on the server and
 * still show the old screen in the browser.
 *
 * Navigations go to the network first and fall back to the shell. Everything
 * else is served from the cache only when the network is unreachable, so a
 * release reaches people on their next load instead of whenever they happen
 * to clear a cache.
 */

const VERSION = "jadoli-v2";
const SHELL = ["/", "/week", "/gpa", "/events", "/manifest.json", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([VERSION, ...SHELL.map((p) => new Request(p).url)]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      // Take over the open tabs straight away, otherwise the old worker keeps
      // answering until every one of them is closed.
      .then(() => self.clients.claim()),
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
    event.respondWith(fetch(request).catch(() => caches.match(request).then((hit) => hit ?? caches.match("/"))));
    return;
  }

  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request)),
  );
});
