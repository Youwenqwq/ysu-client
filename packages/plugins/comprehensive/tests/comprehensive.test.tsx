import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_TTL_MS,
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
  SIX_HOUR_TTL_MS,
} from "@orahako/academic-runtime"
import {
  defineSchoolProvider,
  type ComprehensiveIndicatorDetail,
  type ComprehensiveQueryOptions,
  type ComprehensiveRadarItem,
  type ComprehensiveReportPage,
  type ComprehensiveReportYears,
  type ComprehensiveResult,
  type ComprehensiveTerm,
  type ComprehensiveYearScore,
  type SchoolProvider,
} from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { StatelessHttpService } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { navigationRuntimePlugin, routerRuntimePlugin } from "@orahako/runtime-router"
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
import * as comprehensiveExports from "../src"
import { COMPREHENSIVE_PLUGIN_ID, comprehensivePlugin, type ComprehensivePageInject } from "../src"
import { computeRadarPercent, formatTermLabel, formatTermValue } from "../src/sources"

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
      this[name] = value
    },
    removeProperty(name: string) {
      delete this[name]
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
  focus(): void {}

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

function findNode(
  root: MiniDomNode,
  predicate: (node: MiniDomNode) => boolean
): MiniDomNode | null {
  if (predicate(root)) return root
  for (const child of root.childNodes) {
    const found = findNode(child, predicate)
    if (found) return found
  }
  return null
}

function getReactProps(node: MiniDomNode): Record<string, unknown> | null {
  const record = Object(node) as Record<string, unknown>
  const key = Object.keys(record).find((k) => k.startsWith("__reactProps$"))
  if (!key) return null
  const val = record[key]
  return typeof val === "object" && val !== null ? (val as Record<string, unknown>) : null
}

function mountMiniDom() {
  const globalRecord: Record<string, unknown> = globalThis
  const prevWindow = globalRecord.window
  const prevDocument = globalRecord.document
  const prevAct = globalRecord.IS_REACT_ACT_ENVIRONMENT
  const prevRaf = globalRecord.requestAnimationFrame
  const prevCaf = globalRecord.cancelAnimationFrame
  const prevGetComputedStyle = globalRecord.getComputedStyle
  const prevHTMLElement = globalRecord.HTMLElement

  const raf = (cb: (time: number) => void): ReturnType<typeof setTimeout> =>
    setTimeout(() => cb(Date.now()), 0)
  const caf = (id: ReturnType<typeof setTimeout>): void => {
    clearTimeout(id)
  }
  const fakeComputedStyle = () => ({ animationName: "none", getPropertyValue: () => "" })

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    HTMLElement: MiniDomNode,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    getComputedStyle: fakeComputedStyle,
    addEventListener: () => {},
    removeEventListener: () => {},
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
    location: { pathname: "/", search: "", reload: vi.fn() },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  }
  const doc = new MiniDomNode(9, "#document")
  doc.defaultView = fakeWin
  const docWithFactories = Object.assign(doc, {
    body: new MiniDomNode(1, "BODY"),
    documentElement: new MiniDomNode(1, "HTML"),
    querySelector() {
      return null
    },
    querySelectorAll() {
      return []
    },
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

  globalRecord.IS_REACT_ACT_ENVIRONMENT = true
  globalRecord.window = fakeWin
  globalRecord.document = docWithFactories
  globalRecord.requestAnimationFrame = raf
  globalRecord.cancelAnimationFrame = caf
  globalRecord.getComputedStyle = fakeComputedStyle
  globalRecord.HTMLElement = MiniDomNode

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
      globalRecord.IS_REACT_ACT_ENVIRONMENT = prevAct
      globalRecord.window = prevWindow
      globalRecord.document = prevDocument
      globalRecord.requestAnimationFrame = prevRaf
      globalRecord.cancelAnimationFrame = prevCaf
      globalRecord.getComputedStyle = prevGetComputedStyle
      globalRecord.HTMLElement = prevHTMLElement
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

describe("@orahako/plugin-comprehensive", () => {
  it("enforces strict export discipline on src/index.ts and pure formatting helpers", () => {
    expect(Object.keys(comprehensiveExports).sort()).toEqual([
      "COMPREHENSIVE_PLUGIN_ID",
      "comprehensivePlugin",
      "default",
    ])
    expect(comprehensiveExports.default).toBe(comprehensivePlugin)
    expect(COMPREHENSIVE_PLUGIN_ID).toBe("orahako.comprehensive")

    expect(formatTermValue({ year: "2025-2026", term: "1" })).toBe("2025-2026-1")
    expect(
      formatTermLabel({
        year: "2025-2026",
        term: "1",
        yearDisplay: "2025-2026学年",
        termDisplay: "第一学期",
      })
    ).toBe("2025-2026学年 第一学期")
    expect(computeRadarPercent(85, 100)).toBe(85)
    expect(computeRadarPercent(120, 100)).toBe(100)
    expect(computeRadarPercent(50, 0)).toBe(0)
  })

  it("registers page & platform navigation, binds comprehensive slice sources across terms/radar/years/report, and cleans up on stop", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const resultCalls: string[] = []
    const radarCalls: string[] = []
    const reportCalls: string[] = []

    const schoolProvider: SchoolProvider = defineSchoolProvider({
      id: "demo-school",
      name: "示例大学",
      slices: {
        comprehensive: {
          getComprehensiveTerms: async (): Promise<ComprehensiveTerm[]> => [
            {
              year: "2025-2026",
              term: "1",
              yearDisplay: "2025-2026学年",
              termDisplay: "第一学期",
            },
            {
              year: "2024-2025",
              term: "2",
              yearDisplay: "2024-2025学年",
              termDisplay: "第二学期",
            },
          ],
          getComprehensiveResult: async (
            opts?: ComprehensiveQueryOptions
          ): Promise<ComprehensiveResult> => {
            const key = `${opts?.year ?? ""}-${opts?.term ?? ""}`
            resultCalls.push(key)
            if (key === "2024-2025-2") {
              return {
                totalScore: "88.5",
                classRank: 5,
                classSize: 32,
                gradeRank: 18,
                gradeSize: 160,
                year: "2024-2025",
                term: "2",
                indicators: [{ name: "学业表现", score: "72.0", rank: 6 }],
              }
            }
            return {
              totalScore: "93.2",
              classRank: 2,
              classSize: 32,
              gradeRank: 7,
              gradeSize: 160,
              year: "2025-2026",
              term: "1",
              indicators: [
                { name: "德育素质", score: "18.5", rank: 3, maxScore: "20" },
                { name: "智育素质", score: "64.7", rank: 2, maxScore: "70" },
              ],
            }
          },
          getComprehensiveIndicators: async (
            opts?: ComprehensiveQueryOptions
          ): Promise<ComprehensiveIndicatorDetail[]> => {
            if (opts?.year === "2024-2025") {
              return [
                {
                  name: "学业表现",
                  score: "72.0",
                  maxScore: "80",
                  proportion: "80%",
                },
              ]
            }
            return [
              {
                name: "德育素质",
                score: "18.5",
                maxScore: "20",
                proportion: "20%",
                categoryDisplay: "基础指标",
                description: "思想道德与集体荣誉加分",
              },
              {
                name: "智育素质",
                score: "64.7",
                maxScore: "70",
                proportion: "70%",
                categoryDisplay: "核心指标",
              },
            ]
          },
          getComprehensiveRadar: async (
            opts?: ComprehensiveQueryOptions
          ): Promise<ComprehensiveRadarItem[]> => {
            radarCalls.push(`${opts?.year ?? ""}-${opts?.term ?? ""}`)
            return [
              { name: "德育", personal: "18.5", average: "16.0", maxScore: "20" },
              { name: "智育", personal: "64.7", average: "58.2", maxScore: "70" },
            ]
          },
          getComprehensiveYearScores: async (): Promise<ComprehensiveYearScore[]> => [
            {
              year: "2025-2026",
              term: "1",
              yearDisplay: "2025-2026学年",
              termDisplay: "第一学期",
              score: "93.2",
            },
            {
              year: "2024-2025",
              term: "2",
              yearDisplay: "2024-2025学年",
              termDisplay: "第二学期",
              score: "88.5",
            },
          ],
          getComprehensiveReportYears: async (): Promise<ComprehensiveReportYears> => ({
            years: [
              { year: "2025-2026", yearDisplay: "2025-2026学年" },
              { year: "2024-2025", yearDisplay: "2024-2025学年" },
            ],
            defaultYear: "2025-2026",
          }),
          getComprehensiveReport: async (opts?: {
            year?: string
          }): Promise<ComprehensiveReportPage> => {
            reportCalls.push(opts?.year ?? "")
            return {
              entries:
                opts?.year === "2024-2025"
                  ? [{ courseName: "离散数学", score: "91", credit: "3.5" }]
                  : [{ courseName: "算法设计与分析", score: "95", credit: "4.0" }],
              totalSize: 1,
              pageNumber: 1,
              pageSize: 20,
            }
          },
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
        id: "test.provider",
        name: "Test Provider",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["providers"],
      },
      inject: ["providers"] as const,
      apply(ctx) {
        ctx.providers.registerProvider("demo-school", () => schoolProvider)
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
      routerRuntimePlugin,
      navigationRuntimePlugin,
      providerRegistryRuntimePlugin,
      sessionRuntimePlugin,
      providerRuntimePlugin,
      queryRuntimePlugin,
      providerPlugin,
      comprehensivePlugin,
    ]) {
      if (plugin.manifest.id === queryRuntimePlugin.manifest.id) {
        runtime.register(plugin, "builtin", { policies: {} })
      } else if (
        plugin.manifest.id === sessionRuntimePlugin.manifest.id ||
        plugin.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(plugin, "builtin", { defaultSchoolId: "demo-school" })
      } else {
        runtime.register(plugin, "builtin")
      }
      runtime.start(plugin.manifest.id)
    }

    const rootQuery = runtime.context.get("query")!
    expect(rootQuery.policy("comprehensive-terms")).toEqual({
      ttl: DEFAULT_TTL_MS,
      persist: true,
    })
    expect(rootQuery.policy("comprehensive-result")).toEqual({
      ttl: SIX_HOUR_TTL_MS,
      persist: true,
    })
    expect(rootQuery.policy("comprehensive-indicators")).toEqual({
      ttl: SIX_HOUR_TTL_MS,
      persist: true,
    })
    expect(rootQuery.policy("comprehensive-radar")).toEqual({
      ttl: SIX_HOUR_TTL_MS,
      persist: true,
    })
    expect(rootQuery.policy("comprehensive-year-scores")).toEqual({
      ttl: SIX_HOUR_TTL_MS,
      persist: true,
    })
    expect(rootQuery.policy("comprehensive-report-years")).toEqual({
      ttl: DEFAULT_TTL_MS,
      persist: true,
    })
    expect(rootQuery.policy("comprehensive-report")).toEqual({
      ttl: SIX_HOUR_TTL_MS,
      persist: true,
    })

    const ui = runtime.context.get("ui")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!

    const page = ui
      .getSnapshot()
      .pages.find((entry) => entry.pluginId === COMPREHENSIVE_PLUGIN_ID && entry.id === "index")!
    expect(page.route).toBe("comprehensive")
    expect(page.capability).toBe("comprehensive")

    const nav = ui
      .getSnapshot()
      .navigation.find(
        (entry) => entry.pluginId === COMPREHENSIVE_PLUGIN_ID && entry.id === "comprehensive"
      )!
    expect(nav.capability).toBe("comprehensive")
    expect("group" in nav ? nav.group : undefined).toBe("platform")

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({
      schoolId: "demo-school",
      credential: "ticket-comp",
      username: "20250707",
    })
    await providerRuntime.initialize()

    await dom.render(<ContributionOutlet entry={page} slots={slots} i18n={i18n} />)

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("93.2")
      expect(dom.container.textContent).toContain("德育素质")
      expect(dom.container.textContent).toContain("思想道德与集体荣誉加分")
      expect(dom.container.textContent).toContain("智育素质")
    })
    expect(resultCalls).toContain("2025-2026-1")

    // Switch term via injected selectTerm action -> re-queries result & indicators for 2024-2025-2
    const injected = page.inject!(runtime.context) as ComprehensivePageInject
    expect(
      Object.is(
        injected.hooks.selectedTerm.getSnapshot(),
        injected.hooks.selectedTerm.getSnapshot()
      )
    ).toBe(true)

    await act(async () => {
      injected.selectTerm({ year: "2024-2025", term: "2" })
    })

    await vi.waitFor(() => {
      expect(resultCalls).toContain("2024-2025-2")
      expect(dom.container.textContent).toContain("88.5")
      expect(dom.container.textContent).toContain("学业表现")
    })

    // Verify radar, yearScores, reportYears, and report sources bind & switch cleanly
    const unsubRadar = injected.hooks.radar.subscribe(() => {})
    const unsubYears = injected.hooks.yearScores.subscribe(() => {})
    const unsubReportYears = injected.hooks.reportYears.subscribe(() => {})
    const unsubReport = injected.hooks.report.subscribe(() => {})

    await vi.waitFor(() => {
      expect(radarCalls).toContain("2024-2025-2")
      expect(injected.hooks.radar.getSnapshot().data).toHaveLength(2)
      expect(injected.hooks.yearScores.getSnapshot().data).toHaveLength(2)
      expect(injected.hooks.report.getSnapshot().data?.entries[0]?.courseName).toBe(
        "算法设计与分析"
      )
    })
    expect(reportCalls).toContain("2025-2026")

    await act(async () => {
      injected.selectReportYear("2024-2025")
    })

    await vi.waitFor(() => {
      expect(reportCalls).toContain("2024-2025")
      expect(injected.hooks.report.getSnapshot().data?.entries[0]?.courseName).toBe("离散数学")
    })

    unsubRadar()
    unsubYears()
    unsubReportYears()
    unsubReport()

    // Switch Tabs in DOM (radar -> years -> report) to render RadarPanel, YearsPanel, and ReportPanel
    const triggerTab = async (tabId: string) => {
      const tabNode = findNode(
        dom.container,
        (node) => node.attributes.get("data-comprehensive-tab") === tabId
      )
      expect(tabNode).not.toBeNull()
      await act(async () => {
        const tabProps = getReactProps(tabNode!)
        const onClick = tabProps?.onClick
        if (typeof onClick === "function") {
          onClick({ defaultPrevented: false, button: 0, preventDefault: () => {} })
        }
      })
    }

    await triggerTab("radar")
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("18.5")
      expect(dom.container.textContent).toContain("16.0")
    })

    await triggerTab("years")
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("2025-2026学年 第一学期")
      expect(dom.container.textContent).toContain("93.2")
    })

    await triggerTab("report")
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("离散数学")
      expect(dom.container.textContent).toContain("3.5")
    })

    // Switch back to result tab and switch locale to English
    await triggerTab("result")
    await act(async () => {
      i18n.setLocale("en")
    })
    expect(dom.container.textContent).toContain("Total score")
    expect(dom.container.textContent).toContain("Indicator details")

    // Stop plugin -> page & navigation removed and sources disposed
    await act(async () => {
      runtime.stop(COMPREHENSIVE_PLUGIN_ID)
    })
    expect(ui.getSnapshot().pages.some((entry) => entry.pluginId === COMPREHENSIVE_PLUGIN_ID)).toBe(
      false
    )
    expect(
      ui.getSnapshot().navigation.some((entry) => entry.pluginId === COMPREHENSIVE_PLUGIN_ID)
    ).toBe(false)
    expect(injected.hooks.selectedTerm.getSnapshot()).toBeNull()
    expect(rootQuery.policy("comprehensive-terms")).toEqual({
      ttl: DEFAULT_TTL_MS,
      persist: false,
    })
    expect(rootQuery.policy("comprehensive-result")).toEqual({
      ttl: DEFAULT_TTL_MS,
      persist: false,
    })
    expect(rootQuery.policy("comprehensive-indicators")).toEqual({
      ttl: DEFAULT_TTL_MS,
      persist: false,
    })
    expect(rootQuery.policy("comprehensive-radar")).toEqual({
      ttl: DEFAULT_TTL_MS,
      persist: false,
    })
    expect(rootQuery.policy("comprehensive-year-scores")).toEqual({
      ttl: DEFAULT_TTL_MS,
      persist: false,
    })
    expect(rootQuery.policy("comprehensive-report-years")).toEqual({
      ttl: DEFAULT_TTL_MS,
      persist: false,
    })
    expect(rootQuery.policy("comprehensive-report")).toEqual({
      ttl: DEFAULT_TTL_MS,
      persist: false,
    })

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
