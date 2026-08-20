const version = "__PWA_CACHE_VERSION__";
const scopeUrl = new URL(self.registration.scope);
const scopePath = scopeUrl.pathname.endsWith("/")
  ? scopeUrl.pathname
  : `${scopeUrl.pathname}/`;
const cachePrefix = `ysu-app-shell:${scopePath}:`;
const cacheName = `${cachePrefix}${version}`;

const appShellUrl = new URL("./", scopeUrl).href;
const shellPackUrl = new URL("./pwa-shell.pack", scopeUrl).href;
const packMagic = [0x59, 0x53, 0x50, 0x4b]; // "YSPK"
const packVersion = 1;

// The shell ships as a single gzipped pack (see scripts/generate-pwa-shell.mjs):
//   [4B magic "YSPK"][u32le version][u32le headerLength][header JSON][body]
// Fetching one file instead of hundreds keeps the CDN's anti-bot challenge out
// of the precache path, and makes install all-or-nothing: any failure rejects
// and the worker never activates with a partial shell.
async function installShell(cache) {
  const response = await fetch(new Request(shellPackUrl, { cache: "reload" }));
  if (!response.ok || !response.body) {
    throw new Error(`Shell pack request failed: ${response.status}`);
  }
  const payload = await new Response(
    response.body.pipeThrough(new DecompressionStream("gzip")),
  ).arrayBuffer();
  const view = new DataView(payload);
  if (
    payload.byteLength < 12 ||
    !packMagic.every((byte, index) => view.getUint8(index) === byte) ||
    view.getUint32(4, true) !== packVersion
  ) {
    throw new Error("Invalid shell pack");
  }
  const headerLength = view.getUint32(8, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(payload, 12, headerLength)),
  );
  if (!Array.isArray(header.files)) {
    throw new Error("Invalid shell pack header");
  }
  const bodyStart = 12 + headerLength;
  await Promise.all(
    header.files.map((file) => {
      if (file.o + file.l > payload.byteLength - bodyStart) {
        throw new Error("Shell pack entry out of bounds");
      }
      const body = payload.slice(bodyStart + file.o, bodyStart + file.o + file.l);
      return cache.put(
        new URL(file.p, scopeUrl).href,
        new Response(body, { headers: { "content-type": file.t } }),
      );
    }),
  );
}

function withoutSearch(url) {
  const normalized = new URL(url);
  normalized.search = "";
  normalized.hash = "";
  return normalized.href;
}

// Extensions whose responses must match a specific Content-Type. An anti-bot
// JS challenge answers 200 text/html for any URL; caching that response would
// poison the cache and break script/style loading.
const strictContentTypes = [
  [".js", "javascript"],
  [".css", "text/css"],
];

function isCacheable(request, response) {
  if (!response.ok || response.type !== "basic") {
    return false;
  }
  // EdgeOne answers anti-bot JS challenges with 200 text/html served
  // "Return Directly" (no origin fetch). Caching one poisons the cache:
  // documents white-screen and scripts fail to parse. Real EdgeOne Pages
  // responses always carry Cache Hit / Cache Miss instead.
  if (response.headers.get("eo-cache-status") === "Return Directly") {
    return false;
  }
  const pathname = new URL(request.url).pathname;
  for (const [extension, contentType] of strictContentTypes) {
    if (pathname.endsWith(extension)) {
      return (response.headers.get("content-type") || "").includes(contentType);
    }
  }
  return true;
}

async function fetchAndCache(cache, request, cacheKey = request) {
  const response = await fetch(request);
  if (isCacheable(request, response)) {
    await cache.put(cacheKey, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then(installShell));
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

async function networkFirst(request, ignoreSearch = false) {
  const cache = await caches.open(cacheName);
  const cacheKey = ignoreSearch
    ? new Request(withoutSearch(request.url))
    : request;

  try {
    return await fetchAndCache(cache, request, cacheKey);
  } catch {
    return (
      (await cache.match(cacheKey)) ||
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

  const isRscPayload =
    scopedPath.endsWith(".txt") &&
    (scopedPath.includes("__next") || scopedPath.endsWith("index.txt"));
  if (isRscPayload) {
    event.respondWith(networkFirst(request, true));
    return;
  }

  const isDocument =
    request.mode === "navigate" || scopedPath === "" || scopedPath.endsWith("/");
  if (isDocument) {
    event.respondWith(networkFirst(request, true));
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
