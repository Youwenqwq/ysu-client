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
  return `${STYLE_HEADER}\n${isolatePluginStyles(css.trimStart(), await hostUtilitySelectors())}`
}

/**
 * Keep a packaged stylesheet from out-ranking the host's own utilities or
 * re-declaring its theme variables.
 *
 * Both stylesheets live in the `utilities` layer, and the plugin one is
 * injected last. Repeating a class the host already generates (`.hidden`,
 * `.p-4`, …) would therefore override every responsive variant of it that the
 * host emits before it (`.md:flex`, `md:p-8`, …), which turns the desktop
 * shell into its mobile layout. Dropping rules the host already defines keeps
 * the host's canonical declaration order; plugin-only classes stay put and
 * still win over host utilities they intentionally override.
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

  // Nested variants (`&:is(.dark *)`) live inside their utility rule; removing
  // every nested rule the host also generates must not leave empty shells.
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

/**
 * Selector of a rule including every ancestor rule and at-rule condition.
 *
 * Two stylesheets can emit identical leaf selectors for different utilities
 * (`&:is(.dark *)`), so the leaf alone cannot tell whether a rule duplicates
 * one the host already generates.
 */
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

/** Split a selector list on its top-level commas, ignoring `:is(a, b)` and strings. */
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

let hostSelectorsPromise: Promise<ReadonlySet<string>> | undefined

/**
 * Selectors the host's Tailwind build already generates.
 *
 * Compiled from `app/globals.css` with its own `@source` set, so it reflects
 * exactly what the shipped host stylesheet contains. Cached because one pack
 * run can package several plugins.
 */
function hostUtilitySelectors(): Promise<ReadonlySet<string>> {
  hostSelectorsPromise ??= (async () => {
    const source = await readFile(HOST_STYLESHEET, "utf8")
    const { css } = await postcss([tailwindcss({ base: HOST_ROOT })]).process(source, {
      from: HOST_STYLESHEET,
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
  })()
  return hostSelectorsPromise
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
