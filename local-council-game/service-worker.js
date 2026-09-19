const CACHE_PREFIX = "local-council-game-";
const LEGACY_CACHE_NAMES = new Set(["my-pwa-cache-v1", "my-pwa-cache-v3"]);
const CACHE_VERSION = "7dc05875c6342aa5";
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const PRECACHE_URLS = [
  "./app/321.mp3",
  "./app/Malta-LAU2.zip",
  "./app/altnames.json",
  "./app/app.js",
  "./app/app.webmanifest",
  "./app/correct.mp3",
  "./app/game-config.js",
  "./app/game-storage.js",
  "./app/game-utils.js",
  "./app/icon-512.png",
  "./app/joe-logo.webp",
  "./app/leaflet.css",
  "./app/leaflet.js",
  "./app/locality-data.js",
  "./app/music.mp3",
  "./app/musicoff.png",
  "./app/musicon.png",
  "./app/originalnames.json",
  "./app/pangolin1.woff2",
  "./app/pangolin2.woff2",
  "./app/pwa.js",
  "./app/shp.js",
  "./app/styles.css",
  "./app/tailwind.js",
  "./coas/1.png",
  "./coas/10.png",
  "./coas/11.png",
  "./coas/12.png",
  "./coas/13.png",
  "./coas/14.png",
  "./coas/15.png",
  "./coas/16.png",
  "./coas/17.png",
  "./coas/18.png",
  "./coas/19.png",
  "./coas/2.png",
  "./coas/20.png",
  "./coas/21.png",
  "./coas/22.png",
  "./coas/23.png",
  "./coas/24.png",
  "./coas/25.png",
  "./coas/26.png",
  "./coas/27.png",
  "./coas/28.png",
  "./coas/29.png",
  "./coas/3.png",
  "./coas/30.png",
  "./coas/31.png",
  "./coas/32.png",
  "./coas/33.png",
  "./coas/34.png",
  "./coas/35.png",
  "./coas/36.png",
  "./coas/37.png",
  "./coas/38.png",
  "./coas/39.png",
  "./coas/4.png",
  "./coas/40.png",
  "./coas/41.png",
  "./coas/42.png",
  "./coas/43.png",
  "./coas/44.png",
  "./coas/45.png",
  "./coas/46.png",
  "./coas/47.png",
  "./coas/48.png",
  "./coas/49.png",
  "./coas/5.png",
  "./coas/50.png",
  "./coas/51.png",
  "./coas/52.png",
  "./coas/53.png",
  "./coas/54.png",
  "./coas/55.png",
  "./coas/56.png",
  "./coas/57.png",
  "./coas/58.png",
  "./coas/59.png",
  "./coas/6.png",
  "./coas/60.png",
  "./coas/61.png",
  "./coas/62.png",
  "./coas/63.png",
  "./coas/64.png",
  "./coas/65.png",
  "./coas/66.png",
  "./coas/67.png",
  "./coas/68.png",
  "./coas/69.png",
  "./coas/7.png",
  "./coas/8.png",
  "./coas/9.png",
  "./coas/index.html",
  "./index.html"
];
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
