import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
  if (!Reflect.get(globalThis, "window")) {
    Reflect.set(globalThis, "window", {})
  }
  if (!Reflect.get(globalThis, "document")) {
    const stubHead = { appendChild() {} }
    Reflect.set(globalThis, "document", {
      head: stubHead,
      getElementsByTagName: () => [stubHead],
      createElement: () => ({ appendChild() {}, setAttribute() {}, style: {} }),
      createTextNode: () => ({}),
    })
  }
})

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}))

import {
  DEFAULT_TTL_MS,
  ONE_HOUR_TTL_MS,
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
  SIX_HOUR_TTL_MS,
} from "@orahako/academic-runtime"
import { defineSchoolProvider, type SchoolProvider } from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { StatelessHttpService } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import {
  ContributionOutlet,
  slotRegistryPlugin,
  type PluginSlotRegistry,
} from "@orahako/runtime-slots"
import { NamespacedStorageService } from "@orahako/runtime-storage"
import { uiRegistryPlugin } from "@orahako/runtime-ui"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import * as laborEntry from "../src"
import { LABOR_PLUGIN_ID, laborPlugin, type LaborUiStoreInstance } from "../src"

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
  readonly style: Record<string, unknown> = {
    setProperty(name: string, value: string) {
      ;(this as Record<string, unknown>)[name] = value
    },
    removeProperty(name: string) {
      delete (this as Record<string, unknown>)[name]
    },
  }
  readonly attributes = new Map<string, string>()
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

  addEventListener(): void {}
  removeEventListener(): void {}

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
  const prevGetComputedStyle = globalThis.getComputedStyle
  const prevRaf = globalThis.requestAnimationFrame
  const prevCaf = globalThis.cancelAnimationFrame

  const getComputedStyleStub = () => ({ animationName: "none" })
  const rafStub = (cb: (time: number) => void) => Number(setTimeout(() => cb(Date.now()), 0))
  const cafStub = (id: number) => clearTimeout(id)

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    location: { pathname: "/", search: "", reload: vi.fn() },
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    getComputedStyle: getComputedStyleStub,
    requestAnimationFrame: rafStub,
    cancelAnimationFrame: cafStub,
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  }
  const doc = new MiniDomNode(9, "#document")
  doc.defaultView = fakeWin
  const docWithFactories = Object.assign(doc, {
    querySelector: () => null,
    querySelectorAll: () => [],
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

  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true)
  Reflect.set(globalThis, "window", fakeWin)
  Reflect.set(globalThis, "document", docWithFactories)
  Reflect.set(globalThis, "getComputedStyle", getComputedStyleStub)
  Reflect.set(globalThis, "requestAnimationFrame", rafStub)
  Reflect.set(globalThis, "cancelAnimationFrame", cafStub)

  const container = docWithFactories.createElement("div")
  const root = createRoot(container as never)

  return {
    container,
    async render(node: ReactNode) {
      await act(async () => {
        root.render(node)
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", prevAct)
      Reflect.set(globalThis, "window", prevWindow)
      Reflect.set(globalThis, "document", prevDocument)
      Reflect.set(globalThis, "getComputedStyle", prevGetComputedStyle)
      Reflect.set(globalThis, "requestAnimationFrame", prevRaf)
      Reflect.set(globalThis, "cancelAnimationFrame", prevCaf)
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

describe("@orahako/plugin-labor", () => {
  it("enforces strict export discipline on src/index.ts", () => {
    expect(Object.keys(laborEntry).sort()).toEqual(["LABOR_PLUGIN_ID", "default", "laborPlugin"])
    expect(laborEntry.default).toBe(laborPlugin)
    expect(laborPlugin.manifest.id).toBe("orahako.labor")
  })

  it("queries labor summary, records, and enrollable activities on tab switch with bilingual i18n", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const getLaborSummary = vi.fn().mockResolvedValue({
      studentId: "20250001",
      name: "李华",
      totalHours: 32,
      totalCredits: 2,
    })
    const getLaborRecords = vi.fn().mockResolvedValue([
      {
        term: "2026-2027-1",
        name: "校园秋叶清扫志愿劳动",
        enrollType: "集体报名",
        category: "服务性劳动",
        teacher: "王老师",
        hours: 4,
        status: "已认定",
        timeStart: "2026-10-12 14:00",
        timeEnd: "2026-10-12 18:00",
      },
    ])
    const getLaborActivities = vi.fn().mockResolvedValue([
      {
        name: "图书馆整理实践",
        category: "公益劳动",
        department: "图书馆",
        location: "西区图书馆三楼",
        hours: 2,
        isEnrolled: true,
        timeStart: "2026-11-20 09:00",
        timeEnd: "2026-11-20 11:00",
        enrollStart: "2026-11-15 08:00",
        enrollEnd: "2026-11-19 20:00",
      },
    ])

    const school: SchoolProvider = defineSchoolProvider({
      id: "labor-school",
      name: "劳动大学",
      slices: {
        labor: {
          getLaborSummary,
          getLaborRecords,
          getLaborActivities,
        },
      },
      async initialize() {},
      async reset() {},
      async logout() {},
      async dispose() {},
      async relogin() {
        return true
      },
    })

    const providerPlugin = definePlugin({
      manifest: {
        id: "test.school",
        name: "School",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["providers"],
      },
      inject: ["providers"] as const,
      apply(ctx) {
        ctx.providers.registerProvider("labor-school", () => school)
      },
    })

    const runtime = new PluginRuntime()
    runtime.context.set(
      "storage",
      new NamespacedStorageService({
        local: createMemoryStorage(),
        secure: createMemoryStorage(),
      })
    )
    runtime.context.set("http", new StatelessHttpService())

    for (const plugin of [
      slotRegistryPlugin,
      uiRegistryPlugin,
      i18nRegistryPlugin,
      providerRegistryRuntimePlugin,
      sessionRuntimePlugin,
      providerRuntimePlugin,
      queryRuntimePlugin,
      providerPlugin,
      laborPlugin,
    ]) {
      if (plugin.manifest.id === queryRuntimePlugin.manifest.id) {
        runtime.register(plugin, "builtin", { policies: {} })
      } else if (
        plugin.manifest.id === sessionRuntimePlugin.manifest.id ||
        plugin.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(plugin, "builtin", { defaultSchoolId: "labor-school" })
      } else {
        runtime.register(plugin, "builtin")
      }
      runtime.start(plugin.manifest.id)
    }

    const rootQuery = runtime.context.get("query")!
    expect(rootQuery.policy("labor-summary")).toEqual({ ttl: SIX_HOUR_TTL_MS, persist: true })
    expect(rootQuery.policy("labor-records")).toEqual({ ttl: SIX_HOUR_TTL_MS, persist: true })
    expect(rootQuery.policy("labor-activities")).toEqual({ ttl: ONE_HOUR_TTL_MS, persist: true })

    const ui = runtime.context.get("ui")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!

    const laborPage = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === LABOR_PLUGIN_ID && p.id === "index")!
    expect(laborPage.route).toBe("labor")
    expect(laborPage.capability).toBe("labor")

    const laborNav = ui
      .getSnapshot()
      .navigation.find((n) => n.pluginId === LABOR_PLUGIN_ID && n.id === "labor")!
    expect(laborNav).toMatchObject({
      id: "labor",
      page: "index",
      group: "platform",
      capability: "labor",
    })

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    await act(async () => {
      session.setCredential({
        schoolId: "labor-school",
        credential: "ticket-labor",
        username: "20250001",
      })
      await providerRuntime.initialize()
    })

    await dom.render(<ContributionOutlet entry={laborPage} slots={slots} i18n={i18n} />)

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("32")
      expect(dom.container.textContent).toContain("校园秋叶清扫志愿劳动")
      expect(dom.container.textContent).toContain("王老师")
      expect(dom.container.textContent).toContain("已认定")
    })

    // Activities tab has not been opened yet -> lazy query!
    expect(getLaborActivities).not.toHaveBeenCalled()

    // Switch tab to "activities" via page store
    const pageStore = laborPage.store as LaborUiStoreInstance
    await act(async () => {
      pageStore.actions.setTab("activities")
    })

    await vi.waitFor(() => {
      expect(getLaborActivities).toHaveBeenCalledTimes(1)
      expect(dom.container.textContent).toContain("图书馆整理实践")
      expect(dom.container.textContent).toContain("西区图书馆三楼")
      expect(dom.container.textContent).toContain("已报名")
    })

    // Switch locale to English
    await act(async () => {
      i18n.setLocale("en")
    })
    expect(dom.container.textContent).toContain("Total hours")
    expect(dom.container.textContent).toContain("Enrolled")

    await act(async () => {
      runtime.stop(LABOR_PLUGIN_ID)
    })
    expect(ui.getSnapshot().pages.some((p) => p.pluginId === LABOR_PLUGIN_ID)).toBe(false)
    expect(rootQuery.policy("labor-summary")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    expect(rootQuery.policy("labor-records")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    expect(rootQuery.policy("labor-activities")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
