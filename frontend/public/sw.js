/* CVO app-shell service worker.
 *
 * Scope: make the SPA installable and keep the shell loading when the
 * connection drops. It deliberately does NOT try to replay API writes —
 * offline submissions are handled in the app by the IndexedDB queue
 * (src/lib/offlineQueue.js), which knows the auth/CSRF rules the SW does not.
 *
 * Caching rules:
 *   - navigations  → network-first, falling back to the cached shell (so a
 *                    deep link still opens while offline).
 *   - static GETs  → stale-while-revalidate.
 *   - /api, /sanctum → never touched; they must always hit the live server.
 *
 * Bump CACHE_VERSION when the shell changes so old caches are dropped.
 */
const CACHE_VERSION = "cvo-shell-v1";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/logo.png",
  "/favicon.ico",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      // addAll rejects the whole install if one URL 404s; tolerate that so a
      // missing optional icon cannot block the update.
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Persist a successful response without failing the request if the put errors. */
function putInCache(request, response) {
  const copy = response.clone();
  caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/sanctum")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          putInCache("/", response);
          return response;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) putInCache(request, response);
          return response;
        })
        .catch(() => cached);

      return cached || network;
    }),
  );
});
