const CACHE_NAME = "astroapp-field-guide-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./data/default-settings.json",
  "./data/deep-sky-targets.json",
  "./data/stars-mag65.json",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/world-atlas-2025.png",
  "./assets/north-america-atlas-2025.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("astroapp-") && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") await cache.put(request, response.clone());
      return response;
    } catch (error) {
      if (request.mode === "navigate") {
        return (await cache.match("./index.html")) || new Response("AstroApp is not available offline yet.", {
          status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      }
      throw error;
    }
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "CHECK_OFFLINE_CACHE") {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const missing = [];
      for (const item of APP_SHELL) if (!(await cache.match(item))) missing.push(item);
      const status = { type: "OFFLINE_CACHE_STATUS", ready: missing.length === 0, missing };
      if (event.ports[0]) event.ports[0].postMessage(status);
      else event.source?.postMessage(status);
    })());
  }
});
