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
import { isJavaScriptPackagePath, parsePluginPackage } from "@orahako/kernel"
import { PLATFORM_MODULES, validatePluginManifest } from "@orahako/sdk"

const require = createRequire(import.meta.url)
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const TAILWIND_THEME = require.resolve("tailwindcss/theme.css")
const TAILWIND_ANIMATIONS = resolveNodeModuleFile("tw-animate-css/dist/tw-animate.css")

function resolveNodeModuleFile(relativePath: string): string {
  let current = MODULE_DIR
  while (true) {
    const candidate = path.join(current, "node_modules", relativePath)
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(current)
    if (parent === current) {
      throw new Error(`Unable to locate ${relativePath} from ${MODULE_DIR}`)
    }
    current = parent
  }
}
const platformModules = new Set<string>(PLATFORM_MODULES)

/**
 * Stylesheet generated from the plugin's own Tailwind classes and appended to
 * the packaged `manifest.styles`. Hosts inject it like any other declared
 * stylesheet, so a plugin installed into an older host still gets its CSS.
 */
export const PLUGIN_TAILWIND_STYLESHEET = "dist/tailwind.css"

const STYLE_HEADER =
  "/* Tailwind utilities for this plugin, compiled against the host design tokens. */"

/**
 * Layer for the theme variables a plugin stylesheet re-declares.
 *
 * Tailwind emits used theme variables unlayered. Injected after the host, they
 * would override `:root` tokens the host resolves otherwise — `font-sans`
 * in particular, whose variable comes from the next/font class. Layering them
 * keeps the host's declarations authoritative while still providing defaults
 * for tokens the host never emits.
 */
const PLUGIN_TOKEN_LAYER = "orahako-plugin-tokens"

export const HOST_THEME_SNAPSHOT_FILE = "host-theme.css"
export const HOST_SELECTORS_SNAPSHOT_FILE = "host-utility-selectors.json"

export interface PackedPlugin {
  id: string
  version: string
  output: string
  size: number
  sha256: string
}

export interface PackPluginOptions {
  /**
   * Optional path to a local Orahako host checkout containing `app/globals.css`.
   * When omitted, the packer uses the prebuilt host token and selector snapshots
   * shipped inside `@orahako/cli`.
   */
  hostRoot?: string
}

