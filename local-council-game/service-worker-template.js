const CACHE_PREFIX = "local-council-game-";
const LEGACY_CACHE_NAMES = new Set(["my-pwa-cache-v1", "my-pwa-cache-v3"]);
const CACHE_VERSION = "__CACHE_VERSION__";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const PRECACHE_URLS = __PRECACHE_URLS__;
const APP_SHELL_URL = "./index.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (cacheName) =>
                (cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME) ||
                LEGACY_CACHE_NAMES.has(cacheName),
            )
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !isRequestInsideApp(request)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

function isRequestInsideApp(request) {
  const requestUrl = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);

  return (
    requestUrl.origin === scopeUrl.origin &&
    requestUrl.pathname.startsWith(scopeUrl.pathname)
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    return (await cache.match(request)) || cache.match(APP_SHELL_URL);
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}
