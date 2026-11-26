import { describe, expect, it, vi } from "vitest"
import { PluginRuntime } from "@orahako/kernel"
import {
  definePlugin,
  defineStore,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  type PluginManifest,
  type PluginSettingsService,
  type PluginStorageService,
  type ScopedPluginService,
  type StoreInstance,
} from "@orahako/sdk"
import {
  PluginSlotRegistry,
  SLOTS_RUNTIME_PLUGIN_ID,
  slotRegistryPlugin,
} from "@orahako/runtime-slots"
import { PluginSettingsRegistry, SETTINGS_RUNTIME_PLUGIN_ID, settingsRegistryPlugin } from "../src"

declare module "@orahako/sdk" {
  interface SlotMap {
    "test.settings.subsection": {
      kind: "list"
      owner: Record<string, never>
    }
    "test.settings.shared": {
      kind: "list"
      owner: Record<string, never>
    }
  }
}

function Icon() {
  return null
}

function Panel() {
  return null
}

function featureManifest(id: string): PluginManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "feature",
    entry: "index.js",
    inject: ["settings"],
  }
}

describe("@orahako/runtime-settings", () => {
  it("registers categories via both overloads, attributes pluginId, and sorts by order then id", () => {
    const runtime = new PluginRuntime()
    runtime.register(settingsRegistryPlugin, "builtin")
    runtime.start(SETTINGS_RUNTIME_PLUGIN_ID)

    const alpha = featureManifest("example.alpha")
    const beta = featureManifest("example.beta")

    runtime.register(
      alpha,
      (ctx) => {
        ctx.settings.registerCategory({ id: "zeta", title: "Zeta", icon: Icon, order: 10 }, Panel)
        ctx.settings.registerCategory({
          id: "alpha",
          title: "Alpha",
          icon: Icon,
          order: 20,
          component: Panel,
        })
      },
      "external"
    )
    runtime.register(
      beta,
      (ctx) => {
        ctx.settings.registerCategory({ id: "gamma", title: "Gamma", icon: Icon, order: 20 }, Panel)
        ctx.settings.registerCategory({ id: "beta", title: "Beta", icon: Icon }, Panel)
      },
      "external"
    )

    runtime.start(alpha.id)
    runtime.start(beta.id)

    const settings = runtime.context.get("settings") as PluginSettingsRegistry
    const snapshot = settings.getSnapshot()
    expect(snapshot.map((item) => item.id)).toEqual(["zeta", "alpha", "gamma", "beta"])
    expect(snapshot.map((item) => item.pluginId)).toEqual([alpha.id, alpha.id, beta.id, beta.id])

    runtime.stop(alpha.id)
    expect(settings.getSnapshot().map((item) => item.id)).toEqual(["gamma", "beta"])

    runtime.start(alpha.id)
    expect(settings.getSnapshot().map((item) => item.id)).toEqual([
      "zeta",
      "alpha",
      "gamma",
      "beta",
    ])
    runtime.dispose()
  })

  it("rejects empty or duplicate category ids across plugins", async () => {
    const registry = new PluginSettingsRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("settings", registry)

    const alpha = featureManifest("example.alpha")
    const beta = featureManifest("example.beta")
    const empty = featureManifest("example.empty")

    runtime.register(
      alpha,
      (ctx) => {
        ctx.settings.registerCategory({ id: "shared", icon: Icon }, Panel)
      },
      "external"
    )
    runtime.register(
      beta,
      (ctx) => {
        ctx.settings.registerCategory({ id: "shared", icon: Icon }, Panel)
      },
      "external"
    )
    runtime.register(
      empty,
      (ctx) => {
        ctx.settings.registerCategory({ id: "", icon: Icon }, Panel)
      },
      "external"
    )

    runtime.start(alpha.id)
    runtime.start(beta.id)
    runtime.start(empty.id)

    await vi.waitFor(() => expect(runtime.get(beta.id)?.status).toBe("failed"))
    expect(runtime.get(beta.id)?.error).toContain("already registered: shared (example.alpha)")
    await vi.waitFor(() => expect(runtime.get(empty.id)?.status).toBe("failed"))
    expect(runtime.get(empty.id)?.error).toContain("id must not be empty")
    runtime.dispose()
  })

  it("rejects duplicate child slot declarations across settings categories", async () => {
    const slots = new PluginSlotRegistry()
    const settings = new PluginSettingsRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("slots", slots)
    runtime.context.set("settings", settings)

    const alpha = featureManifest("example.alpha")
    const beta = featureManifest("example.beta")
    const children = { "test.settings.shared": { kind: "list" } } as const

    for (const manifest of [alpha, beta]) {
      runtime.register(
        manifest,
        (ctx) => {
          ctx.settings.registerCategory({ id: manifest.id, icon: Icon, children }, Panel)
        },
        "external"
      )
    }

    runtime.start(alpha.id)
    runtime.start(beta.id)
    await vi.waitFor(() => expect(runtime.get(beta.id)?.status).toBe("failed"))
    expect(runtime.get(beta.id)?.error).toContain(
      "Plugin slot already declared: test.settings.shared"
    )
    runtime.dispose()
  })

  it("binds registrantCtx to inject, creates & disposes StoreDefinition with scoped storage, and manages child slots", async () => {
    const persisted = new Map<string, string>()
    const storageService: ScopedPluginService<PluginStorageService> = {
      [PLUGIN_SERVICE_SCOPE](_ctx, manifest) {
        const kv = {
          getItem: async (k: string) => persisted.get(`${manifest.id}:${k}`) ?? null,
          setItem: async (k: string, v: string) => {
            persisted.set(`${manifest.id}:${k}`, v)
          },
          removeItem: async (k: string) => {
            persisted.delete(`${manifest.id}:${k}`)
          },
        }
        return { local: kv, secure: kv }
      },
    }

    const slotsRegistry = new PluginSlotRegistry()
    const settingsRegistry = new PluginSettingsRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("storage", storageService)
    runtime.context.set("slots", slotsRegistry)
    runtime.context.set("settings", settingsRegistry)

    const categoryStore = defineStore({
      init: () => ({ notificationsEnabled: false }),
      persist: { key: "prefs" },
      actions: {
        enable(ctx) {
          ctx.set({ notificationsEnabled: true })
        },
      },
    })

    const plugin = definePlugin({
      manifest: {
        id: "example.notifications",
        name: "Notifications",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["settings"],
      apply(ctx) {
        ctx.settings.registerCategory(
          {
            id: "notifications",
            titleKey: "settings.notifications",
            icon: Icon,
            children: {
              "test.settings.subsection": { kind: "list" },
            },
            store: categoryStore,
            inject: () => ({ label: "notif" }),
          },
          () => null
        )
      },
    })

    runtime.register(plugin, "builtin")
    runtime.start(plugin.manifest.id)

    const category = settingsRegistry.getSnapshot()[0]!
    expect(category.id).toBe("notifications")
    expect(
      slotsRegistry.getSnapshot().declarations.some((d) => d.name === "test.settings.subsection")
    ).toBe(true)

    const injectResult = category.inject?.(runtime.context)
    expect(injectResult).toEqual({ label: "notif" })

    const storeInstance = category.store as StoreInstance<
      { notificationsEnabled: boolean },
      { enable(): void }
    >
    storeInstance.actions.enable()
    expect(storeInstance.source.getSnapshot()).toEqual({ notificationsEnabled: true })
    await vi.waitFor(() => expect(persisted.get("example.notifications:prefs")).toContain("true"))

    // Stopping plugin disposes store (subsequent actions become no-ops) and tears down child slot
    runtime.stop(plugin.manifest.id)
    storeInstance.actions.enable()
    expect(
      slotsRegistry.getSnapshot().declarations.some((d) => d.name === "test.settings.subsection")
    ).toBe(false)
    expect(settingsRegistry.getSnapshot()).toEqual([])
    runtime.dispose()
  })

  it("rejects leaked registrations from a disposed async continuation", async () => {
    const registry = new PluginSettingsRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("settings", registry)

    const gate = Promise.withResolvers<void>()
    let leakedSettings: PluginSettingsService | undefined
    const alpha = featureManifest("example.leaked")

    runtime.register(
      alpha,
      async (ctx) => {
        leakedSettings = ctx.settings
        await gate.promise
      },
      "external"
    )
    runtime.start(alpha.id)
    runtime.stop(alpha.id)
    gate.resolve()
    await Promise.resolve()

    expect(() => leakedSettings?.registerCategory({ id: "late", icon: Icon }, Panel)).toThrow()
    expect(registry.getSnapshot()).toEqual([])
    runtime.dispose()
  })

  it("bridges registered categories into 'settings.category.panel' keyed slot with a single shared StoreInstance and child slots", () => {
    let storeCreateCalls = 0
    const baseStore = defineStore({
      init: () => ({ count: 0 }),
      actions: {
        inc(ctx) {
          ctx.set((s) => ({ count: s.count + 1 }))
        },
      },
    })
    const trackedStore = {
      spec: baseStore.spec,
      create: (...args: Parameters<typeof baseStore.create>) => {
        storeCreateCalls += 1
        return baseStore.create(...args)
      },
    }

    const slotsRegistry = new PluginSlotRegistry()
    const settingsRegistry = new PluginSettingsRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("slots", slotsRegistry)
    runtime.context.set("settings", settingsRegistry)

    const plugin = definePlugin({
      manifest: {
        id: "example.bridged",
        name: "Bridged",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["settings"],
      apply(ctx) {
        ctx.settings.registerCategory(
          {
            id: "network",
            title: "Network",
            icon: Icon,
            children: {
              "test.settings.subsection": { kind: "list" },
            },
            store: trackedStore,
            inject: () => ({ tag: "bridged-inject" }),
          },
          Panel
        )
      },
    })

    runtime.register(plugin, "builtin")
    runtime.start(plugin.manifest.id)

    // Before "settings.category.panel" is declared, store was created ONCE and child slot is declared
    expect(storeCreateCalls).toBe(1)
    expect(
      slotsRegistry.getSnapshot().declarations.some((d) => d.name === "test.settings.subsection")
    ).toBe(true)

    // Declare "settings.category.panel" -> category panel registers automatically with key "network"
    const disposePanelDecl = slotsRegistry.declare({
      name: "settings.category.panel",
      kind: "keyed",
    })
    expect(storeCreateCalls).toBe(1)

    const matched = slotsRegistry.select("settings.category.panel", "network")
    expect(matched).toHaveLength(1)
    expect(matched[0]?.id).toBe("category-network")
    expect(matched[0]?.pluginId).toBe("example.bridged")
    expect(matched[0]?.store).toBe(settingsRegistry.getSnapshot()[0]?.store)
    expect(matched[0]?.inject?.(runtime.context)).toEqual({ tag: "bridged-inject" })
    expect(
      slotsRegistry.getSnapshot().declarations.some((d) => d.name === "test.settings.subsection")
    ).toBe(true)

    // Tearing down and re-declaring "settings.category.panel" keeps store single and re-bridges cleanly
    disposePanelDecl()
    expect(
      slotsRegistry.getSnapshot().declarations.some((d) => d.name === "test.settings.subsection")
    ).toBe(true)
    const disposePanelDecl2 = slotsRegistry.declare({
      name: "settings.category.panel",
      kind: "keyed",
    })
    expect(storeCreateCalls).toBe(1)
    expect(slotsRegistry.select("settings.category.panel", "network")).toHaveLength(1)

    // Stopping plugin removes both category metadata and slot contribution
    runtime.stop(plugin.manifest.id)
    expect(settingsRegistry.getSnapshot()).toEqual([])
    expect(slotsRegistry.select("settings.category.panel", "network")).toEqual([])

    disposePanelDecl2()
    runtime.dispose()
  })

  it("rebridges category panels after the slots service is replaced", async () => {
    const runtime = new PluginRuntime()
    runtime.register(slotRegistryPlugin, "builtin")
    runtime.register(settingsRegistryPlugin, "builtin")

    const feature = definePlugin({
      manifest: {
        id: "example.replacement",
        name: "Replacement",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["settings"],
      },
      inject: ["settings"] as const,
      apply(ctx) {
        ctx.settings.registerCategory(
          { id: "replacement", title: "Replacement", icon: Icon },
          Panel
        )
      },
    })
    runtime.register(feature, "builtin")

    runtime.start(SLOTS_RUNTIME_PLUGIN_ID)
    runtime.start(SETTINGS_RUNTIME_PLUGIN_ID)
    runtime.start(feature.manifest.id)
    await runtime.flush()

    const firstSlots = runtime.context.get("slots") as PluginSlotRegistry
    const firstPanel = firstSlots.declare({
      name: "settings.category.panel",
      kind: "keyed",
    })
    expect(firstSlots.select("settings.category.panel", "replacement")).toHaveLength(1)

    // Replace the whole slots service while settings and the feature stay mounted.
    runtime.stop(SLOTS_RUNTIME_PLUGIN_ID)
    await runtime.flush()
    runtime.register(slotRegistryPlugin, "builtin")
    runtime.start(SLOTS_RUNTIME_PLUGIN_ID)
    await runtime.flush()

    const replacementSlots = runtime.context.get("slots") as PluginSlotRegistry
    expect(replacementSlots).not.toBe(firstSlots)
    const replacementPanel = replacementSlots.declare({
      name: "settings.category.panel",
      kind: "keyed",
    })
    await vi.waitFor(() =>
      expect(replacementSlots.select("settings.category.panel", "replacement")).toHaveLength(1)
    )
    expect(runtime.get(SETTINGS_RUNTIME_PLUGIN_ID)?.status).toBe("active")
    expect(runtime.get(feature.manifest.id)?.status).toBe("active")

    firstPanel()
    replacementPanel()
    runtime.dispose()
  })
})
