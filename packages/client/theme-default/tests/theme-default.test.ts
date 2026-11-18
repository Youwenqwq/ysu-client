import { describe, expect, it } from "vitest"
import { PluginRuntime } from "@orahako/kernel"
import { PLUGIN_API_VERSION, validatePluginManifest } from "@orahako/sdk"
import { uiRegistryPlugin } from "@orahako/runtime-ui"
import { manifest, THEME_DEFAULT_PLUGIN_ID, themeDefaultPlugin } from "../src"

describe("@orahako/theme-default", () => {
  it("validates API v3 manifest and registers & cleans up the default theme", () => {
    const validated = validatePluginManifest(manifest)
    expect(validated.id).toBe(THEME_DEFAULT_PLUGIN_ID)
    expect(validated.apiVersion).toBe(PLUGIN_API_VERSION)
    expect(validated.kind).toBe("theme")
    expect(validated.inject).toEqual(["ui"])

    const runtime = new PluginRuntime()
    runtime.register(uiRegistryPlugin, "builtin")
    runtime.register(themeDefaultPlugin, "builtin")
    runtime.start(uiRegistryPlugin.manifest.id)
    runtime.start(themeDefaultPlugin.manifest.id)

    const ui = runtime.context.get("ui")!
    expect(ui.getSnapshot().themes).toEqual([
      {
        id: "default",
        pluginId: THEME_DEFAULT_PLUGIN_ID,
        name: "默认主题",
        css: "",
      },
    ])

    runtime.stop(themeDefaultPlugin.manifest.id)
    expect(ui.getSnapshot().themes).toEqual([])
    runtime.dispose()
  })
})
