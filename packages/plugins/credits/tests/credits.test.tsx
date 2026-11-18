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
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
} from "@orahako/academic-runtime"
import {
  defineSchoolProvider,
  type CatalogQueryOptions,
  type CreditQueryOptions,
  type SchoolProvider,
} from "@orahako/academic-sdk"
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
import * as creditsEntry from "../src"
import { CREDITS_PLUGIN_ID, creditsPlugin, type CreditsUiStoreInstance } from "../src"

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
  const prevAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT")
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

describe("@orahako/plugin-credits", () => {
  it("enforces strict export discipline on src/index.ts", () => {
    expect(Object.keys(creditsEntry).sort()).toEqual([
      "CREDITS_PLUGIN_ID",
      "creditsPlugin",
      "default",
    ])
    expect(creditsEntry.default).toBe(creditsPlugin)
    expect(creditsPlugin.manifest.id).toBe("orahako.credits")
  })

  it("renders credit summary, batch-filtered & grouped records, declarations, and paginated/searchable competitions & activity catalogs", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const getCreditSummary = vi.fn().mockResolvedValue({
      studentId: "20250088",
      name: "陈思远",
      totalCredits: 6.5,
      grade: "优秀",
    })
    const getCreditBatches = vi.fn().mockResolvedValue([
      { batchId: "b-2026", name: "2026 秋季批次" },
      { batchId: "b-2025", name: "2025 春季批次" },
    ])
    const getCreditRecords = vi.fn(async (opts?: CreditQueryOptions) => {
      if (opts?.batchId === "b-2025") {
        return [
          {
            itemName: "大学生数学建模竞赛省一等奖",
            year: "2025",
            categoryMajor: "学科竞赛",
            actualScore: 3,
            grade: "A",
            batch: "2025 春季批次",
            status: "已认定",
          },
        ]
      }
      return [
        {
          itemName: "程序设计天梯赛国二等奖",
          year: "2026",
          categoryMajor: "学科竞赛",
          categoryMinor: "国家级",
          actualScore: 3.5,
          grade: "A+",
          batch: "2026 秋季批次",
          status: "已认定",
        },
      ]
    })
    const getAllCreditRecords = vi.fn().mockResolvedValue([
      {
        itemName: "程序设计天梯赛国二等奖",
        actualScore: 3.5,
        batch: "2026 秋季批次",
      },
      {
        itemName: "大学生数学建模竞赛省一等奖",
        actualScore: 3,
        batch: "2025 春季批次",
      },
    ])
    const getCreditDeclarations = vi.fn().mockResolvedValue([
      {
        itemName: "挑战杯课外学术科技作品申报",
        categoryMajor: "双创实践",
        awardLevel: "校一等奖",
        score: 2,
        batch: "2026 秋季批次",
        status: "审核中",
      },
    ])
    const getCreditCompetitions = vi.fn(async (opts?: CatalogQueryOptions) => {
      if (opts?.keyword === "机器人") {
        return {
          items: [
            {
              code: "COMP-ROBOT",
              name: "全国大学生机器人大赛",
              categoryMajor: "A类竞赛",
              isEnabled: true,
            },
          ],
          pageIndex: 1,
          totalPages: 1,
          totalRecords: 1,
        }
      }
      if (opts?.pageIndex === 2) {
        return {
          items: [
            {
              code: "COMP-002",
              name: "蓝桥杯全国软件和信息技术专业人才大赛",
              categoryMajor: "B类竞赛",
              isEnabled: false,
            },
          ],
          pageIndex: 2,
          totalPages: 2,
          totalRecords: 2,
        }
      }
      return {
        items: [
          {
            code: "COMP-001",
            name: "ACM-ICPC 国际大学生程序设计竞赛",
            categoryMajor: "A类竞赛",
            isEnabled: true,
          },
        ],
        pageIndex: 1,
        totalPages: 2,
        totalRecords: 2,
      }
    })
    const getCreditLibraryActivities = vi.fn(async (opts?: CatalogQueryOptions) => ({
      items: [
        {
          name: opts?.keyword ? `讲座：${opts.keyword}` : "人工智能前沿创新讲坛",
          organizer: "信息科学与工程学院",
          category: "学术讲座",
        },
      ],
      pageIndex: opts?.pageIndex ?? 1,
      totalPages: 1,
      totalRecords: 1,
    }))

    const school: SchoolProvider = defineSchoolProvider({
      id: "credits-school",
      name: "双创大学",
      slices: {
        credits: {
          getCreditSummary,
          getCreditBatches,
          getCreditRecords,
          getAllCreditRecords,
          getCreditDeclarations,
          getCreditCompetitions,
          getCreditLibraryActivities,
        },
      },
      async initialize() {},
      async reset() {},
      async logout() {},
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
        ctx.providers.registerProvider("credits-school", () => school)
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
      creditsPlugin,
    ]) {
      if (
        plugin.manifest.id === sessionRuntimePlugin.manifest.id ||
        plugin.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(plugin, "builtin", { defaultSchoolId: "credits-school" })
      } else {
        runtime.register(plugin, "builtin")
      }
      runtime.start(plugin.manifest.id)
    }

    const ui = runtime.context.get("ui")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!

    const creditsPage = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === CREDITS_PLUGIN_ID && p.id === "index")!
    expect(creditsPage.route).toBe("credits")
    expect(creditsPage.capability).toBe("credits")

    const creditsNav = ui
      .getSnapshot()
      .navigation.find((n) => n.pluginId === CREDITS_PLUGIN_ID && n.id === "credits")!
    expect(creditsNav).toMatchObject({
      id: "credits",
      page: "index",
      group: "platform",
      capability: "credits",
    })

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    await act(async () => {
      session.setCredential({
        schoolId: "credits-school",
        credential: "ticket-credits",
        username: "20250088",
      })
      await providerRuntime.initialize()
    })

    await dom.render(<ContributionOutlet entry={creditsPage} slots={slots} i18n={i18n} />)

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("6.5")
      expect(dom.container.textContent).toContain("优秀")
      expect(dom.container.textContent).toContain("程序设计天梯赛国二等奖")
      expect(dom.container.textContent).toContain("2026 秋季批次")
    })

    const uiStore = creditsPage.store as CreditsUiStoreInstance

    // Filter records by specific batch b-2025
    await act(async () => {
      uiStore.actions.setBatch("b-2025")
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("大学生数学建模竞赛省一等奖")
    })

    // Filter records by "all" -> invokes getAllCreditRecords and groups by batch
    await act(async () => {
      uiStore.actions.setBatch("all")
    })
    await vi.waitFor(() => {
      expect(getAllCreditRecords).toHaveBeenCalledTimes(1)
      expect(dom.container.textContent).toContain("程序设计天梯赛国二等奖")
      expect(dom.container.textContent).toContain("2025 春季批次")
    })

    // Switch to declarations tab
    await act(async () => {
      uiStore.actions.setTab("declarations")
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("挑战杯课外学术科技作品申报")
      expect(dom.container.textContent).toContain("审核中")
    })

    // Switch to competitions tab: page 1 -> page 2 -> keyword search
    await act(async () => {
      uiStore.actions.setTab("competitions")
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("ACM-ICPC 国际大学生程序设计竞赛")
      expect(dom.container.textContent).toContain("第 1 / 2 页")
    })

    await act(async () => {
      uiStore.actions.setCompetitionsPage(2)
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("蓝桥杯全国软件和信息技术专业人才大赛")
      expect(dom.container.textContent).toContain("未启用")
      expect(dom.container.textContent).toContain("第 2 / 2 页")
    })

    await act(async () => {
      uiStore.actions.setCompetitionsKeywordDraft(" 机器人 ")
      uiStore.actions.searchCompetitions()
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("全国大学生机器人大赛")
    })

    // Switch to activities tab + search
    await act(async () => {
      uiStore.actions.setTab("activities")
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("人工智能前沿创新讲坛")
    })

    await act(async () => {
      uiStore.actions.setActivitiesKeywordDraft("大模型")
      uiStore.actions.searchActivities()
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("讲座：大模型")
    })

    // English translation check
    await act(async () => {
      i18n.setLocale("en")
    })
    expect(dom.container.textContent).toContain("Total credits")
    expect(dom.container.textContent).toContain("Search")

    await act(async () => {
      runtime.stop(CREDITS_PLUGIN_ID)
    })
    expect(ui.getSnapshot().pages.some((p) => p.pluginId === CREDITS_PLUGIN_ID)).toBe(false)

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
