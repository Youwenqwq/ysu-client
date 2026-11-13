import { describe, expect, it } from "vitest"
import type { PluginManifest } from "@orahako/plugin-sdk"
import { zh } from "@/lib/i18n/dict"
import { PluginRuntime } from "./runtime"
import { PluginI18nRegistry } from "./i18n-registry"

const manifest: PluginManifest = {
  id: "example.i18n",
  name: "I18n test",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

describe("plugin i18n dictionaries", () => {
  it("merges registered translations and removes them with the plugin", () => {
    const registry = new PluginI18nRegistry()
    const runtime = new PluginRuntime(registry.createService)
    runtime.register(
      manifest,
      (ctx) => {
        ctx.i18n.register({ zh: { example: { title: "插件标题" } } })
      },
      "builtin"
    )
    runtime.start(manifest.id)
    expect(registry.getDictionary("zh", zh)).toMatchObject({
      example: { title: "插件标题" },
    })
    runtime.stop(manifest.id)
    expect(registry.getDictionary("zh", zh)).not.toHaveProperty("example")
  })
})
