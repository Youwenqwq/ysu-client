import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_TTL_MS,
  LONG_TTL_MS,
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
  SHORT_TTL_MS,
} from "@orahako/academic-runtime"
import { defineSchoolProvider, type SchoolProvider } from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { StatelessHttpService } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { navigationRuntimePlugin, routerRuntimePlugin } from "@orahako/runtime-router"
import { settingsRegistryPlugin, type PluginSettingsRegistry } from "@orahako/runtime-settings"
import {
  ContributionOutlet,
  slotRegistryPlugin,
  type PluginSlotRegistry,
} from "@orahako/runtime-slots"
import { NamespacedStorageService } from "@orahako/runtime-storage"
import { uiRegistryPlugin } from "@orahako/runtime-ui"
import {
  defineDictionary,
  definePlugin,
  defineStore,
  PLUGIN_API_VERSION,
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import {
  OVERVIEW_PLUGIN_ID,
  OVERVIEW_PROFILE_WIDGET_ID,
  OVERVIEW_WEEK_SUMMARY_WIDGET_ID,
  overviewPlugin,
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

function findAllNodes(
  node: MiniDomNode,
  predicate: (candidate: MiniDomNode) => boolean
): MiniDomNode[] {
  return [
    ...(predicate(node) ? [node] : []),
    ...node.childNodes.flatMap((child) => findAllNodes(child, predicate)),
  ]
}

function mountMiniDom(mobile = false) {
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const prevAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    location: { pathname: "/", search: "", reload: vi.fn() },
    matchMedia: () => ({
      matches: mobile,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
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

describe("@orahako/plugin-overview ownership, single store instantiation & keyed slot rendering", () => {
  it("delegates registered widgets into overview.widget keyed slot, instantiates StoreDefinition once, filters by slice & supportedPlugins, and removes widgets on plugin stop", async () => {
    const dom = mountMiniDom(true)
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

    const fullProvider: SchoolProvider = defineSchoolProvider({
      id: "full-school",
      name: "全功能大学",
      slices: {
        studentProfile: {
          getStudentInfo: async () => ({
            name: "张明远",
            studentId: "20251234",
            department: "机械工程学院",
            major: "机械设计制造及其自动化",
          }),
        },
        timetable: {
          getSchedule: async () => [],
          getCurrentWeek: async () => ({
            week: 6,
            weekday: 3,
            semester: "2026-2027-1",
          }),
          getTermCalendar: async () => ({
            semester: "2026-2027-1",
            totalWeeks: 20,
            teachingWeeks: 18,
            isInUse: true,
          }),
        },
        ecard: {
          fetchBalance: async () => ({ ready: true, balance: null }),
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

    const restrictedProvider: SchoolProvider = defineSchoolProvider({
      id: "restricted-school",
      name: "受限大学",
      supportedPlugins: [OVERVIEW_PLUGIN_ID], // excludes feature.card-plugin
      slices: {
        timetable: {
          getSchedule: async () => [],
          getCurrentWeek: async () => ({
            week: 2,
            weekday: 1,
            semester: "2026-2027-1",
          }),
        },
      }, // no studentProfile or ecard slice!
      async initialize() {},
      async reset() {},
      async logout() {},
      async dispose() {},
      async relogin() {
        return true
      },
    })

    const schoolProvidersPlugin = definePlugin({
      manifest: {
        id: "test.schools",
        name: "Test Schools",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["providers"],
      },
      inject: ["providers"] as const,
      apply(ctx) {
        ctx.providers.registerProvider("full-school", () => fullProvider)
        ctx.providers.registerProvider("restricted-school", () => restrictedProvider)
      },
    })

    let storeInitCalls = 0
    const cardStore = defineStore({
      init: () => {
        storeInitCalls += 1
        return { balanceText: "¥88.50" }
      },
      persist: { key: "card-widget-cache" },
      actions: {
        setBalance(ctx, next: string) {
          ctx.set({ balanceText: next })
        },
      },
    })

    const cardDict = defineDictionary({
      zh: { title: "校园卡余额", desc: "实时卡余额" },
      en: { title: "Card Balance", desc: "Live balance" },
    })

    // Notice featureCardPlugin ONLY injects "overview" (not "slots") — testing scoped slot delegation!
    const featureCardPlugin = definePlugin({
      manifest: {
        id: "feature.card-plugin",
        name: "Card Feature",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["overview"],
      },
      inject: ["overview"] as const,
      apply(ctx) {
        ctx.overview.registerWidget(
          {
            id: "balance-card",
            titleKey: "title",
            descriptionKey: "desc",
            icon: () => null,
            region: "content",
            defaultVisible: true,
            order: 20,
            slice: "ecard",
            dictionary: cardDict,
            store: cardStore,
          },
          (props) => {
            const bal = props.useStore((s) => s.balanceText)
            return (
              <div>
                {props.t("title")}:{bal}
              </div>
            )
          }
        )
      },
    })

    const unsupportedSlicePlugin = definePlugin({
      manifest: {
        id: "feature.epay-plugin",
        name: "Epay Feature",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["overview"],
      },
      inject: ["overview"] as const,
      apply(ctx) {
        ctx.overview.registerWidget(
          {
            id: "unpaid-fees",
            title: "待缴费用",
            icon: () => null,
            region: "content",
            defaultVisible: true,
            order: 30,
            slice: "epay", // missing on fullProvider!
          },
          () => <div>ShouldBeFilteredBySlice</div>
        )
      },
    })

    for (const p of [
      slotRegistryPlugin,
      uiRegistryPlugin,
      settingsRegistryPlugin,
      i18nRegistryPlugin,
      routerRuntimePlugin,
      navigationRuntimePlugin,
      providerRegistryRuntimePlugin,
      sessionRuntimePlugin,
      providerRuntimePlugin,
      queryRuntimePlugin,
      schoolProvidersPlugin,
      overviewPlugin,
      featureCardPlugin,
      unsupportedSlicePlugin,
    ]) {
      if (p.manifest.id === queryRuntimePlugin.manifest.id) {
        runtime.register(p, "builtin", { policies: {} })
      } else if (
        p.manifest.id === sessionRuntimePlugin.manifest.id ||
        p.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(p, "builtin", { defaultSchoolId: "full-school" })
      } else {
        runtime.register(p, "builtin")
      }
      runtime.start(p.manifest.id)
    }

    const rootQuery = runtime.context.get("query")!
    expect(rootQuery.policy("student-info")).toEqual({ ttl: LONG_TTL_MS, persist: true })
    expect(rootQuery.policy("current-week")).toEqual({ ttl: SHORT_TTL_MS, persist: true })
    expect(rootQuery.policy("term-calendar")).toEqual({ ttl: LONG_TTL_MS, persist: true })

    const overviewService = runtime.context.get("overview")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const ui = runtime.context.get("ui")!
    const settings = runtime.context.get("settings") as PluginSettingsRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!

    slots.declare({ name: "settings.startupOptions", kind: "list" })

    // StoreDefinition was instantiated ONCE (not duplicated when overview.widget slot was declared)
    expect(storeInitCalls).toBe(1)

    expect(overviewService.getSnapshot().map((w) => [w.id, w.pluginId])).toEqual([
      [OVERVIEW_PROFILE_WIDGET_ID, OVERVIEW_PLUGIN_ID],
      [OVERVIEW_WEEK_SUMMARY_WIDGET_ID, OVERVIEW_PLUGIN_ID],
      ["balance-card", "feature.card-plugin"],
      ["unpaid-fees", "feature.epay-plugin"],
    ])

    // Keyed slot contributions exist under "${pluginId}:${widgetId}" with true plugin ownership!
    expect(slots.select("overview.widget", "feature.card-plugin:balance-card")).toEqual([
      expect.objectContaining({
        pluginId: "feature.card-plugin",
        key: "feature.card-plugin:balance-card",
      }),
    ])
    expect(slots.select("settings.startupOptions")).toHaveLength(1)

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({
      schoolId: "full-school",
      credential: "ticket",
      username: "20251234",
    })
    await providerRuntime.initialize()

    const overviewPage = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === OVERVIEW_PLUGIN_ID && p.id === "index")!
    expect(overviewPage.route).toBe("overview")
    expect(overviewPage.primary).toBe(true)
    expect(overviewPage.requiresProvider).toBe(true)

    await dom.render(<ContributionOutlet entry={overviewPage} slots={slots} i18n={i18n} />)

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("张明远")
      expect(dom.container.textContent).toContain("第 6 周")
      expect(dom.container.textContent).toContain("校园卡余额:¥88.50")
    })
    const profileCard = findAllNodes(dom.container, (node) =>
      node.attributes.has("data-overview-profile-card")
    )[0]
    const inlineSummary = findAllNodes(dom.container, (node) =>
      node.attributes.has("data-overview-inline")
    )[0]
    let inlineParent = inlineSummary?.parentNode
    while (inlineParent && inlineParent !== profileCard) inlineParent = inlineParent.parentNode
    expect(inlineParent).toBe(profileCard)
    expect(dom.container.textContent).toContain("周次")
    expect(dom.container.textContent).not.toContain("学期信息")
    // Widget requiring missing "epay" slice is NOT rendered
    expect(dom.container.textContent).not.toContain("ShouldBeFilteredBySlice")

    // Switch to restrictedProvider -> filters out profile (no studentProfile slice) and feature.card-plugin (unsupported plugin)
    await act(async () => {
      session.setCredential({
        schoolId: "restricted-school",
        credential: "ticket-2",
        username: "20259999",
      })
      providerRuntime.selectSchool("restricted-school")
      await providerRuntime.initialize()
    })

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("第 2 周")
      expect(dom.container.textContent).not.toContain("校园卡余额")
      expect(dom.container.textContent).not.toContain("张明远")
    })

    // Layout editor category renders cleanly with localized widget metadata
    const editorCategory = settings.getSnapshot().find((c) => c.id === "overview")!
    expect(editorCategory).toBeDefined()
    const editorHtml = renderToStaticMarkup(
      <ContributionOutlet entry={editorCategory} slots={slots} i18n={i18n} />
    )
    expect(editorHtml).toContain("保存")
    expect(editorHtml).toContain("个人信息")

    // Stopping feature.card-plugin removes its widget from both OverviewService AND overview.widget slot without touching built-ins!
    await act(async () => {
      runtime.stop("feature.card-plugin")
    })
    expect(slots.select("overview.widget", "feature.card-plugin:balance-card")).toEqual([])
    expect(overviewService.getSnapshot().map((w) => w.id)).toEqual([
      OVERVIEW_PROFILE_WIDGET_ID,
      OVERVIEW_WEEK_SUMMARY_WIDGET_ID,
      "unpaid-fees",
    ])
    expect(storeInitCalls).toBe(1)

    activeUnmount = undefined
    await dom.unmount()
    runtime.stop(OVERVIEW_PLUGIN_ID)
    expect(rootQuery.policy("student-info")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    expect(rootQuery.policy("current-week")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    expect(rootQuery.policy("term-calendar")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    runtime.dispose()
  })
})
