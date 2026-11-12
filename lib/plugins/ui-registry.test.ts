import { describe, expect, it, vi } from "vitest"
import type { PluginManifest } from "@ysu/plugin-sdk"
import { PluginRuntime } from "./runtime"
import { PluginUIRegistry } from "./ui-registry"

const manifest: PluginManifest = {
  id: "example.ui",
  name: "UI example",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

function Page() {
  return null
}

function Icon() {
  return null
}

describe("PluginUIRegistry", () => {
  it("removes pages, navigation, and themes when their plugin stops", () => {
    const registry = new PluginUIRegistry()
    const runtime = new PluginRuntime(registry.createService)
    runtime.register(
      manifest,
      (ctx) => {
        ctx.ui.registerPage({ id: "index", title: "Home", component: Page })
        ctx.ui.registerNavigation({
          id: "home",
          title: "Home",
          page: "index",
          icon: Icon,
          group: "extras",
        })
        ctx.ui.registerOverviewWidget({
          id: "widget",
          title: "Widget",
          description: "Example",
          icon: Icon,
          component: Page,
          region: "content",
          defaultVisible: true,
        })
        ctx.ui.registerSetting({ id: "settings", title: "Settings", page: "index", icon: Icon })
        ctx.ui.registerTheme({ id: "dark", name: "Dark", css: ":root { --background: black }" })
      },
      "builtin"
    )

    runtime.start(manifest.id)
    expect(registry.getSnapshot().pages).toHaveLength(1)
    expect(registry.findPage(manifest.id, "index")?.component).toBe(Page)
    runtime.stop(manifest.id)
    expect(registry.getSnapshot()).toEqual({
      pages: [],
      navigation: [],
      themes: [],
      settings: [],
      overviewWidgets: [],
    })
  })

  it("rejects duplicate contribution IDs", async () => {
    const registry = new PluginUIRegistry()
    const runtime = new PluginRuntime(registry.createService)
    runtime.register(
      manifest,
      (ctx) => {
        ctx.ui.registerPage({ id: "index", title: "One", component: Page })
        ctx.ui.registerPage({ id: "index", title: "Two", component: Page })
      },
      "external"
    )
    runtime.start(manifest.id)
    await vi.waitFor(() => expect(runtime.get(manifest.id)?.status).toBe("failed"))
    expect(runtime.get(manifest.id)?.error).toContain("already registered")
  })
})
