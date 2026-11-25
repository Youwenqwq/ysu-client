import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  sessionRuntimePlugin,
} from "@orahako/academic-runtime"
import { defineSchoolProvider } from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { StatelessHttpService } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { createNativeService } from "@orahako/runtime-native"
import {
  ContributionOutlet,
  slotRegistryPlugin,
  type PluginSlotRegistry,
} from "@orahako/runtime-slots"
import { formatPluginStorageKey, NamespacedStorageService } from "@orahako/runtime-storage"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type MarketplaceIndex,
  type MarketplacePlugin,
  type ObservableSource,
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
  type PluginManifest,
  type PluginPackageRuntime,
} from "@orahako/sdk"
import {
  ONBOARDING_PLUGIN_ID,
  onboardingPlugin,
  type OnboardingSchoolChoice,
} from "../src"

class MiniDomNode {
  readonly nodeType: number
  readonly nodeName: string
  readonly tagName?: string
  readonly namespaceURI = "http://www.w3.org/1999/xhtml"
  readonly childNodes: MiniDomNode[] = []
  parentNode: MiniDomNode | null = null
  ownerDocument: MiniDomNode | null = null
  defaultView: unknown = undefined
  activeElement: unknown = null
  nodeValue?: string
  readonly style: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, Set<(event: unknown) => void>>()
  private rawText = ""

  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    if (nodeType === 1) this.tagName = nodeName
  }

  get firstChild(): MiniDomNode | null {
    return this.childNodes[0] ?? null
  }

  get nextSibling(): MiniDomNode | null {
    if (!this.parentNode) return null
    const index = this.parentNode.childNodes.indexOf(this)
    return index >= 0 ? (this.parentNode.childNodes[index + 1] ?? null) : null
  }

  appendChild(child: MiniDomNode): MiniDomNode {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore(child: MiniDomNode, before: MiniDomNode | null): MiniDomNode {
    if (!before) return this.appendChild(child)
    if (child.parentNode) child.parentNode.removeChild(child)
    const index = this.childNodes.indexOf(before)
    child.parentNode = this
    if (index >= 0) this.childNodes.splice(index, 0, child)
    else this.childNodes.push(child)
    return child
  }

  removeChild(child: MiniDomNode): MiniDomNode {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) {
      this.childNodes.splice(index, 1)
      child.parentNode = null
    }
    return child
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value))
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  addEventListener(type: string, fn: (event: unknown) => void): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(fn)
  }

  removeEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(fn)
  }

  set textContent(value: string) {
    this.childNodes.length = 0
    this.rawText = String(value)
  }

  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue ?? ""
    if (this.nodeType === 8) return ""
    if (this.childNodes.length === 0) return this.rawText
    return this.childNodes.map((child) => child.textContent).join("")
  }
}

function mountMiniDom() {
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const prevAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    location: { reload: vi.fn() },
  }
  const doc = new MiniDomNode(9, "#document")
  doc.defaultView = fakeWin
  const docWithFactories = Object.assign(doc, {
    createElement(tag: string) {
      const el = new MiniDomNode(1, tag.toUpperCase())
      el.ownerDocument = docWithFactories
      return el
    },
    createElementNS(_ns: string, tag: string) {
      return docWithFactories.createElement(tag)
    },
    createTextNode(text: string) {
      const node = new MiniDomNode(3, "#text")
      node.nodeValue = String(text)
      node.ownerDocument = docWithFactories
      return node
    },
    createComment(text: string) {
      const node = new MiniDomNode(8, "#comment")
      node.nodeValue = String(text)
      node.ownerDocument = docWithFactories
      return node
    },
  })

  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).window = fakeWin
  ;(globalThis as Record<string, unknown>).document = docWithFactories

  const container = docWithFactories.createElement("div")
  const root = createRoot(container as never)

  return {
    container,
    async render(node: React.ReactNode) {
      await act(async () => {
        root.render(node)
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = prevAct
      ;(globalThis as Record<string, unknown>).window = prevWindow
      ;(globalThis as Record<string, unknown>).document = prevDocument
    },
  }
}

let activeUnmount: (() => Promise<void>) | undefined
afterEach(async () => {
  if (activeUnmount) {
    const fn = activeUnmount
    activeUnmount = undefined
    await fn()
  }
  vi.restoreAllMocks()
})

function createMemoryStorage(): PluginKeyValueStorage {
  const map = new Map<string, string>()
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value)
    },
    removeItem: async (key) => {
      map.delete(key)
    },
  }
}

