// App shell is network-first so a published update shows the next time the app opens.
// The encrypted tracker is also network-first and is cached only as an offline fallback.

const CACHE = "college-tracker-v2";
const SHELL = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/app.js",
  "./js/crypto.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function encryptedCacheKey() {
  return new Request(new URL("data/tracker.enc.json", self.registration.scope).toString());
}

// Fetch a new request. Reusing the intercepted Request can deadlock Chrome,
// especially on a reload once this worker controls the page.
async function fromNetwork(url) {
  return fetch(url, { cache: "no-store", credentials: "same-origin" });
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  url.hash = "";
  url.search = "";
  const cacheKey = url.toString();
  try {
    const fresh = await fromNetwork(cacheKey);
    if (fresh.ok) await cache.put(cacheKey, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

async function networkFirstEncrypted(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fromNetwork(request.url);
    if (fresh.ok) await cache.put(encryptedCacheKey(), fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(encryptedCacheKey());
    if (cached) return cached;
    return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/data/tracker.enc.json")) {
    event.respondWith(networkFirstEncrypted(request));
    return;
  }
  event.respondWith(networkFirst(request));
});
