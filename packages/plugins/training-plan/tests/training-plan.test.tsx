import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_TTL_MS,
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
} from "@orahako/academic-runtime"
import {
  defineSchoolProvider,
  type AcademicCompletion,
  type AcademicWarning,
  type SchoolProvider,
  type TrainingPlan,
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
import * as trainingPlanExports from "../src"
import { TRAINING_PLAN_PLUGIN_ID, trainingPlanPlugin } from "../src"
import {
  computeCompletionPercentage,
  FILTER_ALL,
  FILTER_REQUIRED_NO,
  FILTER_REQUIRED_YES,
  filterActiveWarnings,
  filterTrainingPlanCourses,
} from "../src/page"

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
  value = ""
  selected = false
  defaultSelected = false
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

  get options(): MiniDomNode[] {
    return this.childNodes.filter((child) => child.tagName === "OPTION")
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
  closest(): MiniDomNode | null {
    return null
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
  const prevSelect = globalRecord.HTMLSelectElement
  const prevForm = globalRecord.HTMLFormElement

  class FakeHTMLSelectElement {
    private current = ""
    get value(): string {
      return this.current
    }
    set value(next: string) {
      this.current = next
    }
  }
  class FakeHTMLFormElement {}

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    HTMLSelectElement: FakeHTMLSelectElement,
    HTMLFormElement: FakeHTMLFormElement,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    getComputedStyle: () => ({ animationName: "none", getPropertyValue: () => "" }),
    addEventListener: () => {},
    removeEventListener: () => {},
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
  globalRecord.HTMLSelectElement = FakeHTMLSelectElement
  globalRecord.HTMLFormElement = FakeHTMLFormElement

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
      globalRecord.HTMLSelectElement = prevSelect
      globalRecord.HTMLFormElement = prevForm
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

describe("@orahako/plugin-training-plan", () => {
  it("enforces strict export discipline on src/index.ts", () => {
    expect(Object.keys(trainingPlanExports).sort()).toEqual([
      "TRAINING_PLAN_PLUGIN_ID",
      "default",
      "trainingPlanPlugin",
    ])
    expect(trainingPlanExports.default).toBe(trainingPlanPlugin)
    expect(TRAINING_PLAN_PLUGIN_ID).toBe("orahako.training-plan")
  })

  it("computes completion progress, filters non-level-1 warnings, and filters courses", () => {
    expect(
      computeCompletionPercentage({
        numericTotalRequired: 160,
        numericCompleted: 120,
        passed: false,
      })
    ).toBe(75)
    expect(computeCompletionPercentage({ numericTotalRequired: 0, passed: false })).toBeNull()

    const warnings: AcademicWarning[] = [
      { warningType: "正常", warningLevel: "1" },
      { warningType: "必修学分不足", warningLevel: "2", term: "2025-2026-1" },
    ]
    expect(filterActiveWarnings(warnings)).toEqual([
      { warningType: "必修学分不足", warningLevel: "2", term: "2025-2026-1" },
    ])

    const courses: TrainingPlan[] = [
      {
        courseName: "数据结构",
        courseCode: "CS201",
        credit: "4",
        required: true,
        term: "2025-2026-1",
        courseGroup: "专业核心",
      },
      {
        courseName: "西方音乐鉴赏",
        courseCode: "ART102",
        credit: "2",
        required: false,
        term: "2025-2026-2",
        courseGroup: "通识选修",
      },
    ]

    expect(
      filterTrainingPlanCourses(courses, {
        search: "cs201",
        requiredFilter: FILTER_ALL,
        termFilter: FILTER_ALL,
        groupFilter: FILTER_ALL,
      })
    ).toHaveLength(1)

    expect(
      filterTrainingPlanCourses(courses, {
        search: "",
        requiredFilter: FILTER_REQUIRED_YES,
        termFilter: FILTER_ALL,
        groupFilter: FILTER_ALL,
      })
    ).toEqual([courses[0]])

    expect(
      filterTrainingPlanCourses(courses, {
        search: "",
        requiredFilter: FILTER_REQUIRED_NO,
        termFilter: "2025-2026-2",
        groupFilter: "通识选修",
      })
    ).toEqual([courses[1]])
  })

  it("renders training plan, warnings & completion progress, executes recalculateCompletion + query.invalidate, and cleans up on stop", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    let completionState: AcademicCompletion = {
      planName: "2025级软件工程本科培养方案",
      totalRequired: "160",
      numericTotalRequired: 160,
      completed: "120",
      numericCompleted: 120,
      elective: "14",
      numericElective: 14,
      passed: false,
      lastCalculatedAt: "2026-11-18T08:30:00",
    }

    const recalculateSpy = vi.fn(async (): Promise<AcademicCompletion> => {
      completionState = {
        ...completionState,
        completed: "160",
        numericCompleted: 160,
        passed: true,
        lastCalculatedAt: "2026-11-18T09:00:00",
      }
      return completionState
    })

    const getCompletionSpy = vi.fn(async () => completionState)

    const schoolProvider: SchoolProvider = defineSchoolProvider({
      id: "demo-school",
      name: "示例大学",
      slices: {
        trainingPlan: {
          getTrainingPlan: async () => [
            {
              courseName: "操作系统",
              courseCode: "CS301",
              credit: "3.5",
              required: true,
              term: "2026-2027-1",
              courseGroup: "专业主干",
            },
            {
              courseName: "科技论文写作",
              courseCode: "EN205",
              credit: "1.5",
              required: false,
              term: "2026-2027-2",
              courseGroup: "素质选修",
            },
          ],
          getAcademicCompletion: getCompletionSpy,
          recalculateAcademicCompletion: recalculateSpy,
          getAcademicWarnings: async () => [
            { warningType: "无异常", warningLevel: "1" },
            {
              warningType: "选修学分预警",
              warningLevel: "II级",
              description: "通识选修差 2 学分",
              term: "2026-2027-1",
            },
          ],
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
      trainingPlanPlugin,
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
    expect(rootQuery.policy("training-plan")).toEqual({ ttl: DEFAULT_TTL_MS, persist: true })
    expect(rootQuery.policy("academic-completion")).toEqual({ ttl: DEFAULT_TTL_MS, persist: true })
    expect(rootQuery.policy("academic-warnings")).toEqual({ ttl: DEFAULT_TTL_MS, persist: true })

    const ui = runtime.context.get("ui")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!

    const invalidatedFeatures: string[] = []
    runtime.context.on("query/invalidate", (identity) => {
      if (identity?.feature) {
        invalidatedFeatures.push(identity.feature)
      }
    })

    const page = ui
      .getSnapshot()
      .pages.find((entry) => entry.pluginId === TRAINING_PLAN_PLUGIN_ID && entry.id === "index")!
    expect(page.route).toBe("training-plan")
    expect(page.capability).toBe("trainingPlan")

    const nav = ui
      .getSnapshot()
      .navigation.find(
        (entry) => entry.pluginId === TRAINING_PLAN_PLUGIN_ID && entry.id === "training-plan"
      )!
    expect(nav.capability).toBe("trainingPlan")
    expect("group" in nav ? nav.group : undefined).toBe("academic")

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({
      schoolId: "demo-school",
      credential: "ticket-tp",
      username: "20250909",
    })
    await providerRuntime.initialize()

    await dom.render(<ContributionOutlet entry={page} slots={slots} i18n={i18n} />)

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("75.0")
      expect(dom.container.textContent).toContain("2025级软件工程本科培养方案")
      expect(dom.container.textContent).toContain("选修学分预警")
      expect(dom.container.textContent).not.toContain("无异常")
      expect(dom.container.textContent).toContain("操作系统")
      expect(dom.container.textContent).toContain("科技论文写作")
    })

    const recalcButton = findNode(dom.container, (node) =>
      node.attributes.has("data-training-plan-recalculate")
    )
    expect(recalcButton).not.toBeNull()
    const props = getReactProps(recalcButton!)
    expect(typeof props?.onClick).toBe("function")

    await act(async () => {
      const onClick = props?.onClick
      if (typeof onClick === "function") {
        onClick()
      }
    })

    await vi.waitFor(() => {
      expect(recalculateSpy).toHaveBeenCalledTimes(1)
      expect(dom.container.textContent).toContain("100.0")
      expect(dom.container.textContent).toContain("已通过")
    })
    expect(invalidatedFeatures).toEqual(
      expect.arrayContaining(["academic-completion", "academic-warnings", "training-plan"])
    )

    // Filter via search input
    const searchInput = findNode(dom.container, (node) => node.attributes.get("id") === "tp-search")
    expect(searchInput).not.toBeNull()
    await act(async () => {
      const inputProps = getReactProps(searchInput!)
      const onChange = inputProps?.onChange
      if (typeof onChange === "function") {
        onChange({ target: { value: "操作系统" } })
      }
    })
    expect(dom.container.textContent).toContain("操作系统")
    expect(dom.container.textContent).not.toContain("科技论文写作")

    await act(async () => {
      runtime.stop(TRAINING_PLAN_PLUGIN_ID)
    })
    expect(ui.getSnapshot().pages.some((entry) => entry.pluginId === TRAINING_PLAN_PLUGIN_ID)).toBe(
      false
    )
    expect(
      ui.getSnapshot().navigation.some((entry) => entry.pluginId === TRAINING_PLAN_PLUGIN_ID)
    ).toBe(false)
    expect(rootQuery.policy("training-plan")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    expect(rootQuery.policy("academic-completion")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    expect(rootQuery.policy("academic-warnings")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })

  it("degrades gracefully when optional completion and warning methods are absent on TrainingPlanSlice", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const minimalProvider: SchoolProvider = defineSchoolProvider({
      id: "minimal-school",
      name: "精简大学",
      slices: {
        trainingPlan: {
          getTrainingPlan: async () => [
            {
              courseName: "高等代数",
              courseCode: "MATH101",
              credit: "5",
              required: true,
              term: "2025-2026-1",
              courseGroup: "公共基础",
            },
          ],
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
        id: "test.minimal-provider",
        name: "Minimal Provider",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["providers"],
      },
      inject: ["providers"] as const,
      apply(ctx) {
        ctx.providers.registerProvider("minimal-school", () => minimalProvider)
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
      trainingPlanPlugin,
    ]) {
      if (
        plugin.manifest.id === sessionRuntimePlugin.manifest.id ||
        plugin.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(plugin, "builtin", { defaultSchoolId: "minimal-school" })
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

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({
      schoolId: "minimal-school",
      credential: "ticket-min",
      username: "20250001",
    })
    await providerRuntime.initialize()

    const page = ui
      .getSnapshot()
      .pages.find((entry) => entry.pluginId === TRAINING_PLAN_PLUGIN_ID && entry.id === "index")!

    await dom.render(<ContributionOutlet entry={page} slots={slots} i18n={i18n} />)

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("高等代数")
      expect(dom.container.textContent).toContain("暂无学业完成数据")
      expect(dom.container.textContent).toContain("无预警")
    })
    expect(
      findNode(dom.container, (node) => node.attributes.has("data-training-plan-recalculate"))
    ).toBeNull()

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
