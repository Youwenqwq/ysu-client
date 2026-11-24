import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { unzipSync } from "fflate"
import postcss from "postcss"
import { afterEach, describe, expect, it } from "vitest"
import type { PluginManifest } from "@orahako/sdk"
import { PLUGIN_TAILWIND_STYLESHEET, packPlugin } from "./plugin-build"

const created: string[] = []

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

/** Build a throwaway plugin directory and return its unpacked ZIP contents. */
async function packFixture(manifest: Partial<PluginManifest>, sources: Record<string, string>) {
  const directory = await mkdtemp(path.join(tmpdir(), "orahako-plugin-"))
  created.push(directory)
  const base: PluginManifest = {
    id: "test.sample",
    name: "Sample",
    version: "1.0.0",
    apiVersion: 1,
    minAppVersion: "0.16.0",
    kind: "feature",
    entry: "dist/index.js",
  }
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ ...base, ...manifest }))
  for (const [relative, content] of Object.entries(sources)) {
    const target = path.join(directory, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }

  const { output } = await packPlugin(directory, path.join(directory, "plugin.zip"))
  const files = unzipSync(await readFile(output))
  const read = (file: string) => new TextDecoder().decode(files[file])
  return {
    files,
    manifest: JSON.parse(read("manifest.json")) as PluginManifest,
    read,
  }
}

