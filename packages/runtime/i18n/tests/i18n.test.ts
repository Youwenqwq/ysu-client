import { afterEach, describe, expect, it, vi } from "vitest"
import { PluginRuntime } from "@orahako/kernel"
import {
  defineDictionary,
  definePlugin,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  type PluginKeyValueStorage,
  type PluginManifest,
  type PluginStorageService,
  type ScopedPluginService,
} from "@orahako/sdk"
import {
  I18N_PLUGIN_STORAGE_KEY,
  I18N_RUNTIME_PLUGIN_ID,
  I18N_SCOPED_STORAGE_KEY,
  i18nRegistryPlugin,
  PluginI18nRegistry,
} from "../src"

function createFeatureManifest(id: string): PluginManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "feature",
    entry: "index.js",
    inject: ["i18n"],
  }
}

function createMemoryStorageMap() {
  const records = new Map<string, string>()
  const createNamespace = (pluginId: string): PluginKeyValueStorage => ({
    async getItem(key: string) {
      return records.get(`orahako-plugin:${pluginId}:${key}`) ?? null
    },
    async setItem(key: string, value: string) {
      records.set(`orahako-plugin:${pluginId}:${key}`, value)
    },
    async removeItem(key: string) {
      records.delete(`orahako-plugin:${pluginId}:${key}`)
    },
  })

  const service: ScopedPluginService<PluginStorageService> = {
    [PLUGIN_SERVICE_SCOPE](_ctx, manifest) {
      const ns = createNamespace(manifest.id)
      return { local: ns, secure: ns }
    },
  }

  return { records, service, createNamespace }
}

