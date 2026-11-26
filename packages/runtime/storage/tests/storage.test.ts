import { Capacitor } from "@capacitor/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const secureMocks = vi.hoisted(() => {
  const store = new Map<string, string>()
  return {
    store,
    getItem: vi.fn(async (key: string) => store.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
})

vi.mock("@aparajita/capacitor-secure-storage", () => ({
  SecureStorage: {
    getItem: secureMocks.getItem,
    setItem: secureMocks.setItem,
    removeItem: secureMocks.removeItem,
  },
}))

import { PluginRuntime } from "@orahako/kernel"
import {
  definePlugin,
  defineStore,
  PLUGIN_API_VERSION,
  type PluginStorageService,
} from "@orahako/sdk"
import {
  createLocalStorageAdapter,
  createScopedStorage,
  createSecureStorageAdapter,
  formatPluginStorageKey,
  NamespacedStorageService,
  storageRuntimePlugin,
  type WebStorageLike,
} from "../src/index"

function createMockWebStorage(): WebStorageLike & { readonly data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem(key: string): string | null {
      return data.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      data.set(key, value)
    },
    removeItem(key: string): void {
      data.delete(key)
    },
  }
}

describe("@orahako/runtime-storage", () => {
  beforeEach(() => {
    secureMocks.store.clear()
    secureMocks.getItem.mockClear()
    secureMocks.setItem.mockClear()
    secureMocks.removeItem.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("isolates plugin local and secure keys under orahako-plugin:<pluginId>:<key> via storageRuntimePlugin", async () => {
    const webStorage = createMockWebStorage()
    vi.stubGlobal("localStorage", webStorage)

    const runtime = new PluginRuntime()
    let alphaStorage!: PluginStorageService
    let betaStorage!: PluginStorageService

    const alphaPlugin = definePlugin({
      manifest: {
        id: "plugin.alpha",
        name: "Alpha",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["storage"],
      },
      inject: ["storage"] as const,
      apply(ctx) {
        alphaStorage = ctx.storage
      },
    })

    const betaPlugin = definePlugin({
      manifest: {
        id: "plugin.beta",
        name: "Beta",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["storage"],
      },
      inject: ["storage"] as const,
      apply(ctx) {
        betaStorage = ctx.storage
      },
    })

    try {
      runtime.register(storageRuntimePlugin, "builtin")
      runtime.register(alphaPlugin, "builtin")
      runtime.register(betaPlugin, "builtin")

      await runtime.startAndWait(storageRuntimePlugin.manifest.id)
      await runtime.startAndWait(alphaPlugin.manifest.id)
      await runtime.startAndWait(betaPlugin.manifest.id)

      await alphaStorage.local.setItem("theme", "mint")
      await betaStorage.local.setItem("theme", "amber")
      await alphaStorage.secure.setItem("token", "secret-alpha")
      await betaStorage.secure.setItem("token", "secret-beta")

      expect(await alphaStorage.local.getItem("theme")).toBe("mint")
      expect(await betaStorage.local.getItem("theme")).toBe("amber")
      expect(await alphaStorage.secure.getItem("token")).toBe("secret-alpha")
      expect(await betaStorage.secure.getItem("token")).toBe("secret-beta")

      expect(webStorage.data.get("orahako-plugin:plugin.alpha:theme")).toBe("mint")
      expect(webStorage.data.get("orahako-plugin:plugin.beta:theme")).toBe("amber")
      expect(webStorage.data.get("orahako-plugin:plugin.alpha:token")).toBe("secret-alpha")
      expect(webStorage.data.get("orahako-plugin:plugin.beta:token")).toBe("secret-beta")

      await alphaStorage.local.removeItem("theme")
      expect(await alphaStorage.local.getItem("theme")).toBeNull()
      expect(await betaStorage.local.getItem("theme")).toBe("amber")
    } finally {
      runtime.dispose()
    }
  })

  it("falls back to instance-local memory in non-DOM and quota-exceeded environments without singleton leakage", async () => {
    vi.stubGlobal("localStorage", undefined)

    const serviceA = new NamespacedStorageService()
    const serviceB = new NamespacedStorageService()

    const scopedA = createScopedStorage("plugin.isolated", {
      local: createLocalStorageAdapter(() => undefined),
      secure: createSecureStorageAdapter({
        isNative: () => false,
        webFallback: createLocalStorageAdapter(() => undefined),
      }),
    })
    await scopedA.local.setItem("draft", "hello")
    await scopedA.secure.setItem("pin", "1234")
    expect(await scopedA.local.getItem("draft")).toBe("hello")
    expect(await scopedA.secure.getItem("pin")).toBe("1234")

    // Distinct service instances never share module-level fallback state
    const runtimeA = new PluginRuntime()
    const runtimeB = new PluginRuntime()
    try {
      runtimeA.context.set("storage", serviceA)
      runtimeB.context.set("storage", serviceB)

      let storageInA!: PluginStorageService
      let storageInB!: PluginStorageService

      const probe = definePlugin({
        manifest: {
          id: "plugin.probe",
          name: "Probe",
          version: "1.0.0",
          apiVersion: PLUGIN_API_VERSION,
          kind: "feature",
          entry: "index.js",
          inject: ["storage"],
        },
        inject: ["storage"] as const,
        apply(ctx) {
          storageInA = ctx.storage
        },
      })
      const probeB = definePlugin({
        manifest: probe.manifest,
        inject: ["storage"] as const,
        apply(ctx) {
          storageInB = ctx.storage
        },
      })

      runtimeA.register(probe, "builtin")
      runtimeB.register(probeB, "builtin")
      await runtimeA.startAndWait(probe.manifest.id)
      await runtimeB.startAndWait(probeB.manifest.id)

      await storageInA.local.setItem("shared-name", "only-in-a")
      expect(await storageInA.local.getItem("shared-name")).toBe("only-in-a")
      expect(await storageInB.local.getItem("shared-name")).toBeNull()
    } finally {
      runtimeA.dispose()
      runtimeB.dispose()
    }

    // QuotaExceededError fallback
    const quotaBrokenStorage: WebStorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError")
      },
      removeItem: () => {
        throw new Error("SecurityError")
      },
    }
    const resilient = createLocalStorageAdapter(() => quotaBrokenStorage)
    await resilient.setItem("k1", "v1")
    expect(await resilient.getItem("k1")).toBe("v1")
    await resilient.removeItem("k1")
    expect(await resilient.getItem("k1")).toBeNull()
  })

  it("delegates secure storage to @aparajita/capacitor-secure-storage on Capacitor native platforms", async () => {
    const webStorage = createMockWebStorage()
    vi.stubGlobal("localStorage", webStorage)
    vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true)

    const scoped = createScopedStorage("orahako.session")
    await scoped.secure.setItem("castgc", "TGT-999")

    expect(secureMocks.setItem).toHaveBeenCalledWith(
      "orahako-plugin:orahako.session:castgc",
      "TGT-999"
    )
    expect(webStorage.data.size).toBe(0)
    expect(await scoped.secure.getItem("castgc")).toBe("TGT-999")
    expect(secureMocks.getItem).toHaveBeenCalledWith("orahako-plugin:orahako.session:castgc")

    await scoped.secure.removeItem("castgc")
    expect(secureMocks.removeItem).toHaveBeenCalledWith("orahako-plugin:orahako.session:castgc")
    expect(await scoped.secure.getItem("castgc")).toBeNull()
  })

  it("validates pluginId and integrates with defineStore persistence", async () => {
    expect(() => formatPluginStorageKey("   ", "key")).toThrow(
      "Plugin ID must be a non-empty string"
    )
    expect(() => createScopedStorage("", {})).toThrow("Plugin ID must be a non-empty string")

    const scoped = createScopedStorage("plugin.counter")
    const counterStore = defineStore({
      init: () => ({ count: 0 }),
      persist: { key: "counter-state", mode: "local", version: 1 },
      actions: {
        increment(ctx) {
          ctx.set((prev) => ({ count: prev.count + 1 }))
        },
      },
    })

    const first = counterStore.create(scoped)
    first.actions.increment()
    await Promise.resolve()
    await Promise.resolve()
    first.dispose()

    const raw = await scoped.local.getItem("counter-state")
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)).toEqual({ version: 1, state: { count: 1 } })
  })
})
