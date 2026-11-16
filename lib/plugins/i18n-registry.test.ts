import { describe, expect, it } from "vitest"
import type { PluginManifest } from "@orahako/plugin-sdk"
import { zh } from "@/plugins/official/runtime/i18n/dict"
import { PluginRuntime } from "./runtime"
import { PluginI18nRegistry } from "@/plugins/official/runtime/registries/i18n"

const manifest: PluginManifest = {
  id: "example.i18n",
  name: "I18n test",
  version: "1.0.0",
  apiVersion: 2,
  kind: "feature",
  entry: "index.js",
  inject: ["i18n"],
}

function setup() {
  const registry = new PluginI18nRegistry()
  const runtime = new PluginRuntime()
  runtime.context.set("i18n", registry)
  return { registry, runtime }
}

describe("plugin i18n dictionaries", () => {
  it("merges registered translations and removes them with the plugin", () => {
    const { registry, runtime } = setup()
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

  it("translates through the scope bound to the consumer manifest", () => {
    const { runtime } = setup()
    const translated: string[] = []
    runtime.register(
      manifest,
      (ctx) => {
        ctx.i18n.register({ zh: { example: { title: "插件标题" } } })
        translated.push(ctx.i18n.t("example.title"), ctx.i18n.t("example.missing"))
      },
      "builtin"
    )
    runtime.start(manifest.id)

    expect(translated).toEqual(["插件标题", "example.missing"])
  })
})
