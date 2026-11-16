import { describe, expect, it, vi } from "vitest"
import type { PluginManifest } from "@orahako/plugin-sdk"
import { PluginRuntime } from "./runtime"
import { PluginUIRegistry } from "@/plugins/official/runtime/registries/ui"

const manifest: PluginManifest = {
  id: "example.ui",
  name: "UI example",
  version: "1.0.0",
  apiVersion: 2,
  kind: "feature",
  entry: "index.js",
  inject: ["ui"],
}

function Page() {
  return null
}

function Icon() {
  return null
}

function setup() {
  const registry = new PluginUIRegistry()
  const runtime = new PluginRuntime()
  runtime.context.set("ui", registry)
  return { registry, runtime }
}

describe("PluginUIRegistry", () => {
  it("removes pages, navigation, and themes when their plugin stops", () => {
    const { registry, runtime } = setup()
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
        ctx.ui.registerTheme({ id: "dark", name: "Dark", css: ":root { --background: black }" })
        ctx.ui.registerShell({ id: "default", name: "Shell", component: Page })
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
      overviewWidgets: [],
      shells: [],
    })
  })

  it("attributes every contribution to the consumer manifest", () => {
    const { registry, runtime } = setup()
    runtime.register(
      manifest,
      (ctx) => {
        ctx.ui.registerPage({ id: "index", title: "Home", component: Page })
        ctx.ui.registerTheme({ id: "dark", name: "Dark", css: "" })
      },
      "builtin"
    )
    runtime.start(manifest.id)

    expect(registry.getSnapshot()).toMatchObject({
      pages: [{ pluginId: manifest.id, id: "index" }],
      themes: [{ pluginId: manifest.id, id: "dark" }],
    })
  })

  it("rejects duplicate semantic page routes", async () => {
    const { runtime } = setup()
    runtime.register(
      manifest,
      (ctx) => ctx.ui.registerPage({ id: "index", route: "home", title: "One", component: Page }),
      "builtin"
    )
    runtime.register(
      { ...manifest, id: "example.other" },
      (ctx) => ctx.ui.registerPage({ id: "index", route: "home", title: "Two", component: Page }),
      "external"
    )
    runtime.start(manifest.id)
    runtime.start("example.other")
    await vi.waitFor(() => expect(runtime.get("example.other")?.status).toBe("failed"))
    expect(runtime.get("example.other")?.error).toContain("route already registered")
  })

  it("rejects duplicate contribution IDs", async () => {
    const { runtime } = setup()
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
