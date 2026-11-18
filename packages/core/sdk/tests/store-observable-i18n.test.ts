import { describe, expect, it, vi } from "vitest"
import {
  createObservableSource,
  createTranslator,
  defineDictionary,
  defineStore,
  type PluginKeyValueStorage,
  type PluginLocale,
  type PluginStorageService,
} from "@orahako/sdk"

function createMemoryStorage(): {
  service: PluginStorageService
  localMap: Map<string, string>
  secureMap: Map<string, string>
} {
  const makeBackend = (map: Map<string, string>): PluginKeyValueStorage => ({
    async getItem(key) {
      return map.get(key) ?? null
    },
    async setItem(key, value) {
      map.set(key, value)
    },
    async removeItem(key) {
      map.delete(key)
    },
  })
  const localMap = new Map<string, string>()
  const secureMap = new Map<string, string>()
  return {
    service: {
      local: makeBackend(localMap),
      secure: makeBackend(secureMap),
    },
    localMap,
    secureMap,
  }
}

describe("createObservableSource", () => {
  it("preserves referential stability and deduplicates equal updates", () => {
    const source = createObservableSource({ count: 1 })
    const getRef = source.getSnapshot
    const subRef = source.subscribe
    expect(source.getSnapshot).toBe(getRef)
    expect(source.subscribe).toBe(subRef)

    const initialSnap = source.getSnapshot()
    const listener = vi.fn()
    const unsub = source.subscribe(listener)

    source.set(initialSnap)
    expect(listener).not.toHaveBeenCalled()

    source.set((prev) => ({ count: prev.count + 1 }))
    expect(listener).toHaveBeenCalledOnce()
    expect(source.getSnapshot()).toEqual({ count: 2 })

    unsub()
    source.set({ count: 3 })
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe("defineStore", () => {
  const counterStore = defineStore({
    init: () => ({ count: 0, label: "initial" }),
    persist: {
      key: "counter-state",
      mode: "local",
      version: 2,
      migrate: (raw, version) => {
        if (version === 1 && typeof raw === "object" && raw !== null && "value" in raw) {
          return { count: Number(raw.value), label: "migrated" }
        }
        return { count: 0, label: "fallback" }
      },
    },
    actions: {
      increment(ctx, step = 1): number {
        ctx.set((state) => ({ ...state, count: state.count + step }))
        return ctx.get().count
      },
      rename(ctx, label: string) {
        ctx.set((state) => ({ ...state, label }))
      },
      clear(ctx) {
        ctx.reset()
      },
    },
  })

  it("creates isolated instances without module-level singletons", () => {
    const a = counterStore.create()
    const b = counterStore.create()

    expect(a.hydrated.getSnapshot()).toBe(true)
    expect(a.actions.increment(5)).toBe(5)
    expect(a.source.getSnapshot().count).toBe(5)
    expect(b.source.getSnapshot().count).toBe(0)

    a.actions.clear()
    expect(a.source.getSnapshot()).toEqual({ count: 0, label: "initial" })
    a.dispose()
    b.dispose()
  })

  it("hydrates asynchronously, runs migrations, and persists updates", async () => {
    const { service, localMap } = createMemoryStorage()
    localMap.set("counter-state", JSON.stringify({ version: 1, state: { value: 42 } }))

    const instance = counterStore.create(service)
    expect(instance.hydrated.getSnapshot()).toBe(false)
    expect(instance.source.getSnapshot()).toEqual({ count: 0, label: "initial" })

    await vi.waitFor(() => expect(instance.hydrated.getSnapshot()).toBe(true))
    expect(instance.source.getSnapshot()).toEqual({ count: 42, label: "migrated" })

    instance.actions.increment(8)
    await vi.waitFor(() => {
      const saved = JSON.parse(localMap.get("counter-state")!)
      expect(saved).toEqual({ version: 2, state: { count: 50, label: "migrated" } })
    })
    instance.dispose()
  })

  it("does not overwrite synchronous mutations made before hydration settles", async () => {
    const { service, localMap } = createMemoryStorage()
    localMap.set(
      "counter-state",
      JSON.stringify({ version: 2, state: { count: 99, label: "old" } })
    )

    const instance = counterStore.create(service)
    instance.actions.rename("fresh")
    await vi.waitFor(() => expect(instance.hydrated.getSnapshot()).toBe(true))
    expect(instance.source.getSnapshot()).toEqual({ count: 0, label: "fresh" })
    instance.dispose()
  })

  it("supports secure persistence mode and stops mutating after dispose", async () => {
    const secretStore = defineStore({
      init: () => ({ token: "" }),
      persist: { key: "secret", mode: "secure" },
      actions: {
        setToken(ctx, token: string) {
          ctx.set({ token })
        },
      },
    })
    const { service, localMap, secureMap } = createMemoryStorage()
    const instance = secretStore.create(service)
    await vi.waitFor(() => expect(instance.hydrated.getSnapshot()).toBe(true))

    instance.actions.setToken("abc")
    await vi.waitFor(() => expect(secureMap.has("secret")).toBe(true))
    expect(localMap.size).toBe(0)

    instance.dispose()
    instance.actions.setToken("ignored")
    expect(instance.source.getSnapshot().token).toBe("abc")
  })
})

describe("defineDictionary & typed Translator", () => {
  const dict = defineDictionary({
    zh: {
      title: "课程表",
      summary: {
        week: "第 {n} 周",
      },
    },
    en: {
      title: "Schedule",
      summary: {
        week: "Week {n}",
      },
    },
  })

  it("narrows dot-path translation keys and interpolates parameters", () => {
    let locale: PluginLocale = "zh"
    const t = createTranslator(dict, () => locale)

    expect(t("title")).toBe("课程表")
    expect(t("summary.week", { n: 6 })).toBe("第 6 周")

    locale = "en"
    expect(t("title")).toBe("Schedule")
    expect(t("summary.week", { n: 6 })).toBe("Week 6")

    // Compile-time check: invalid key must fail typecheck
    if (false) {
      // @ts-expect-error unknown key is rejected statically
      t("summary.missing")
    }
  })

  it("enforces matching en shape at compile time", () => {
    if (false) {
      defineDictionary({
        zh: { a: "一", nested: { b: "二" } },
        // @ts-expect-error missing nested.b in en
        en: { a: "one", nested: {} },
      })
    }
    expect(dict.zh.title).toBe("课程表")
  })
})
