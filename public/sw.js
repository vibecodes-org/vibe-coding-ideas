/// <reference lib="webworker" />

const CACHE_NAME = "vibecodes-v3";

const STATIC_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/;

self.addEventListener("install", (event) => {
  // Pre-cache the offline page
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add("/offline.html"))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Clean up old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip cross-origin requests (Supabase API, analytics, etc.)
  if (url.origin !== self.location.origin) return;

  // Skip API, OAuth, and well-known routes (they handle their own responses)
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/oauth/") ||
    url.pathname.startsWith("/.well-known/")
  ) {
    return;
  }

  // Cache-first for static assets
  if (
    url.pathname.startsWith("/_next/static/") ||
    STATIC_EXTENSIONS.test(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return response;
          })
      )
    );
    return;
  }

  // Network-first for navigation (HTML pages)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match("/offline.html").then((cached) => cached || new Response("Offline", { status: 503 }))
      )
    );
    return;
  }

  // Network-first for everything else
  event.respondWith(
    fetch(request).catch(() =>
      caches.match(request).then((cached) => cached || new Response(null, { status: 504, statusText: "Network error" }))
    )
  );
});