describe("plugin packaging styles", () => {
  it("embeds image imports as data URLs for external packages", async () => {
    const { read } = await packFixture(
      {},
      {
        "src/index.tsx": 'import icon from "./icon.png"\nexport default icon',
        "src/icon.png": "not-a-real-png-but-valid-build-input",
      }
    )
    expect(read("dist/index.js")).toContain("data:image/png")
  })

  it("keeps API v1 platform modules external in the packed entry", async () => {
    const { manifest, read } = await packFixture(
      {},
      {
        "src/index.tsx": [
          'import { definePlugin } from "@orahako/sdk"',
          'import { Button } from "@orahako/ui-primitives"',
          'import manifest from "../manifest.json"',
          "export default definePlugin({ manifest, apply() {} })",
          'export const preview = <Button>{manifest.name}</Button>',
        ].join("\n"),
      }
    )

    expect(manifest).toMatchObject({ apiVersion: 1, kind: "feature", entry: "dist/index.js" })
    const entry = read("dist/index.js")
    expect(entry).toMatch(/from\s*["']@orahako\/sdk["']/)
    expect(entry).toMatch(/from\s*["']@orahako\/ui-primitives["']/)
    expect(entry).toMatch(/from\s*["']react\/jsx-runtime["']/)
  })

  it("rejects API versions other than v1", async () => {
    await expect(
      packFixture({ apiVersion: 2 }, { "src/index.ts": "export default null" })
    ).rejects.toThrow("apiVersion must be 1")
  })

  it("does not externalize unexported platform package subpaths", async () => {
    await expect(
      packFixture(
        {},
        {
          "src/index.ts": 'export { definePlugin as default } from "@orahako/sdk/internal"',
          "node_modules/@orahako/sdk/package.json": JSON.stringify({ exports: "./index.js" }),
          "node_modules/@orahako/sdk/index.js": "export function definePlugin() {}",
        }
      )
    ).rejects.toThrow(/Could not resolve "@orahako\/sdk\/internal"/)
  })

  it("adds the plugin's Tailwind utilities next to its imported CSS", async () => {
    const { files, manifest, read } = await packFixture(
      { styles: ["dist/index.css"] },
      {
        "src/index.tsx": [
          'import "./style.css"',
          'export const layout = "bg-card/70 rounded-[13px] dark:bg-primary/50 grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:slide-in-from-bottom-2"',
          "export default null",
        ].join("\n"),
        "src/style.css": [
          ".leaflet-pane { position: absolute; }",
          "@keyframes plugin-pulse { to { opacity: 0.5; } }",
        ].join("\n"),
      }
    )

    expect(manifest.styles).toEqual(["dist/index.css", PLUGIN_TAILWIND_STYLESHEET])
    expect(files["dist/index.js"]).toBeInstanceOf(Uint8Array)
    expect(read("dist/index.css")).toContain(".leaflet-pane")
    expect(read("dist/index.css")).toContain("@keyframes plugin-pulse")

    const utilities = read(PLUGIN_TAILWIND_STYLESHEET)
    expect(utilities).toMatch(/\.bg-card\\\/70\s*\{[^}]*var\(--card\)/)
    expect(utilities).toMatch(/\.rounded-\\\[13px\\\]\s*\{[^}]*border-radius:\s*13px/)
    expect(utilities).toMatch(
      /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(7rem,\s*1fr\)\)/
    )
    expect(utilities).toContain(".dark\\:bg-primary\\/50")
    expect(utilities).toContain(":is(.dark *)")
    expect(utilities).toMatch(/animation:\s*enter/)
    expect(utilities).toMatch(/--tw-enter-opacity:\s*0/)
    expect(utilities).toMatch(/--tw-enter-translate-y:/)
    expect(utilities).toContain('[data-state="active"]')

    // The host already ships preflight and global base rules.
    expect(utilities).not.toContain("box-sizing: border-box")
    expect(utilities).not.toContain("-webkit-text-size-adjust")
    expect(utilities).not.toContain("::file-selector-button")
    expect(utilities).not.toMatch(/--(?:background|primary|radius)\s*:/)
  })

  it("leaves utilities the host already declares to the host stylesheet", async () => {
    const { read } = await packFixture(
      {},
      {
        "src/index.tsx": [
          'export const layout = "hidden md:flex p-4 text-muted-foreground h-[42px] tracking-[0.31em]"',
          "export default null",
        ].join("\n"),
      }
    )

    const utilities = read(PLUGIN_TAILWIND_STYLESHEET)
    // Re-declaring these after the host would override the host's own
    // responsive variants (`hidden md:flex` → `.hidden` winning over `.md:flex`)
    // and collapse the desktop shell into its mobile layout.
    expect(utilities).not.toContain(".hidden {")
    expect(utilities).not.toContain(".md\\:flex {")
    expect(utilities).not.toContain(".p-4 {")
    expect(utilities).not.toContain(".text-muted-foreground {")
    // Plugin-only classes still ship with their own declarations.
    expect(utilities).toContain(".h-\\[42px\\] {")
    expect(utilities).toContain(".tracking-\\[0\\.31em\\] {")
  })

  it("keeps theme variable defaults in their own layer", async () => {
    const { read } = await packFixture(
      {},
      { "src/index.tsx": 'export const cls = "font-sans text-xs"\nexport default null' }
    )

    const root = postcss.parse(read(PLUGIN_TAILWIND_STYLESHEET))
    const themeRule = root.nodes.find(
      (node) => node.type === "rule" && node.selector === ":root, :host"
    )
    expect(themeRule).toBeUndefined()
    let layerName: string | undefined
    root.walkRules((rule) => {
      if (rule.selector !== ":root, :host") return
      const parent = rule.parent
      if (parent?.type === "atrule" && parent.name === "layer") layerName = parent.params
    })
    // Unlayered `:root` would out-rank the host's own declarations; the host
    // resolves `--font-sans` from the next/font class on `<html>`.
    expect(layerName).toBeTypeOf("string")
  })

  it("generates and declares a stylesheet when the plugin has none", async () => {
    const { manifest, read } = await packFixture(
      {},
      { "src/index.tsx": 'export const badge = "tracking-[0.31em]"\nexport default null' }
    )

    expect(manifest.styles).toEqual([PLUGIN_TAILWIND_STYLESHEET])
    expect(read(PLUGIN_TAILWIND_STYLESHEET)).toContain("letter-spacing: 0.31em")
  })

  it("leaves the manifest untouched when a plugin uses no utilities", async () => {
    const { files, manifest, read } = await packFixture(
      { styles: ["dist/index.css"] },
      {
        "src/index.tsx": 'import "./style.css"\nexport default null',
        "src/style.css": "@keyframes plugin-fade { from { opacity: 0; } }",
      }
    )

    expect(manifest.styles).toEqual(["dist/index.css"])
    expect(files[PLUGIN_TAILWIND_STYLESHEET]).toBeUndefined()
    expect(read("dist/index.css")).toContain("@keyframes plugin-fade")
  })
})
