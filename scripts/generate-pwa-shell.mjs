import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(repoRoot, "dist");
const outputFile = join(distDir, "pwa-shell.pack");

const contentTypes = new Map([
  [".html", "text/html"],
  [".txt", "text/plain"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".json", "application/json"],
  [".webmanifest", "application/manifest+json"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
]);

function contentTypeFor(path) {
  return contentTypes.get(extname(path)) || "application/octet-stream";
}

function toPosix(path) {
  return path.split(sep).join("/");
}

// The worker looks up scope-relative paths without their query strings.
const entries = new Map();

function addEntry(key, file) {
  if (!entries.has(key)) {
    entries.set(key, file);
  }
}

function collectStaticAssets(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collectStaticAssets(path);
    else if (entry.isFile()) addEntry(`./${toPosix(relative(distDir, path))}`, path);
  }
}

const rootDocument = join(distDir, "index.html");
if (!existsSync(rootDocument)) throw new Error("Missing root document: dist/index.html");
addEntry("./", rootDocument);
collectStaticAssets(join(distDir, "_next", "static"));

for (const entry of readdirSync(distDir, { withFileTypes: true })) {
  if (entry.isFile() && (entry.name === "index.txt" || entry.name.startsWith("__next"))) {
    addEntry(`./${entry.name}`, join(distDir, entry.name));
  }
}

// Fixed shell assets outside the exported document and Next's static assets.
for (const fixed of [
  "manifest.webmanifest",
  "icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
]) {
  const file = join(distDir, fixed);
  if (existsSync(file)) {
    addEntry(`./${fixed}`, file);
  }
}

// Pack layout, gzipped as a whole:
//   [4B magic "OHPK"][u32le version=1][u32le headerLength][header JSON][body]
// header JSON: { "files": [{ "p": key, "o": offset, "l": length, "t": contentType }] }
// offsets are relative to the start of the body.
const files = [];
const chunks = [];
let offset = 0;
for (const [key, file] of [...entries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const data = readFileSync(file);
  files.push({ p: key, o: offset, l: data.length, t: contentTypeFor(file) });
  chunks.push(data);
  offset += data.length;
}

const header = Buffer.from(JSON.stringify({ files }), "utf8");
const head = Buffer.alloc(12);
head.write("OHPK", 0, "ascii");
head.writeUInt32LE(1, 4);
head.writeUInt32LE(header.length, 8);
const payload = Buffer.concat([head, header, ...chunks]);
const packed = gzipSync(payload, { level: 9 });
writeFileSync(outputFile, packed);

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
let gitHash = "unknown";
try {
  gitHash = execSync("git rev-parse --short HEAD", { cwd: repoRoot })
    .toString()
    .trim();
} catch {
  // Git is unavailable in some build environments.
}

// Trailing timestamp orders PWA cache generations: the worker keeps the two
// newest caches so unreloaded tabs keep resolving chunks from the previous
// build, and lets clients detect downgrade installs (older sw.js served by a
// stale CDN edge node) by comparing versions.
const buildVersion = `${pkg.version}-${gitHash}-${Date.now()}`;
const workerFile = join(distDir, "sw.js");
const workerSource = readFileSync(workerFile, "utf8");
if (!workerSource.includes("__PWA_CACHE_VERSION__")) {
  throw new Error("dist/sw.js is missing __PWA_CACHE_VERSION__");
}
writeFileSync(
  workerFile,
  workerSource.replaceAll("__PWA_CACHE_VERSION__", buildVersion),
);

console.log(
  `Generated pwa-shell.pack with ${files.length} assets ` +
  `(${(payload.length / 1024).toFixed(0)} KiB raw, ${(packed.length / 1024).toFixed(0)} KiB gzipped).`,
);
console.log(`Injected PWA build version ${buildVersion} into sw.js.`);
