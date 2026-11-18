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
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
  type PluginManifest,
  type PluginPackageRuntime,
} from "@orahako/sdk"
import { ONBOARDING_PLUGIN_ID, onboardingPlugin } from "../src"

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

  findButtons(): MiniDomNode[] {
    const result: MiniDomNode[] = []
    if (this.tagName === "BUTTON") result.push(this)
    for (const child of this.childNodes) {
      result.push(...child.findButtons())
    }
    return result
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

describe("@orahako/plugin-onboarding", () => {
  it("installs market bundle on online school choice, requests native permissions, and persists completed in scoped storage.local", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

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

    const mockMarketIndex: MarketplaceIndex = {
      schemaVersion: 1,
      updatedAt: "2026-11-18T00:00:00Z",
      plugins: [],
      bundles: [
        {
          id: "bundle.zmu",
          name: "ZMU Recommended",
          schoolId: "zmu",
          pluginIds: ["zmu.provider", "zmu.extra"],
        },
      ],
    }

    const applyPluginBundle = vi.fn(
      async (pluginIds: readonly string[]): Promise<PluginManifest> => {
        if (pluginIds.includes("zmu.provider")) {
          runtime.context.get("providers")?.registerProvider("zmu", () =>
            defineSchoolProvider({
              id: "zmu",
              name: "遵义医科大学",
              slices: {},
              async initialize() {},
              async reset() {},
              async logout() {},
              async relogin() {
                return false
              },
            })
          )
        }
        return {
          id: pluginIds[0]!,
          name: "ZMU Provider",
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

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockMarketIndex), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    )

    runtime.register(onboardingPlugin, "builtin", {
      marketUrl: "https://market.example/plugins.json",
      schools: [
        { id: "ysu", name: "燕山大学", nameEn: "Yanshan University", builtin: true },
        {
          id: "zmu",
          name: "遵义医科大学",
          nameEn: "Zunyi Medical University",
          bundleId: "bundle.zmu",
        },
      ],
    })
    runtime.start(ONBOARDING_PLUGIN_ID)

    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService

    // Deferred until shell.overlay is declared
    expect(slots.select("shell.overlay")).toEqual([])
    const disposeOverlay = slots.declare({ name: "shell.overlay", kind: "list" })
    expect(slots.select("shell.overlay")).toHaveLength(1)

    await vi.waitFor(() =>
      expect(runtime.context.get("session")?.getSnapshot().hasHydrated).toBe(true)
    )

    const entry = slots.select("shell.overlay")[0]!
    const storeInstance = entry.store as {
      hydrated: { getSnapshot(): boolean }
      source: { getSnapshot(): { completed: boolean; selectedSchoolId: string | null } }
      actions: { complete(): void; selectSchool(id: string): void }
    }
    await vi.waitFor(() => expect(storeInstance.hydrated.getSnapshot()).toBe(true))

    await dom.render(<ContributionOutlet entry={entry} slots={slots} i18n={i18n} />)
    expect(dom.container.textContent).toContain("初次设置")
    expect(dom.container.textContent).toContain("选择学校")
    expect(dom.container.textContent).toContain("在线插件")

    // Test activateSchoolChoice via injected prop (simulating ZMU selection & Continue)
    const injected = entry.inject!(runtime.context) as {
      activateSchoolChoice: (s: {
        id: string
        name: string
        bundleId?: string
        builtin?: boolean
      }) => Promise<void>
      requestNotificationPermission: () => Promise<boolean>
      requestExactAlarmPermission: () => Promise<boolean>
      requestBatteryOptimizationExemption: () => Promise<boolean>
    }

    await act(async () => {
      await injected.activateSchoolChoice({
        id: "zmu",
        name: "遵义医科大学",
        bundleId: "bundle.zmu",
      })
      storeInstance.actions.selectSchool("zmu")
    })

    expect(applyPluginBundle).toHaveBeenCalledWith(["zmu.provider", "zmu.extra"], mockMarketIndex)
    expect(runtime.context.get("provider")?.getSnapshot().schoolId).toBe("zmu")

    await expect(injected.requestNotificationPermission()).resolves.toBe(true)
    await expect(injected.requestExactAlarmPermission()).resolves.toBe(true)
    await expect(injected.requestBatteryOptimizationExemption()).resolves.toBe(true)

    await act(async () => {
      storeInstance.actions.complete()
    })

    expect(dom.container.textContent).toBe("")
    await vi.waitFor(async () => {
      const persisted = await localBackend.getItem(
        formatPluginStorageKey(ONBOARDING_PLUGIN_ID, "onboarding")
      )
      expect(persisted).toContain('"completed":true')
    })

    expect(fetchSpy).toHaveBeenCalled()
    fetchSpy.mockRestore()
    disposeOverlay()
    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
