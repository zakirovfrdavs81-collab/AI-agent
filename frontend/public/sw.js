const CACHE_NAME = "navo-pwa-v1";
const ASSET_CACHE_NAME = "navo-pwa-assets-v1";
const APP_CACHE_KEY = "/app/";
const ASSET_CACHE_LIMIT = 80;
const APP_PATH = /^\/app(?:\/|$)/;
const ICON_PATHS = new Set([
  "/logo.svg",
  "/logo-192.png",
  "/logo-512.png",
  "/maskable-192.png",
  "/maskable-512.png",
  "/apple-touch-icon.png",
  "/favicon.ico",
  "/manifest.webmanifest",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.add("/offline.html"))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("gemini-shell-")
          || (key.startsWith("navo-pwa-") && ![CACHE_NAME, ASSET_CACHE_NAME].includes(key)))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function trimAssetCache(cache) {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - ASSET_CACHE_LIMIT)).map((key) => cache.delete(key)));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate" && APP_PATH.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-cache" });
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(APP_CACHE_KEY, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(APP_CACHE_KEY)) || (await caches.match("/offline.html"));
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone());
        await trimAssetCache(cache);
      }
      return response;
    })());
    return;
  }

  if (ICON_PATHS.has(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const update = fetch(request).then(async (response) => {
        if (response.ok) await cache.put(request, response.clone());
        return response;
      });
      if (cached) {
        event.waitUntil(update.catch((error) => console.error("PWA asset refresh failed:", error)));
        return cached;
      }
      return update;
    })());
  }
});
