const swUrl = new URL(self.location.href);
const version = swUrl.searchParams.get("v") || "dev";
const scopeUrl = new URL(self.registration.scope);
const scopePath = scopeUrl.pathname.endsWith("/")
  ? scopeUrl.pathname
  : `${scopeUrl.pathname}/`;
const cachePrefix = `ysu-app-shell:${scopePath}:`;
const cacheName = `${cachePrefix}${version}`;

const shellUrls = [
  "./",
  "./login/",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
].map((path) => new URL(path, scopeUrl).href);

const appShellUrl = new URL("./", scopeUrl).href;

function isCacheable(response) {
  return response.ok && response.type === "basic";
}

async function fetchAndCache(cache, request) {
  const response = await fetch(request);
  if (isCacheable(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(cacheName).then((cache) =>
      Promise.all(
        shellUrls.map(async (url) => {
          try {
            const request = new Request(url, { cache: "reload" });
            const response = await fetch(request);
            if (isCacheable(response)) {
              await cache.put(request, response);
            }
          } catch {
            // A missing shell asset must not prevent the worker from installing.
          }
        }),
      ),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(cachePrefix) && name !== cacheName)
            .map((name) => caches.delete(name)),
        ),
      ),
      self.clients.claim(),
    ]),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(cacheName);

  try {
    return await fetchAndCache(cache, request);
  } catch {
    return (
      (await cache.match(request)) ||
      (await cache.match(appShellUrl)) ||
      Response.error()
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(cacheName);
  return (await cache.match(request)) || fetchAndCache(cache, request);
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(event.request);
  const update = fetchAndCache(cache, event.request);

  if (cached) {
    event.waitUntil(update.catch(() => undefined));
    return cached;
  }

  return update;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopePath)) return;

  const scopedPath = url.pathname.slice(scopePath.length);
  if (
    scopedPath === "api" ||
    scopedPath.startsWith("api/") ||
    scopedPath === "updates" ||
    scopedPath.startsWith("updates/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (scopedPath.startsWith("_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (scopedPath === "manifest.webmanifest" || scopedPath.startsWith("icons/")) {
    event.respondWith(staleWhileRevalidate(event));
  }
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
