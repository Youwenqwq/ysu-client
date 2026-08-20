import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(repoRoot, "dist");
const outputFile = join(distDir, "pwa-shell.json");
const excludedSegments = new Set(["_next", "_not-found", "404"]);

const routes = new Set();
const dataAssets = new Set();
const staticAssets = new Set();

function toPosix(path) {
  return path.split(sep).join("/");
}

function isExcluded(segments) {
  return segments.some((segment) => excludedSegments.has(segment));
}

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }

    const relativePath = toPosix(relative(distDir, path));
    const segments = relativePath.split("/");
    if (segments[0] === "_next" && segments[1] === "static") {
      staticAssets.add(`./${relativePath}`);
      continue;
    }
    if (isExcluded(segments)) continue;

    if (entry === "index.html") {
      const route = relativePath === "index.html"
        ? "./"
        : `./${relativePath.slice(0, -"index.html".length)}`;
      routes.add(route);
      continue;
    }

    if (entry === "index.txt" || entry.startsWith("__next")) {
      dataAssets.add(`./${relativePath}`);
    }
  }
}

walk(distDir);

const assets = [...routes, ...dataAssets, ...staticAssets].sort((a, b) => a.localeCompare(b));
writeFileSync(outputFile, `${JSON.stringify({ assets }, null, 2)}\n`);

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
let gitHash = "unknown";
try {
  gitHash = execSync("git rev-parse --short HEAD", { cwd: repoRoot })
    .toString()
    .trim();
} catch {
  // Git is unavailable in some build environments.
}

const buildVersion = `${pkg.version}-${gitHash}`;
const workerFile = join(distDir, "sw.js");
const workerSource = readFileSync(workerFile, "utf8");
if (!workerSource.includes("__PWA_CACHE_VERSION__")) {
  throw new Error("dist/sw.js is missing __PWA_CACHE_VERSION__");
}
writeFileSync(
  workerFile,
  workerSource.replaceAll("__PWA_CACHE_VERSION__", buildVersion),
);

console.log(`Generated pwa-shell.json with ${assets.length} assets.`);
console.log(`Injected PWA build version ${buildVersion} into sw.js.`);
