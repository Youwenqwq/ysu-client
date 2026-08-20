import { readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(repoRoot, "dist");
const outputFile = join(distDir, "pwa-shell.json");
const excludedSegments = new Set(["_next", "_not-found", "404"]);

const routes = new Set();
const dataAssets = new Set();

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

const assets = [...routes, ...dataAssets].sort((a, b) => a.localeCompare(b));
writeFileSync(outputFile, `${JSON.stringify({ assets }, null, 2)}\n`);
console.log(`Generated pwa-shell.json with ${assets.length} assets.`);
