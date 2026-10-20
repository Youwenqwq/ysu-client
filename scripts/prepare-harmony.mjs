import { cpSync, existsSync, lstatSync, mkdirSync, realpathSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const dist = join(root, "dist")
if (!existsSync(join(dist, "index.html"))) throw new Error("Build the Harmony web bundle first")
const html = readFileSync(join(dist, "login/index.html"), "utf8")
// The generated marker is a literal in a dedicated app meta element.
if (!html.includes('name="ysu-platform" content="harmony"')) {
  throw new Error("Refusing to package a non-Harmony build (would allow web proxy/storage fallback)")
}
const raw = join(root, "harmony/entry/src/main/resources/rawfile")
const www = join(raw, "www")
mkdirSync(raw, { recursive: true })
if (realpathSync(raw) !== raw || (existsSync(www) && lstatSync(www).isSymbolicLink())) {
  throw new Error("Refusing to replace a redirected resource directory")
}
if (www !== resolve(root, "harmony/entry/src/main/resources/rawfile/www")) {
  throw new Error("Invalid generated resource target")
}
// This exact, verified directory contains only generated web assets.
rmSync(www, { recursive: true, force: true })
mkdirSync(www, { recursive: true })
cpSync(dist, www, { recursive: true })
cpSync(join(root, "harmony/security-policy.json"), join(raw, "security-policy.json"))
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' data: blob:; font-src 'self' data:; worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'"
function protect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) protect(path)
    else if (entry.name.endsWith(".html")) {
      const content = readFileSync(path, "utf8")
      writeFileSync(path, content.replace("<head>", `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`))
    }
  }
}
protect(www)
for (const destination of ["harmony/AppScope/resources/base/media", "harmony/entry/src/main/resources/base/media"]) {
  mkdirSync(join(root, destination), { recursive: true })
  cpSync(join(root, "public/icons/icon-192.png"), join(root, destination, "app_icon.png"))
}
console.log("Prepared local-only Harmony resources and security policy.")
