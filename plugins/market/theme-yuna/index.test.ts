import { existsSync } from "node:fs"
import { parse } from "postcss"
import { describe, expect, it } from "vitest"
import { PluginRuntime } from "@/lib/plugins/runtime"
import { PluginUIRegistry } from "@/lib/plugins/ui-registry"
import definition, { manifest } from "./index"
import { createThemeCss } from "./styles"

describe("YUNA theme plugin", () => {
  it("registers all three themes and removes them when disabled", async () => {
    const registry = new PluginUIRegistry()
    const assetPaths = new Set<string>()
    const runtime = new PluginRuntime((ctx, plugin) => {
      registry.createService(ctx, plugin)
      ctx.set("assets", {
        url: (path: string) => {
          assetPaths.add(path)
          return `blob:test-${path}`
        },
      })
    })
    try {
      runtime.register(manifest, definition, "external")
      await runtime.startAndWait(manifest.id)
      expect(registry.getSnapshot().themes.map((theme) => theme.id)).toEqual([
        "102",
        "arknights",
        "scarlet",
      ])
      for (const path of assetPaths) {
        expect(existsSync(new URL(path, import.meta.url))).toBe(true)
      }
      for (const theme of registry.getSnapshot().themes) {
        const rules = parse(theme.css).nodes
        expect(rules.some((node) => node.type === "rule" && node.selector === "html.dark")).toBe(
          true
        )
        expect(
          rules.some((node) => node.type === "rule" && node.selector === "html:not(.dark)")
        ).toBe(true)
        expect(theme.css).not.toMatch(/https?:\/\//)
        expect(theme.css).not.toContain("data-skin")
      }
      runtime.stop(manifest.id)
      expect(registry.getSnapshot().themes).toHaveLength(0)
      await runtime.startAndWait(manifest.id)
      expect(registry.getSnapshot().themes).toHaveLength(3)
    } finally {
      runtime.dispose()
    }
  })

  it("fails before theme registration when a packaged font is missing", () => {
    expect(() => createThemeCss("arknights", () => undefined)).toThrow("font asset is missing")
  })
})