describe("@orahako/runtime-i18n", () => {
  const originalLocalStorage = globalThis.localStorage

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    })
  })

  it("merges scoped plugin translations into getDictionary and cleans up on plugin stop", () => {
    const registry = new PluginI18nRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("i18n", registry)

    const baseZh = { common: { ok: "确定" } }
    const manifest = createFeatureManifest("example.i18n")

    runtime.register(
      manifest,
      (ctx) => {
        ctx.i18n.register({
          zh: { example: { title: "你好 {name}" } },
          en: { example: { title: "Hello {name}" } },
        })
      },
      "builtin"
    )

    runtime.start(manifest.id)
    const mergedZh = registry.getDictionary("zh", baseZh)
    expect(mergedZh).toEqual({
      common: { ok: "确定" },
      example: { title: "你好 {name}" },
    })
    expect(baseZh).not.toHaveProperty("example")

    expect(registry.translate(manifest.id, "example.title", "zh", { name: "YSU" })).toBe("你好 YSU")
    expect(registry.translate(manifest.id, "example.title", "en", { name: "YSU" })).toBe(
      "Hello YSU"
    )
    expect(registry.translate(manifest.id, "example.missing", "zh")).toBe("example.missing")

    runtime.stop(manifest.id)
    expect(registry.getDictionary("zh", baseZh)).toEqual({ common: { ok: "确定" } })
    expect(registry.translate(manifest.id, "example.title", "zh", { name: "YSU" })).toBe(
      "example.title"
    )
    runtime.dispose()
  })

  it("notifies locale observable and revision subscribers and binds typed translator", () => {
    const registry = new PluginI18nRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("i18n", registry)

    const dict = defineDictionary({
      zh: { greeting: "早安 {user}" },
      en: { greeting: "Morning {user}" },
    })

    const localeSpy = vi.fn()
    const revisionSpy = vi.fn()
    registry.locale.subscribe(localeSpy)
    registry.subscribe(revisionSpy)

    let translateFn!: ReturnType<typeof registry.translator<typeof dict>>
    const manifest = createFeatureManifest("example.translator")
    runtime.register(
      manifest,
      (ctx) => {
        translateFn = ctx.i18n.translator(dict)
      },
      "builtin"
    )
    runtime.start(manifest.id)

    expect(translateFn("greeting", { user: "Alice" })).toBe("早安 Alice")
    expect(registry.getLocale()).toBe("zh")

    registry.setLocale("en")
    expect(registry.getLocale()).toBe("en")
    expect(localeSpy).toHaveBeenCalledOnce()
    expect(revisionSpy).toHaveBeenCalledOnce()
    expect(translateFn("greeting", { user: "Alice" })).toBe("Morning Alice")

    // Setting identical locale is a no-op for listeners
    registry.setLocale("en")
    expect(localeSpy).toHaveBeenCalledOnce()

    expect(() => registry.setLocale("fr" as never)).toThrow("Unsupported plugin locale")
    runtime.dispose()
  })

  it("hydrates and persists locale via scoped storage under orahako-plugin:orahako.runtime.i18n:locale", async () => {
    const { records, service } = createMemoryStorageMap()
    records.set(I18N_SCOPED_STORAGE_KEY, "en")

    const storagePlugin = definePlugin({
      manifest: {
        id: "orahako.runtime.storage",
        name: "Storage",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "runtime",
        entry: "index.js",
        provides: ["storage"],
      },
      apply(ctx) {
        ctx.set("storage", service)
      },
    })

    const runtime = new PluginRuntime()
    runtime.register(i18nRegistryPlugin, "builtin")
    runtime.register(storagePlugin, "builtin")

    // Start i18n BEFORE storage to verify late storage attachment & hydration
    runtime.start(I18N_RUNTIME_PLUGIN_ID)
    expect((runtime.context.get("i18n") as PluginI18nRegistry).getLocale()).toBe("zh")

    runtime.start("orahako.runtime.storage")
    await runtime.flush()
    const i18n = runtime.context.get("i18n") as PluginI18nRegistry
    await vi.waitFor(() => expect(i18n.getLocale()).toBe("en"))

    i18n.setLocale("zh")
    await vi.waitFor(() => expect(records.get(I18N_SCOPED_STORAGE_KEY)).toBe("zh"))
    runtime.dispose()
  })

  it("hydrates from and writes to a replacement storage backend after service swap", async () => {
    const first = createMemoryStorageMap()
    first.records.set(I18N_SCOPED_STORAGE_KEY, "en")
    const second = createMemoryStorageMap()

    const storagePlugin = (id: string, storage: ScopedPluginService<PluginStorageService>) =>
      definePlugin({
        manifest: {
          id,
          name: id,
          version: "1.0.0",
          apiVersion: PLUGIN_API_VERSION,
          kind: "runtime",
          entry: "index.js",
          provides: ["storage"],
        },
        apply(ctx) {
          ctx.set("storage", storage)
        },
      })

    const runtime = new PluginRuntime()
    runtime.register(i18nRegistryPlugin, "builtin")
    runtime.register(storagePlugin("test.storage.first", first.service), "builtin")
    runtime.register(storagePlugin("test.storage.second", second.service), "builtin")

    runtime.start(I18N_RUNTIME_PLUGIN_ID)
    runtime.start("test.storage.first")
    await runtime.flush()

    const firstRegistry = runtime.context.get("i18n") as PluginI18nRegistry
    await vi.waitFor(() => expect(firstRegistry.getLocale()).toBe("en"))
    firstRegistry.setLocale("zh")
    await vi.waitFor(() => expect(first.records.get(I18N_SCOPED_STORAGE_KEY)).toBe("zh"))

    // Replacing the storage service remounts i18n against the new backend.
    runtime.stop("test.storage.first")
    await runtime.flush()
    runtime.start("test.storage.second")
    await runtime.flush()

    const secondRegistry = runtime.context.get("i18n") as PluginI18nRegistry
    expect(secondRegistry).not.toBe(firstRegistry)
    await vi.waitFor(() => expect(secondRegistry.getLocale()).toBe("zh"))
    secondRegistry.setLocale("en")
    await vi.waitFor(() => expect(second.records.get(I18N_SCOPED_STORAGE_KEY)).toBe("en"))
    expect(first.records.get(I18N_SCOPED_STORAGE_KEY)).toBe("zh")
    runtime.dispose()
  })

  it("does not overwrite explicit setLocale called before async storage hydration settles", async () => {
    const pendingGet = Promise.withResolvers<string | null>()
    const setItem = vi.fn(async () => {})
    const registry = new PluginI18nRegistry({
      defaultLocale: "zh",
      storage: {
        getItem: () => pendingGet.promise,
        setItem,
        removeItem: async () => {},
      },
    })

    registry.setLocale("en")
    expect(setItem).toHaveBeenCalledWith(I18N_PLUGIN_STORAGE_KEY, "en")

    pendingGet.resolve("zh")
    await Promise.resolve()
    expect(registry.getLocale()).toBe("en")
    registry.dispose()
  })

  it("persists to localStorage under scoped key when no storage service is mounted", () => {
    const store = new Map<string, string>([[I18N_SCOPED_STORAGE_KEY, "en"]])
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => {
          store.set(k, v)
        },
        removeItem: (k: string) => {
          store.delete(k)
        },
      },
      configurable: true,
      writable: true,
    })

    const registry = new PluginI18nRegistry({ defaultLocale: "zh" })
    expect(registry.getLocale()).toBe("en")

    registry.setLocale("zh")
    expect(store.get(I18N_SCOPED_STORAGE_KEY)).toBe("zh")
    registry.dispose()
  })
})