export async function packPlugin(
  pluginDirectory: string,
  output?: string,
  options: PackPluginOptions = {}
): Promise<PackedPlugin> {
  const directory = path.resolve(pluginDirectory)
  const manifestPath = path.join(directory, "manifest.json")
  const manifest = validatePluginManifest(JSON.parse(await readFile(manifestPath, "utf8")))
  const sourceEntry = ["src/index.tsx", "src/index.ts", "index.tsx", "index.ts"].find((entry) =>
    existsSync(path.join(directory, entry))
  )
  if (!sourceEntry) throw new Error(`Missing plugin source entry in ${directory}`)

  const { metafile, outputFiles } = await build({
    absWorkingDir: directory,
    entryPoints: [sourceEntry],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["chrome111"],
    outdir: "dist",
    write: false,
    metafile: true,
    plugins: [
      {
        name: "orahako-platform-modules",
        setup(build) {
          // esbuild's external package patterns also match subpaths.
          build.onResolve({ filter: /^[^./]/ }, ({ path }) =>
            platformModules.has(path) ? { path, external: true } : undefined
          )
        },
      },
    ],
    jsx: "automatic",
    loader: {
      ".png": "dataurl",
      ".jpg": "dataurl",
      ".jpeg": "dataurl",
      ".gif": "dataurl",
      ".webp": "dataurl",
      ".svg": "dataurl",
    },
    minify: true,
    sourcemap: false,
    logLevel: "warning",
  })

  const files: Record<string, Uint8Array> = {}
  for (const file of outputFiles) {
    files[path.relative(directory, file.path).split(path.sep).join("/")] = file.contents
  }
  // Metafile output keys are relative to absWorkingDir.
  if (!metafile.outputs[manifest.entry]?.entryPoint || !isJavaScriptPackagePath(manifest.entry)) {
    throw new Error(`Built JavaScript entry is missing: ${manifest.entry}`)
  }
  for (const [file, output] of Object.entries(metafile.outputs)) {
    if (!isJavaScriptPackagePath(file)) continue
    for (const { path, kind, external } of output.imports) {
      if (external && (!platformModules.has(path) || kind === "require-call")) {
        throw new Error(`Unsupported import "${path}" in ${file}`)
      }
    }
  }
  const assetsDirectory = path.join(directory, "assets")
  if (existsSync(assetsDirectory)) await collectFiles(directory, assetsDirectory, files)

  const utilities = await buildPluginUtilities(directory, options.hostRoot)
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
async function buildPluginUtilities(directory: string, hostRoot?: string): Promise<string> {
  const [defaultTheme, animations, hostTokens, hostSelectors] = await Promise.all([
    readFile(TAILWIND_THEME, "utf8"),
    readFile(TAILWIND_ANIMATIONS, "utf8"),
    resolveHostThemeBlock(hostRoot),
    resolveHostUtilitySelectors(hostRoot),
  ])
  const input = [
    "@layer theme, base, components, utilities;",
    animations,
    `@layer theme {\n${defaultTheme}\n}`,
    "@layer utilities {\n@tailwind utilities;\n}",
    "@custom-variant dark (&:is(.dark *));",
    '@source not "./node_modules";',
    '@source not "./dist";',
    hostTokens,
  ].join("\n")

  const { css } = await postcss([tailwindcss({ base: directory })]).process(input, {
    from: path.join(directory, "__plugin_tailwind.css"),
  })
  if (!/@layer utilities\s*\{/.test(css)) return ""
  return `${STYLE_HEADER}\n${isolatePluginStyles(css.trimStart(), hostSelectors)}`
}

/**
 * Keep a packaged stylesheet from out-ranking the host's own utilities or
 * re-declaring its theme variables.
 */
function isolatePluginStyles(css: string, hostSelectors: ReadonlySet<string>): string {
  const root = postcss.parse(css)
  const rules: postcss.Rule[] = []
  root.walkRules((rule) => {
    rules.push(rule)
  })

  for (const rule of rules) {
    if (!rule.parent) continue
    const selectors = splitSelectorList(rule.selector)
    if (
      rule.parent === root &&
      selectors.every((selector) => selector === ":root" || selector === ":host")
    ) {
      const layer = postcss.atRule({ name: "layer", params: PLUGIN_TOKEN_LAYER })
      layer.append(rule.clone())
      rule.replaceWith(layer)
      continue
    }
    if (!insideUtilitiesLayer(rule)) continue
    const prefix = nestedSelectorPrefix(rule)
    const kept = selectors.filter(
      (selector) =>
        !hostSelectors.has([...prefix, normalizeSelector(selector)].join(SELECTOR_PATH_SEPARATOR))
    )
    if (kept.length === selectors.length) continue
    if (kept.length === 0) rule.remove()
    else rule.selector = kept.join(", ")
  }

  const remaining: postcss.Rule[] = []
  root.walkRules((rule) => {
    remaining.push(rule)
  })
  for (const rule of remaining) {
    if (!rule.parent || rule.nodes?.length !== 0) continue
    if (insideUtilitiesLayer(rule)) rule.remove()
  }
  return root.toString()
}

function nestedSelectorPrefix(rule: postcss.Rule): string[] {
  const prefix: string[] = []
  for (
    let parent = rule.parent as postcss.Container | undefined;
    parent && parent.type !== "root";
    parent = parent.parent as postcss.Container | undefined
  ) {
    if (parent.type === "rule") {
      prefix.unshift(`{${normalizeSelector((parent as postcss.Rule).selector)}}`)
    } else if (parent.type === "atrule") {
      const atRule = parent as postcss.AtRule
      if (atRule.name !== "layer") {
        prefix.unshift(`@${atRule.name} ${normalizeSelector(atRule.params)}`)
      }
    }
  }
  return prefix
}

const SELECTOR_PATH_SEPARATOR = "\u0000"

function insideUtilitiesLayer(rule: postcss.Rule): boolean {
  for (
    let parent = rule.parent as postcss.Container | undefined;
    parent;
    parent = parent.parent as postcss.Container | undefined
  ) {
    if (parent.type !== "atrule") continue
    const atRule = parent as postcss.AtRule
    if (atRule.name !== "layer") continue
    if (splitSelectorList(atRule.params).some((layer) => layer.trim() === "utilities")) return true
  }
  return false
}

function splitSelectorList(selector: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | undefined
  let start = 0
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index]
    if (quote) {
      if (char === "\\") index += 1
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === "(" || char === "[") depth += 1
    else if (char === ")" || char === "]") depth -= 1
    else if (char === "," && depth === 0) {
      parts.push(selector.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(selector.slice(start).trim())
  return parts.filter(Boolean)
}

function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, " ").trim()
}

const hostSelectorsCache = new Map<string, Promise<ReadonlySet<string>>>()

async function resolveHostThemeBlock(hostRoot?: string): Promise<string> {
  if (hostRoot) {
    const stylesheet = path.join(hostRoot, "app/globals.css")
    return extractHostThemeBlock(await readFile(stylesheet, "utf8"), stylesheet)
  }
  const snapshotPath = path.join(MODULE_DIR, HOST_THEME_SNAPSHOT_FILE)
  if (existsSync(snapshotPath)) {
    return readFile(snapshotPath, "utf8")
  }
  const repoFallback = path.resolve(MODULE_DIR, "../../../..")
  const stylesheet = path.join(repoFallback, "app/globals.css")
  if (existsSync(stylesheet)) {
    return extractHostThemeBlock(await readFile(stylesheet, "utf8"), stylesheet)
  }
  throw new Error(
    `Missing host theme snapshot (${snapshotPath}). Rebuild @orahako/cli or pass hostRoot.`
  )
}

function resolveHostUtilitySelectors(hostRoot?: string): Promise<ReadonlySet<string>> {
  const cacheKey = hostRoot ? path.resolve(hostRoot) : "__snapshot__"
  let cached = hostSelectorsCache.get(cacheKey)
  if (!cached) {
    cached = (async () => {
      if (hostRoot) {
        return compileHostUtilitySelectors(hostRoot)
      }
      const snapshotPath = path.join(MODULE_DIR, HOST_SELECTORS_SNAPSHOT_FILE)
      if (existsSync(snapshotPath)) {
        const list = JSON.parse(await readFile(snapshotPath, "utf8")) as string[]
        return new Set(list)
      }
      const repoFallback = path.resolve(MODULE_DIR, "../../../..")
      if (existsSync(path.join(repoFallback, "app/globals.css"))) {
        return compileHostUtilitySelectors(repoFallback)
      }
      throw new Error(
        `Missing host utility selector snapshot (${snapshotPath}). Rebuild @orahako/cli or pass hostRoot.`
      )
    })()
    hostSelectorsCache.set(cacheKey, cached)
  }
  return cached
}

/**
 * Compile selectors the host's Tailwind build already generates from `app/globals.css`.
 */
export async function compileHostUtilitySelectors(hostRoot: string): Promise<Set<string>> {
  const stylesheet = path.join(hostRoot, "app/globals.css")
  const source = await readFile(stylesheet, "utf8")
  const { css } = await postcss([tailwindcss({ base: hostRoot })]).process(source, {
    from: stylesheet,
  })
  const root = postcss.parse(css)
  const selectors = new Set<string>()
  root.walkRules((rule) => {
    if (!insideUtilitiesLayer(rule)) return
    const prefix = nestedSelectorPrefix(rule)
    for (const selector of splitSelectorList(rule.selector)) {
      selectors.add([...prefix, normalizeSelector(selector)].join(SELECTOR_PATH_SEPARATOR))
    }
  })
  return selectors
}

/** Copy the host `@theme inline` blocks: token mappings only, no global rules. */
export function extractHostThemeBlock(stylesheet: string, sourceName = "app/globals.css"): string {
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
    if (depth !== 0) throw new Error(`Unterminated @theme inline block in ${sourceName}`)
    blocks.push(stylesheet.slice(start, end + 1))
    start = stylesheet.indexOf("@theme inline", end + 1)
  }
  if (blocks.length === 0) throw new Error(`Missing @theme inline block in ${sourceName}`)
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
      files[relative] = await readFile(absolute)
    }
  }
}
