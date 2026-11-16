import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { unzipSync } from "fflate"
import { afterEach, describe, expect, it } from "vitest"
import type { PluginManifest } from "@orahako/plugin-sdk/manifest"
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
    apiVersion: 2,
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

  it("adds the plugin's Tailwind utilities next to its imported CSS", async () => {
    const { files, manifest, read } = await packFixture(
      { styles: ["dist/index.css"] },
      {
        "src/index.tsx": [
          'import "./style.css"',
          'export const layout = "text-muted-foreground rounded-lg bg-background dark:bg-primary/50 grid-cols-[repeat(auto-fit,minmax(0,1fr))] data-[state=active]:animate-in data-[state=active]:fade-in data-[state=active]:slide-in-from-bottom-2"',
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
    expect(utilities).toMatch(/\.text-muted-foreground\s*\{[^}]*color:\s*var\(--muted-foreground\)/)
    expect(utilities).toMatch(/\.rounded-lg\s*\{[^}]*border-radius:\s*var\(--radius\)/)
    expect(utilities).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(0,\s*1fr\)\)/)
    expect(utilities).toMatch(/\.dark\\:bg-primary\\\/50/)
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
