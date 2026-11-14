import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import tailwindcss from "@tailwindcss/postcss"
import { build } from "esbuild"
import { zipSync } from "fflate"
import postcss from "postcss"
import { SUPPORTED_HOST_MODULES } from "../packages/plugin-sdk/host-modules.ts"
import { validatePluginManifest } from "../packages/plugin-sdk/manifest.ts"
import { parsePluginPackage } from "../lib/plugins/plugin-package.ts"

const require = createRequire(import.meta.url)
const HOST_ROOT = fileURLToPath(new URL("..", import.meta.url))
const HOST_STYLESHEET = path.join(HOST_ROOT, "app/globals.css")
const TAILWIND_THEME = require.resolve("tailwindcss/theme.css")
const TAILWIND_ANIMATIONS = path.join(HOST_ROOT, "node_modules/tw-animate-css/dist/tw-animate.css")

/**
 * Stylesheet generated from the plugin's own Tailwind classes and appended to
 * the packaged `manifest.styles`. Hosts inject it like any other declared
 * stylesheet, so a plugin installed into an older host still gets its CSS.
 */
export const PLUGIN_TAILWIND_STYLESHEET = "dist/tailwind.css"

const STYLE_HEADER =
  "/* Tailwind utilities for this plugin, compiled against the host design tokens. */"

export interface PackedPlugin {
  id: string
  version: string
  output: string
  size: number
  sha256: string
}

export async function packPlugin(pluginDirectory: string, output?: string): Promise<PackedPlugin> {
  const directory = path.resolve(pluginDirectory)
  const manifestPath = path.join(directory, "manifest.json")
  const manifest = validatePluginManifest(JSON.parse(await readFile(manifestPath, "utf8")))
  const sourceEntry = ["src/index.tsx", "src/index.ts", "index.tsx", "index.ts"].find((entry) =>
    existsSync(path.join(directory, entry))
  )
  if (!sourceEntry) throw new Error(`Missing plugin source entry in ${directory}`)

  await build({
    absWorkingDir: directory,
    entryPoints: [sourceEntry],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome111"],
    outdir: "dist",
    external: [...SUPPORTED_HOST_MODULES],
    jsx: "automatic",
    minify: true,
    sourcemap: false,
    logLevel: "warning",
  })

  const files: Record<string, Uint8Array> = {}
  await collectFiles(directory, path.join(directory, "dist"), files)
  const assetsDirectory = path.join(directory, "assets")
  if (existsSync(assetsDirectory)) await collectFiles(directory, assetsDirectory, files)
  if (!files[manifest.entry]) throw new Error(`Built entry is missing: ${manifest.entry}`)

  const utilities = await buildPluginUtilities(directory)
  const styles = [...(manifest.styles ?? [])]
  if (utilities) {
    const built = files[PLUGIN_TAILWIND_STYLESHEET]
    files[PLUGIN_TAILWIND_STYLESHEET] = new TextEncoder().encode(
      built ? `${new TextDecoder().decode(built).trimEnd()}\n${utilities}` : utilities
    )
    if (!styles.includes(PLUGIN_TAILWIND_STYLESHEET)) styles.push(PLUGIN_TAILWIND_STYLESHEET)
  }
  for (const style of styles) {
    if (!files[style]) throw new Error(`Built stylesheet is missing: ${style}`)
  }

  const packagedManifest =
    styles.length === (manifest.styles?.length ?? 0) ? manifest : { ...manifest, styles }
  files["manifest.json"] = new TextEncoder().encode(
    `${JSON.stringify(packagedManifest, null, 2)}\n`
  )

  const archive = zipSync(files, { level: 9 })
  parsePluginPackage(archive)
  const outputPath = path.resolve(
    output ?? path.join(directory, `${manifest.id}-${manifest.version}.zip`)
  )
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, archive)
  const sha256 = createHash("sha256").update(archive).digest("hex")
  return {
    id: manifest.id,
    version: manifest.version,
    output: outputPath,
    size: archive.length,
    sha256,
  }
}

/**
 * Compile the Tailwind classes used by a plugin's own sources.
 *
 * The stylesheet contains only `theme` variables and `utilities`: no preflight
 * and no host global rules, because the host already injects those. Everything
 * resolves through the host design tokens in `app/globals.css`, so colors,
 * radii and the light/dark themes stay aligned with the host.
 */
async function buildPluginUtilities(directory: string): Promise<string> {
  const [defaultTheme, hostStyles, animations] = await Promise.all([
    readFile(TAILWIND_THEME, "utf8"),
    readFile(HOST_STYLESHEET, "utf8"),
    readFile(TAILWIND_ANIMATIONS, "utf8"),
  ])
  const input = [
    "@layer theme, base, components, utilities;",
    animations,
    `@layer theme {\n${defaultTheme}\n}`,
    "@layer utilities {\n@tailwind utilities;\n}",
    "@custom-variant dark (&:is(.dark *));",
    '@source not "./node_modules";',
    '@source not "./dist";',
    hostThemeBlock(hostStyles),
  ].join("\n")

  const { css } = await postcss([tailwindcss({ base: directory })]).process(input, {
    from: path.join(directory, "__plugin_tailwind.css"),
  })
  if (!/@layer utilities\s*\{/.test(css)) return ""
  return `${STYLE_HEADER}\n${css.trimStart()}`
}

/** Copy the host `@theme inline` blocks: token mappings only, no global rules. */
function hostThemeBlock(stylesheet: string): string {
  const blocks: string[] = []
  let start = stylesheet.indexOf("@theme inline")
  while (start >= 0) {
    const open = stylesheet.indexOf("{", start)
    if (open < 0) break
    let depth = 0
    let end = open
    for (; end < stylesheet.length; end += 1) {
      if (stylesheet[end] === "{") depth += 1
      else if (stylesheet[end] === "}" && --depth === 0) break
    }
    if (depth !== 0) throw new Error(`Unterminated @theme inline block in ${HOST_STYLESHEET}`)
    blocks.push(stylesheet.slice(start, end + 1))
    start = stylesheet.indexOf("@theme inline", end + 1)
  }
  if (blocks.length === 0) throw new Error(`Missing @theme inline block in ${HOST_STYLESHEET}`)
  return blocks.join("\n")
}

async function collectFiles(
  root: string,
  directory: string,
  files: Record<string, Uint8Array>
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) await collectFiles(root, absolute, files)
    else if (entry.isFile()) {
      const relative = path.relative(root, absolute).split(path.sep).join("/")
      files[relative] = new Uint8Array(await readFile(absolute))
    }
  }
}
