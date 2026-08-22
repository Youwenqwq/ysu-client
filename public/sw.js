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

// Version strings end with a build timestamp ("1.2.3-ab12345-1718000000000");
// it orders cache generations so activate can keep the two newest and drop
// the rest. Legacy caches without a timestamp sort first and get cleaned.
function buildTimestamp(cacheKey) {
  const match = /-(\d{10,})$/.exec(cacheKey);
  return match ? Number(match[1]) : 0;
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

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then(installShell));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((names) => {
        const generations = names
          .filter((name) => name.startsWith(cachePrefix))
          .sort((a, b) => buildTimestamp(b) - buildTimestamp(a));
        // Keep the two newest generations: unreloaded tabs still run the
        // previous build and resolve its chunks from the previous cache.
        return Promise.all(
          generations.slice(2).map((name) => caches.delete(name)),
        );
      }),
      self.clients.claim(),
    ]),
  );
});

// Everything in scope is served from the installed shell. The CDN only sees
// sw.js update checks and pack downloads, so rate limiting / anti-bot
// challenges can no longer break the app once it is installed.
async function cacheFirst(event) {
  const { request } = event;
  const cache = await caches.open(cacheName);
  const key = withoutSearch(request.url);

  const cached =
    (await cache.match(key)) ||
    // Previous generation's cache keeps unreloaded tabs working after an
    // update activated underneath them.
    (await caches.match(key));
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (isCacheable(request, response)) {
      await cache.put(key, response.clone());
    }
    return response;
  } catch {
    if (request.mode === "navigate") {
      const shell =
        (await cache.match(appShellUrl)) || (await caches.match(appShellUrl));
      if (shell) return shell;
    }
    return Response.error();
  }
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

  // The pack itself is only fetched by installShell; never serve it stale.
  if (scopedPath === "pwa-shell.pack") return;

  event.respondWith(cacheFirst(event));
});

self.addEventListener("message", (event) => {
  const type = event.data?.type;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  // Lets the page compare the waiting worker's build against the active one,
  // so stale/downgrade installs (CDN edge nodes serving an older sw.js during
  // deploy propagation) never surface as an "update available" prompt.
  if (type === "GET_VERSION" && event.ports?.[0]) {
    event.ports[0].postMessage({ version });
  }
});