const YSU_SCHOOL: OnboardingSchoolChoice = {
  id: "ysu",
  name: "燕山大学",
  nameEn: "Yanshan University",
  builtin: true,
}
const ZMU_NAME = "遵义医科大学教务"

let marketSequence = 0

function providerPlugin(
  id: string,
  name: string,
  categories: readonly string[] = ["provider"]
): MarketplacePlugin {
  return {
    id,
    name,
    summary: "",
    author: "",
    categories: [...categories],
    versions: [],
  }
}

function marketIndex(plugins: readonly MarketplacePlugin[]): MarketplaceIndex {
  return {
    schemaVersion: 1,
    updatedAt: "2026-11-23T00:00:00Z",
    plugins: [...plugins],
  }
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

interface TestSchoolHooks {
  readonly storeHydrated: ObservableSource<boolean>
  readonly schools: ObservableSource<readonly OnboardingSchoolChoice[]>
  readonly schoolsLoading: ObservableSource<boolean>
  readonly schoolsError: ObservableSource<string | null>
}

interface TestInjected {
  readonly hooks: TestSchoolHooks
  retrySchoolDiscovery(): void
  activateSchoolChoice(school: OnboardingSchoolChoice): Promise<void>
  requestNotificationPermission(): Promise<boolean>
  requestExactAlarmPermission(): Promise<boolean>
  requestBatteryOptimizationExemption(): Promise<boolean>
}

interface TestStoreInstance {
  readonly hydrated: { getSnapshot(): boolean }
  readonly source: { getSnapshot(): { completed: boolean; selectedSchoolId: string | null } }
  readonly actions: { complete(): void; selectSchool(id: string): void }
}

function createOnboardingEnv(options: {
  schools?: readonly OnboardingSchoolChoice[]
  index?: MarketplaceIndex
  fetch?: () => Promise<Response>
  registerOnlineProviders?: readonly string[]
}) {
  const dom = mountMiniDom()
  const localBackend = createMemoryStorage()
  const secureBackend = createMemoryStorage()
  const runtime = new PluginRuntime()

  runtime.context.set(
    "storage",
    new NamespacedStorageService({
      local: localBackend,
      secure: secureBackend,
    })
  )
  runtime.context.set("http", new StatelessHttpService())

  const registerOnlineProviders = options.registerOnlineProviders ?? []
  const applyPluginBundle = vi.fn(
    async (pluginIds: readonly string[], _index: MarketplaceIndex): Promise<PluginManifest> => {
      const primary = pluginIds[0]!
      const schoolId = primary.endsWith(".provider")
        ? primary.slice(0, -".provider".length)
        : primary
      if (registerOnlineProviders.includes(primary)) {
        runtime.context.get("providers")?.registerProvider(schoolId, () =>
          defineSchoolProvider({
            id: schoolId,
            name: schoolId,
            slices: {},
            async initialize() {},
            async reset() {},
            async logout() {},
            async dispose() {},
            async relogin() {
              return false
            },
          })
        )
      }
      return {
        id: primary,
        name: "Market Provider",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
      }
    }
  )

  const packageRuntime: PluginPackageRuntime = {
    installFromUrl: vi.fn(),
    applyPluginBundle,
    assetUrl: () => undefined,
    nativeCapabilities: () => [],
  }
  runtime.context.set("packageRuntime", packageRuntime)

  const nativeInvoke = vi.fn(async (_id: string, method: string) => {
    if (method === "checkPermissions" || method === "checkExactAlarmPermission") {
      return { granted: false }
    }
    if (method === "requestPermissions" || method === "requestExactAlarmPermission") {
      return { granted: true }
    }
    if (method === "checkBatteryOptimization") {
      return { ignored: false }
    }
    if (method === "requestIgnoreBatteryOptimization") {
      return { ignored: true }
    }
    return {}
  })

  const nativeService = createNativeService({
    isNative: () => true,
    loadCapabilities: async () => [],
    capabilities: {
      list: () => [],
      has: () => true,
      acquire: async () => async () => {},
      invoke: nativeInvoke as never,
    },
  })
  runtime.context.set("native", nativeService)

  const builtinProviderPlugin = definePlugin({
    manifest: {
      id: "ysu.provider",
      name: "YSU",
      version: "1.0.0",
      apiVersion: PLUGIN_API_VERSION,
      kind: "provider",
      entry: "index.js",
      inject: ["providers"],
    },
    inject: ["providers"] as const,
    apply(ctx) {
      ctx.providers.registerProvider("ysu", () =>
        defineSchoolProvider({
          id: "ysu",
          name: "燕山大学",
          slices: {},
          async initialize() {},
          async reset() {},
          async logout() {},
          async dispose() {},
          async relogin() {
            return false
          },
        })
      )
    },
  })

  for (const p of [
    slotRegistryPlugin,
    i18nRegistryPlugin,
    providerRegistryRuntimePlugin,
    sessionRuntimePlugin,
    providerRuntimePlugin,
    builtinProviderPlugin,
  ]) {
    runtime.register(p, "builtin")
    runtime.start(p.manifest.id)
  }

  const fetchMock = options.fetch
    ? vi.fn(options.fetch)
    : vi.fn(async () => jsonResponse(options.index ?? marketIndex([])))
  vi.spyOn(globalThis, "fetch").mockImplementation(fetchMock as unknown as typeof fetch)

  const marketUrl = `https://market.example/${++marketSequence}/plugins.json`
  runtime.register(onboardingPlugin, "builtin", {
    marketUrl,
    schools: options.schools ?? [YSU_SCHOOL],
  })
  runtime.start(ONBOARDING_PLUGIN_ID)

  const slots = runtime.context.get("slots") as PluginSlotRegistry
  const disposeOverlay = slots.declare({ name: "shell.overlay", kind: "list" })
  const entry = slots.select("shell.overlay")[0]!
  const injected = entry.inject!(runtime.context) as TestInjected
  const storeInstance = entry.store as TestStoreInstance

  let runtimeDisposed = false
  const disposeRuntime = () => {
    if (runtimeDisposed) return
    runtimeDisposed = true
    runtime.dispose()
  }

  return {
    dom,
    runtime,
    localBackend,
    fetchMock,
    applyPluginBundle,
    slots,
    entry,
    injected,
    storeInstance,
    disposeRuntime,
    async cleanup() {
      disposeOverlay()
      disposeRuntime()
      await dom.unmount()
    },
  }
}

describe("@orahako/plugin-onboarding", () => {
  it("merges market provider plugins with configured schools and renders them through derived hooks", async () => {
    const marketDeferred = Promise.withResolvers<Response>()
    const env = createOnboardingEnv({ fetch: () => marketDeferred.promise })
    activeUnmount = env.cleanup

    expect(env.slots.select("shell.overlay")).toHaveLength(1)
    await vi.waitFor(() => expect(env.storeInstance.hydrated.getSnapshot()).toBe(true))
    await vi.waitFor(() =>
      expect(env.runtime.context.get("session")?.getSnapshot().hasHydrated).toBe(true)
    )

    const i18n = env.runtime.context.get("i18n") as PluginI18nRegistryService
    await env.dom.render(<ContributionOutlet entry={env.entry} slots={env.slots} i18n={i18n} />)

    expect(env.dom.container.textContent).toContain("初次设置")
    expect(env.dom.container.textContent).toContain("燕山大学")
    expect(env.dom.container.textContent).not.toContain(ZMU_NAME)
    expect(env.injected.hooks.schoolsLoading.getSnapshot()).toBe(true)

    await act(async () => {
      marketDeferred.resolve(
        jsonResponse(
          marketIndex([
            providerPlugin("ysu.provider", "YSU Online"),
            providerPlugin("zmu.provider", ZMU_NAME),
            providerPlugin("zmu.essentials", "ZMU Essentials", ["feature"]),
            providerPlugin("provider", "Nameless Provider"),
          ])
        )
      )
      await vi.waitFor(() => expect(env.injected.hooks.schools.getSnapshot()).toHaveLength(2))
    })

    expect(env.injected.hooks.schoolsLoading.getSnapshot()).toBe(false)
    expect(env.injected.hooks.schoolsError.getSnapshot()).toBeNull()
    expect(env.injected.hooks.schools.getSnapshot()).toEqual([
      YSU_SCHOOL,
      { id: "zmu", name: ZMU_NAME, bundleId: "zmu.provider" },
    ])
    expect(env.dom.container.textContent).toContain(ZMU_NAME)
    expect(env.dom.container.textContent).toContain("在线插件")
  })

  it("keeps configured schools and exposes a retry when market discovery fails", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("market offline"))
      .mockResolvedValueOnce(
        jsonResponse(marketIndex([providerPlugin("zmu.provider", ZMU_NAME)]))
      )
    const env = createOnboardingEnv({ fetch: fetchMock })
    activeUnmount = env.cleanup

    await vi.waitFor(() => {
      expect(env.injected.hooks.schoolsError.getSnapshot()).toBe("market offline")
      expect(env.injected.hooks.schoolsLoading.getSnapshot()).toBe(false)
    })
    expect(env.injected.hooks.schools.getSnapshot()).toEqual([YSU_SCHOOL])

    env.injected.retrySchoolDiscovery()

    await vi.waitFor(() => {
      expect(env.injected.hooks.schools.getSnapshot()).toHaveLength(2)
      expect(env.injected.hooks.schoolsError.getSnapshot()).toBeNull()
      expect(env.injected.hooks.schoolsLoading.getSnapshot()).toBe(false)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("installs the matching provider plugin on online selection and verifies registration", async () => {
    const env = createOnboardingEnv({
      index: marketIndex([
        providerPlugin("zmu.provider", ZMU_NAME),
        providerPlugin("ghost.provider", "Ghost University"),
      ]),
      registerOnlineProviders: ["zmu.provider"],
    })
    activeUnmount = env.cleanup

    await vi.waitFor(() =>
      expect(env.injected.hooks.schools.getSnapshot()).toHaveLength(3)
    )
    const schools = env.injected.hooks.schools.getSnapshot()
    const zmu = schools.find((school) => school.id === "zmu")!
    const ghost = schools.find((school) => school.id === "ghost")!
    const ysu = schools.find((school) => school.id === "ysu")!

    await env.injected.activateSchoolChoice(zmu)

    expect(env.applyPluginBundle).toHaveBeenCalledTimes(1)
    expect(env.applyPluginBundle.mock.calls[0]?.[0]).toEqual(["zmu.provider"])
    expect(env.runtime.context.get("provider")?.getSnapshot().schoolId).toBe("zmu")

    await expect(env.injected.activateSchoolChoice(ghost)).rejects.toThrow(
      "School provider is not registered: ghost"
    )

    await env.injected.activateSchoolChoice(ysu)
    expect(env.applyPluginBundle).toHaveBeenCalledTimes(2)
    expect(env.runtime.context.get("provider")?.getSnapshot().schoolId).toBe("ysu")
  })

  it("ignores market discovery results that arrive after the plugin scope is disposed", async () => {
    const marketDeferred = Promise.withResolvers<Response>()
    const env = createOnboardingEnv({ fetch: () => marketDeferred.promise })
    activeUnmount = env.cleanup

    expect(env.injected.hooks.schoolsLoading.getSnapshot()).toBe(true)

    env.disposeRuntime()
    marketDeferred.resolve(
      jsonResponse(marketIndex([providerPlugin("zmu.provider", ZMU_NAME)]))
    )
    const tick = Promise.withResolvers<void>()
    setTimeout(tick.resolve, 0)
    await tick.promise

    expect(env.injected.hooks.schools.getSnapshot()).toEqual([YSU_SCHOOL])
    expect(env.injected.hooks.schoolsError.getSnapshot()).toBeNull()
    expect(env.injected.hooks.schoolsLoading.getSnapshot()).toBe(true)
  })

  it("completes builtin YSU onboarding, requests native permissions, and persists completion", async () => {
    const env = createOnboardingEnv({})
    activeUnmount = env.cleanup

    await vi.waitFor(() =>
      expect(env.injected.hooks.schoolsLoading.getSnapshot()).toBe(false)
    )
    await vi.waitFor(() => expect(env.storeInstance.hydrated.getSnapshot()).toBe(true))
    await vi.waitFor(() =>
      expect(env.runtime.context.get("session")?.getSnapshot().hasHydrated).toBe(true)
    )

    const i18n = env.runtime.context.get("i18n") as PluginI18nRegistryService
    await env.dom.render(<ContributionOutlet entry={env.entry} slots={env.slots} i18n={i18n} />)
    expect(env.dom.container.textContent).toContain("初次设置")
    expect(env.dom.container.textContent).toContain("选择学校")

    await env.injected.activateSchoolChoice(YSU_SCHOOL)
    expect(env.runtime.context.get("provider")?.getSnapshot().schoolId).toBe("ysu")
    expect(env.applyPluginBundle).not.toHaveBeenCalled()

    await act(async () => {
      env.storeInstance.actions.selectSchool("ysu")
    })

    await expect(env.injected.requestNotificationPermission()).resolves.toBe(true)
    await expect(env.injected.requestExactAlarmPermission()).resolves.toBe(true)
    await expect(env.injected.requestBatteryOptimizationExemption()).resolves.toBe(true)

    await act(async () => {
      env.storeInstance.actions.complete()
    })
    expect(env.dom.container.textContent).toBe("")

    await vi.waitFor(async () => {
      const persisted = await env.localBackend.getItem(
        formatPluginStorageKey(ONBOARDING_PLUGIN_ID, "onboarding")
      )
      expect(persisted).toContain('"completed":true')
    })
  })
})
