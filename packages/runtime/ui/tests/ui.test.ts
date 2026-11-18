import { describe, expect, it, vi } from "vitest"
import { PluginRuntime } from "@orahako/kernel"
import {
  definePlugin,
  defineStore,
  PLUGIN_API_VERSION,
  type PluginManifest,
  type StoreInstance,
} from "@orahako/sdk"
import { PluginSlotRegistry } from "@orahako/runtime-slots"
import { PluginUIRegistry, UI_RUNTIME_PLUGIN_ID, uiRegistryPlugin } from "../src"

declare module "@orahako/sdk" {
  interface SlotMap {
    "test.ui.shell.header": {
      kind: "list"
      owner: Record<string, never>
    }
    "test.ui.page.toolbar": {
      kind: "single"
      owner: Record<string, never>
    }
  }
}

function Icon() {
  return null
}

function BlankView() {
  return null
}

const baseManifest: PluginManifest = {
  id: "example.ui",
  name: "UI Example",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "feature",
  entry: "index.js",
  inject: ["ui"],
}

describe("@orahako/runtime-ui", () => {
  it("registers pages, navigation, themes, and shells and revokes them when plugin stops", () => {
    const runtime = new PluginRuntime()
    runtime.register(uiRegistryPlugin, "builtin")
    runtime.start(UI_RUNTIME_PLUGIN_ID)

    runtime.register(
      baseManifest,
      (ctx) => {
        ctx.ui.registerPage({ id: "index", route: "home", titleKey: "nav.home" }, BlankView)
        ctx.ui.registerNavigation({
          id: "secondary",
          titleKey: "nav.secondary",
          page: "index",
          icon: Icon,
          group: "tools",
          order: 20,
        })
        ctx.ui.registerNavigation({
          id: "home",
          title: "Home",
          page: "index",
          icon: Icon,
          group: "main",
          order: 10,
          primary: true,
        })
        ctx.ui.registerTheme({ id: "ocean", name: "Ocean", css: ":root { --accent: cyan }" })
        ctx.ui.registerShell({ id: "default", name: "Default Shell" }, BlankView)
      },
      "builtin"
    )

    runtime.start(baseManifest.id)
    const rawUi: unknown = runtime.context.get("ui")
    if (!(rawUi instanceof PluginUIRegistry)) {
      throw new Error("Expected PluginUIRegistry instance")
    }
    const ui = rawUi
    const snap = ui.getSnapshot()

    expect(snap.pages).toHaveLength(1)
    expect(snap.pages[0]).toMatchObject({
      pluginId: baseManifest.id,
      id: "index",
      route: "home",
    })
    expect(ui.findPage(baseManifest.id, "index")?.component).toBe(BlankView)
    expect(snap.navigation.map((n) => n.id)).toEqual(["home", "secondary"])
    expect(ui.findNavigation("home")?.pluginId).toBe(baseManifest.id)
    expect(ui.findNavigation(`${baseManifest.id}:secondary`)?.id).toBe("secondary")
    expect(snap.themes).toEqual([
      { pluginId: baseManifest.id, id: "ocean", name: "Ocean", css: ":root { --accent: cyan }" },
    ])
    expect(snap.shells).toHaveLength(1)

    runtime.stop(baseManifest.id)
    expect(ui.getSnapshot()).toEqual({
      pages: [],
      navigation: [],
      themes: [],
      shells: [],
    })
    runtime.dispose()
  })

  it("rejects duplicate semantic routes across plugins and duplicate contribution IDs", async () => {
    const registry = new PluginUIRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("ui", registry)

    runtime.register(
      baseManifest,
      (ctx) => {
        ctx.ui.registerPage({ id: "index", route: "schedule", component: BlankView })
      },
      "builtin"
    )
    runtime.register(
      { ...baseManifest, id: "example.conflict" },
      (ctx) => {
        ctx.ui.registerPage({ id: "index", route: "schedule" }, BlankView)
      },
      "external"
    )
    runtime.register(
      { ...baseManifest, id: "example.dupid" },
      (ctx) => {
        ctx.ui.registerPage({ id: "index" }, BlankView)
        ctx.ui.registerPage({ id: "index" }, BlankView)
      },
      "external"
    )

    runtime.start(baseManifest.id)
    runtime.start("example.conflict")
    runtime.start("example.dupid")

    await vi.waitFor(() => expect(runtime.get("example.conflict")?.status).toBe("failed"))
    expect(runtime.get("example.conflict")?.error).toContain(
      "Plugin page route already registered: schedule"
    )

    await vi.waitFor(() => expect(runtime.get("example.dupid")?.status).toBe("failed"))
    expect(runtime.get("example.dupid")?.error).toContain(
      "Plugin UI contribution already registered: example.dupid:index"
    )
    runtime.dispose()
  })

  it("binds registrantCtx, StoreDefinition lifecycle, and child slot declarations on pages and shells", () => {
    const slots = new PluginSlotRegistry()
    const ui = new PluginUIRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("slots", slots)
    runtime.context.set("ui", ui)

    const pageStore = defineStore({
      init: () => ({ count: 0 }),
      actions: {
        inc(ctx) {
          ctx.set((s) => ({ count: s.count + 1 }))
        },
      },
    })

    const shellStore = defineStore({
      init: () => ({ collapsed: false }),
      actions: {
        toggle(ctx) {
          ctx.set((s) => ({ collapsed: !s.collapsed }))
        },
      },
    })

    let expectedCtx: unknown
    const seenInjectContexts: unknown[] = []

    const plugin = definePlugin({
      manifest: {
        id: "example.shell-and-page",
        name: "Shell & Page",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "shell",
        entry: "index.js",
      },
      inject: ["ui"],
      apply(ctx) {
        expectedCtx = ctx
        ctx.ui.registerPage(
          {
            id: "home",
            children: { "test.ui.page.toolbar": { kind: "single" } },
            store: pageStore,
            inject: (c) => {
              seenInjectContexts.push(c)
              return { kind: "page" }
            },
          },
          BlankView
        )
        ctx.ui.registerShell(
          {
            id: "main",
            name: "Main",
            children: { "test.ui.shell.header": { kind: "list" } },
            store: shellStore,
            inject: (c) => {
              seenInjectContexts.push(c)
              return { kind: "shell" }
            },
          },
          BlankView
        )
      },
    })

    runtime.register(plugin, "builtin")
    runtime.start(plugin.manifest.id)

    expect(slots.getSnapshot().declarations.map((d) => d.name)).toEqual([
      "root",
      "test.ui.page.toolbar",
      "test.ui.shell.header",
    ])

    const page = ui.findPage(plugin.manifest.id, "home")!
    const shell = ui.getSnapshot().shells[0]!

    expect(page.inject?.(runtime.context)).toEqual({ kind: "page" })
    expect(shell.inject?.(runtime.context)).toEqual({ kind: "shell" })
    expect(seenInjectContexts).toEqual([expectedCtx, expectedCtx])

    const pStore = page.store as StoreInstance<{ count: number }, { inc(): void }>
    const sStore = shell.store as StoreInstance<{ collapsed: boolean }, { toggle(): void }>
    pStore.actions.inc()
    sStore.actions.toggle()
    expect(pStore.source.getSnapshot()).toEqual({ count: 1 })
    expect(sStore.source.getSnapshot()).toEqual({ collapsed: true })

    // Stopping plugin disposes both stores and removes declared child slots
    runtime.stop(plugin.manifest.id)
    pStore.actions.inc()
    sStore.actions.toggle()
    expect(pStore.source.getSnapshot()).toEqual({ count: 1 })
    expect(sStore.source.getSnapshot()).toEqual({ collapsed: true })
    expect(slots.getSnapshot().declarations.map((d) => d.name)).toEqual(["root"])
    runtime.dispose()
  })
})
