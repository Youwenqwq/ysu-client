import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

const confettiMock = vi.hoisted(() => {
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
  return vi.fn()
})
vi.mock("canvas-confetti", () => ({
  default: confettiMock,
}))
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}))

import {
  DEFAULT_TTL_MS,
  notificationRegistryRuntimePlugin,
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
  SHORT_TTL_MS,
} from "@orahako/academic-runtime"
import { defineSchoolProvider, type Grade, type SchoolProvider } from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { evaluateNotificationChannels } from "@orahako/plugin-notifications"
import { overviewPlugin } from "@orahako/plugin-overview"
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
  definePlugin,
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import { ToggleGroup } from "@orahako/ui-primitives"
import * as gradesPublic from "../src"
import { GRADES_PLUGIN_ID, gradesPlugin } from "../src"
import { gradeGachaStore, gradeKey, gradesSettingsStore } from "../src/store"

type EventListenerFn = (event: unknown) => void

class MiniDomNode {
  readonly nodeType: number
  readonly nodeName: string
  readonly tagName?: string
  readonly namespaceURI = "http://www.w3.org/1999/xhtml"
  readonly childNodes: MiniDomNode[] = []
  parentNode: MiniDomNode | null = null
  ownerDocument: MiniDomNode | null = null
  defaultView: unknown = undefined
  activeElement: MiniDomNode | null = null
  head?: MiniDomNode
  body?: MiniDomNode
  documentElement?: MiniDomNode
  nodeValue?: string
  private _value = ""
  disabled = false
  type = ""
  id = ""

  get value(): string {
    return this._value
  }

  set value(val: string) {
    this._value = String(val)
  }
  readonly style: Record<string, unknown> = {
    setProperty(name: string, val: string) {
      Reflect.set(this, name, val)
    },
    removeProperty(name: string) {
      Reflect.deleteProperty(this, name)
      return ""
    },
    getPropertyValue() {
      return ""
    },
  }
  readonly attributes = new Map<string, string>()
  private readonly listeners = new Map<string, Set<EventListenerFn>>()
  private rawText = ""

  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    if (nodeType === 1) this.tagName = nodeName
  }

  get isConnected(): boolean {
    return true
  }

  get children(): MiniDomNode[] {
    return this.childNodes.filter((c) => c.nodeType === 1)
  }

  get options(): MiniDomNode[] {
    return this.findAll((c) => c.tagName === "OPTION")
  }

  get firstElementChild(): MiniDomNode | null {
    return this.children[0] ?? null
  }

  get lastElementChild(): MiniDomNode | null {
    const els = this.children
    return els[els.length - 1] ?? null
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

  remove(): void {
    this.parentNode?.removeChild(this)
  }

  insertAdjacentElement(position: string, element: MiniDomNode): MiniDomNode {
    if (position === "afterbegin") {
      return this.insertBefore(element, this.firstChild)
    }
    return this.appendChild(element)
  }

  contains(other: MiniDomNode | null): boolean {
    let cursor: MiniDomNode | null = other
    while (cursor) {
      if (cursor === this) return true
      cursor = cursor.parentNode
    }
    return false
  }

  setAttribute(name: string, val: string): void {
    const str = String(val)
    this.attributes.set(name, str)
    if (name === "id") this.id = str
    if (name === "type") this.type = str
    if (name === "value") this.value = str
    if (name === "disabled") this.disabled = true
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
    if (name === "disabled") this.disabled = false
  }

  focus(): void {
    if (this.ownerDocument) this.ownerDocument.activeElement = this
  }

  blur(): void {
    if (this.ownerDocument?.activeElement === this) {
      this.ownerDocument.activeElement = null
    }
  }

  getBoundingClientRect() {
    return { x: 100, y: 100, left: 100, top: 100, width: 160, height: 220, right: 260, bottom: 320 }
  }

  addEventListener(type: string, listener: EventListenerFn): void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(listener)
  }

  removeEventListener(type: string, listener: EventListenerFn): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatchEvent(event: { type?: string }): boolean {
    if (event.type) {
      const set = this.listeners.get(event.type)
      if (set) {
        for (const fn of Array.from(set)) {
          fn(event)
        }
      }
    }
    return true
  }

  querySelectorAll(): MiniDomNode[] {
    return []
  }

  querySelector(): MiniDomNode | null {
    return null
  }

  closest(): MiniDomNode | null {
    return null
  }

  getElementsByTagName(tag: string): MiniDomNode[] {
    const upper = tag.toUpperCase()
    return this.findAll((node) => node.tagName === upper)
  }

  findAll(predicate: (node: MiniDomNode) => boolean): MiniDomNode[] {
    const matches: MiniDomNode[] = []
    const visit = (node: MiniDomNode) => {
      if (predicate(node)) matches.push(node)
      for (const child of node.childNodes) {
        visit(child)
      }
    }
    visit(this)
    return matches
  }

  set textContent(val: string) {
    this.childNodes.length = 0
    this.rawText = String(val)
  }

  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue ?? ""
    if (this.nodeType === 8) return ""
    if (this.childNodes.length === 0) return this.rawText
    return this.childNodes.map((child) => child.textContent).join("")
  }
}

function getReactProps(node: MiniDomNode): Record<string, unknown> {
  for (const key of Object.keys(node)) {
    if (key.startsWith("__reactProps$")) {
      const val: unknown = Reflect.get(node, key)
      if (typeof val === "object" && val !== null) {
        return val as Record<string, unknown>
      }
    }
  }
  return {}
}

function mountInteractiveDom(screenWidth = 1024, screenHeight = 768) {
  const keys = [
    "window",
    "document",
    "getComputedStyle",
    "HTMLElement",
    "HTMLFormElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "DocumentFragment",
    "NodeFilter",
    "Element",
    "Node",
    "MutationObserver",
    "ResizeObserver",
    "CustomEvent",
    "IS_REACT_ACT_ENVIRONMENT",
  ] as const
  const saved = new Map<string, unknown>()
  for (const key of keys) {
    saved.set(key, Reflect.get(globalThis, key))
  }

  const doc = new MiniDomNode(9, "#document")
  const htmlEl = new MiniDomNode(1, "HTML")
  const headEl = new MiniDomNode(1, "HEAD")
  const bodyEl = new MiniDomNode(1, "BODY")
  htmlEl.ownerDocument = doc
  headEl.ownerDocument = doc
  bodyEl.ownerDocument = doc
  doc.appendChild(htmlEl)
  htmlEl.appendChild(headEl)
  doc.appendChild(bodyEl)
  doc.documentElement = htmlEl
  doc.head = headEl
  doc.body = bodyEl
  doc.activeElement = bodyEl

  const fakeWin = {
    event: undefined,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    innerWidth: screenWidth,
    innerHeight: screenHeight,
    screen: { width: screenWidth, height: screenHeight },
    HTMLIFrameElement: class {},
    HTMLSelectElement: MiniDomNode,
    HTMLElement: MiniDomNode,
    Element: MiniDomNode,
    Node: MiniDomNode,
    document: doc,
    location: { pathname: "/", search: "", href: "/", reload: vi.fn() },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    requestAnimationFrame: (cb: (t: number) => void) => setTimeout(() => cb(0), 0),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    getComputedStyle: () => ({
      getPropertyValue: () => "",
      display: "block",
      visibility: "visible",
    }),
  }
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
    createTreeWalker() {
      return { nextNode: () => null }
    },
    getElementById(id: string) {
      return doc.findAll((node) => node.id === id)[0] ?? null
    },
    createDocumentFragment() {
      const frag = new MiniDomNode(11, "#document-fragment")
      frag.ownerDocument = docWithFactories
      return frag
    },
  })

  class FakeDocumentFragment extends MiniDomNode {
    constructor() {
      super(11, "#document-fragment")
      this.ownerDocument = docWithFactories
    }
  }

  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  class FakeCustomEvent {
    readonly type: string
    readonly detail: unknown
    defaultPrevented = false
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type
      this.detail = init?.detail
    }
    preventDefault() {
      this.defaultPrevented = true
    }
  }

  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true)
  Reflect.set(globalThis, "window", fakeWin)
  Reflect.set(globalThis, "document", docWithFactories)
  Reflect.set(globalThis, "getComputedStyle", fakeWin.getComputedStyle)
  Reflect.set(globalThis, "HTMLElement", MiniDomNode)
  Reflect.set(globalThis, "HTMLSelectElement", MiniDomNode)
  Reflect.set(globalThis, "DocumentFragment", FakeDocumentFragment)
  Reflect.set(globalThis, "HTMLFormElement", class {})
  Reflect.set(globalThis, "HTMLInputElement", class {})
  Reflect.set(globalThis, "NodeFilter", {
    SHOW_ELEMENT: 1,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
  })
  Reflect.set(globalThis, "Element", MiniDomNode)
  Reflect.set(globalThis, "Node", MiniDomNode)
  Reflect.set(globalThis, "MutationObserver", NoopObserver)
  Reflect.set(globalThis, "ResizeObserver", NoopObserver)
  Reflect.set(globalThis, "CustomEvent", FakeCustomEvent)

  const container = docWithFactories.createElement("div")
  bodyEl.appendChild(container)
  const root = createRoot(container as never)

  return {
    container,
    bodyEl,
    async render(node: ReactNode) {
      await act(async () => {
        root.render(node)
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      for (const [key, val] of saved.entries()) {
        Reflect.set(globalThis, key, val)
      }
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

const SAMPLE_GRADES: Grade[] = [
  {
    courseName: "抽象代数",
    courseCode: "MATH301",
    classId: "CLS-1",
    score: "96",
    numericScore: 96,
    gradeLevel: "A+",
    gradePoint: "4.8",
    numericGradePoint: 4.8,
    credit: "4",
    numericCredit: 4,
    semester: "2025-2026-1",
    courseType: "专业必修",
    department: "理学院",
    examType: "闭卷",
    isMajor: true,
    isRetake: "正考",
    isPass: true,
    isValid: true,
    isDegreeCourse: true,
  },
  {
    courseName: "音乐鉴赏",
    courseCode: "ART102",
    classId: "CLS-2",
    score: "88",
    numericScore: 88,
    gradePoint: "3.8",
    numericGradePoint: 3.8,
    credit: "2",
    numericCredit: 2,
    semester: "2025-2026-1",
    courseType: "通识选修",
    isMajor: true,
    isRetake: "正考",
    isPass: true,
    isValid: true,
    isDegreeCourse: false,
  },
]

describe("@orahako/plugin-grades export discipline, gacha store & runtime integration", () => {
  it("enforces strict public export discipline and a valid feature manifest", () => {
    expect(Object.keys(gradesPublic).sort()).toEqual(
      ["GRADES_PLUGIN_ID", "default", "gradesPlugin"].sort()
    )
    expect(gradesPublic.default).toBe(gradesPlugin)
    expect(validatePluginManifest(gradesPlugin.manifest)).toStrictEqual(gradesPlugin.manifest)
    expect(gradesPlugin.manifest.id).toBe("orahako.grades")
    expect(gradesPlugin.manifest.kind).toBe("feature")
    expect(gradesPlugin.manifest.inject).toEqual([
      "ui",
      "slots",
      "settings",
      "router",
      "i18n",
      "storage",
      "provider",
      "session",
      "query",
      "notifications",
    ])
    expect(gradesPlugin.optionalInject).toEqual(["overview"])
  })

  it("maintains per-username gacha revealed keys in gradeGachaStore without cross-account leakage", async () => {
    const localBackend = createMemoryStorage()
    const storage = { local: localBackend, secure: createMemoryStorage() }
    const gacha = gradeGachaStore.create(storage)
    await vi.waitFor(() => expect(gacha.hydrated.getSnapshot()).toBe(true))

    // Initial load for student-a seeds baseline silently without staging pending cards
    gacha.actions.stageGrades("student-a", [SAMPLE_GRADES[0]!], true)
    expect(gacha.source.getSnapshot().revealedByUser["student-a"]).toEqual([
      gradeKey(SAMPLE_GRADES[0]!),
    ])
    expect(gacha.source.getSnapshot().pendingByUser["student-a"]).toEqual([])

    // New grade published for student-a stages ONLY the unrevealed grade
    gacha.actions.stageGrades("student-a", SAMPLE_GRADES, true)
    expect(gacha.source.getSnapshot().pendingByUser["student-a"]).toHaveLength(1)
    expect(gacha.source.getSnapshot().pendingByUser["student-a"]?.[0]?.courseName).toBe("音乐鉴赏")

    // student-b starts clean and seeds its own baseline independently
    gacha.actions.stageGrades("student-b", [SAMPLE_GRADES[1]!], true)
    expect(gacha.source.getSnapshot().revealedByUser["student-b"]).toEqual([
      gradeKey(SAMPLE_GRADES[1]!),
    ])
    expect(gacha.source.getSnapshot().pendingByUser["student-b"]).toEqual([])
    expect(gacha.source.getSnapshot().pendingByUser["student-a"]).toHaveLength(1)

    // Committing student-a moves pending key into revealedByUser["student-a"]
    gacha.actions.commitPending("student-a")
    expect(gacha.source.getSnapshot().pendingByUser["student-a"]).toEqual([])
    expect(gacha.source.getSnapshot().revealedByUser["student-a"]).toEqual([
      gradeKey(SAMPLE_GRADES[0]!),
      gradeKey(SAMPLE_GRADES[1]!),
    ])

    // When gachaEnabled=false, new grades silently join revealedByUser
    const extraGrade: Grade = {
      ...SAMPLE_GRADES[0]!,
      courseName: "实变函数",
      courseCode: "MATH401",
    }
    gacha.actions.stageGrades("student-a", [...SAMPLE_GRADES, extraGrade], false)
    expect(gacha.source.getSnapshot().pendingByUser["student-a"]).toEqual([])
    expect(gacha.source.getSnapshot().revealedByUser["student-a"]).toContain(gradeKey(extraGrade))

    gacha.dispose()
  })

  it("wires page, navigation, settings, notification channel, overview widget, custom provider GPA scale, analytics modal & gacha reveal", async () => {
    const dom = mountInteractiveDom()
    activeUnmount = dom.unmount

    const localBackend = createMemoryStorage()
    const secureBackend = createMemoryStorage()
    const runtime = new PluginRuntime()
    runtime.context.set(
      "storage",
      new NamespacedStorageService({ local: localBackend, secure: secureBackend })
    )
    runtime.context.set("http", new StatelessHttpService())

    let liveGrades: Grade[] = [SAMPLE_GRADES[0]!]
    const getGradeStatistics = vi.fn(async () => ({
      highestScore: 99,
      lowestScore: 62,
      averageScore: 84.5,
    }))
    const getGradeDistribution = vi.fn(async () => [
      { levelName: "优秀", count: 12 },
      { levelName: "良好", count: 18 },
    ])
    const getGradeRanking = vi.fn(async () => ({
      score: 96,
      rank: 2,
      total: 45,
    }))

    const customFivePointSchool: SchoolProvider = defineSchoolProvider({
      id: "five-point-uni",
      name: "五分制大学",
      timeZone: "Asia/Shanghai",
      slices: {
        grades: {
          gpaScale: {
            max: 5,
            bands: [
              { min: 0, letter: "F" },
              { min: 2, letter: "C" },
              { min: 3.5, letter: "B" },
              { min: 4.2, letter: "A" },
              { min: 4.6, letter: "A+" },
            ],
          },
          gradeScale: {
            letterOfScore: (score) => (score >= 95 ? "A+" : score >= 85 ? "A" : "B"),
            letterOfGradeLevel: () => undefined,
          },
          getGrades: async (opts) => {
            if (opts?.courseName) {
              return liveGrades.filter((g) => g.courseName.includes(opts.courseName!))
            }
            return liveGrades
          },
          getGPAStats: async () => ({
            gpaInitial: "4.60",
            numericGpaInitial: 4.6,
            gpaHighest: "4.65",
            weightedAvg: "93.2",
            arithmeticAvg: "92.0",
            requiredCreditEarned: "64",
            electiveCreditEarned: "16",
            planName: "数学与应用数学培养方案",
          }),
          getGradeStatistics,
          getGradeDistribution,
          getGradeRanking,
        },
        timetable: {
          getSchedule: async () => [],
          getCurrentWeek: async () => ({
            week: 5,
            weekday: 2,
            semester: "2025-2026-1",
          }),
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

    const schoolPlugin = definePlugin({
      manifest: {
        id: "test.five-point-school",
        name: "Five Point School",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["providers"],
      },
      inject: ["providers"] as const,
      apply(ctx) {
        ctx.providers.registerProvider("five-point-uni", () => customFivePointSchool)
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
      notificationRegistryRuntimePlugin,
      schoolPlugin,
      overviewPlugin,
      gradesPlugin,
    ]) {
      if (p.manifest.id === queryRuntimePlugin.manifest.id) {
        runtime.register(p, "builtin", { policies: {} })
      } else if (
        p.manifest.id === sessionRuntimePlugin.manifest.id ||
        p.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(p, "builtin", { defaultSchoolId: "five-point-uni" })
      } else {
        runtime.register(p, "builtin")
      }
      runtime.start(p.manifest.id)
    }

    const rootQuery = runtime.context.get("query")!
    expect(rootQuery.policy("grades")).toEqual({ ttl: DEFAULT_TTL_MS, persist: true })
    expect(rootQuery.policy("gpa-stats")).toEqual({ ttl: DEFAULT_TTL_MS, persist: true })
    expect(rootQuery.policy("grade-statistics")).toEqual({ ttl: DEFAULT_TTL_MS, persist: true })
    expect(rootQuery.policy("grade-distribution")).toEqual({ ttl: DEFAULT_TTL_MS, persist: true })
    expect(rootQuery.policy("grade-ranking")).toEqual({ ttl: DEFAULT_TTL_MS, persist: true })
    expect(rootQuery.policy("current-week")).toEqual({ ttl: SHORT_TTL_MS, persist: true })

    const ui = runtime.context.get("ui")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const settings = runtime.context.get("settings") as PluginSettingsRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const router = runtime.context.get("router")!
    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!
    const notifications = runtime.context.get("notifications")!
    const overview = runtime.context.get("overview")!

    slots.declare({ name: "settings.notifications.content", kind: "list" })
    slots.declare({ name: "shell.header.actions", kind: "list" })

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({
      schoolId: "five-point-uni",
      credential: "ticket-5",
      username: "20260001",
    })
    await providerRuntime.initialize()

    const gradesPage = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === GRADES_PLUGIN_ID && p.id === "index")!
    expect(gradesPage).toMatchObject({
      route: "grades",
      title: "成绩",
      titleKey: "navTitle",
      capability: "grades",
      primary: true,
    })

    const gradesNav = ui
      .getSnapshot()
      .navigation.find((n) => n.pluginId === GRADES_PLUGIN_ID && n.id === "grades")!
    expect(gradesNav).toMatchObject({
      group: "main",
      order: 20,
      primary: true,
      capability: "grades",
    })

    const recentGradesWidget = overview
      .getSnapshot()
      .find((w) => w.pluginId === GRADES_PLUGIN_ID && w.id === "recent-grades")!
    expect(recentGradesWidget).toMatchObject({
      slice: "grades",
      order: 70,
      region: "content",
      defaultVisible: false,
    })
    const gpaSummaryWidget = overview
      .getSnapshot()
      .find((widget) => widget.pluginId === GRADES_PLUGIN_ID && widget.id === "gpa-summary")
    expect(gpaSummaryWidget).toMatchObject({
      slice: "grades",
      region: "summary",
      defaultVisible: false,
    })

    const gradesCategory = settings.getSnapshot().find((c) => c.id === "grades")!
    expect(gradesCategory).toBeDefined()
    const settingsStore = gradesCategory.store as ReturnType<typeof gradesSettingsStore.create>
    await vi.waitFor(() => expect(settingsStore.hydrated.getSnapshot()).toBe(true))

    const initialPlan = evaluateNotificationChannels(
      notifications.getSnapshot(),
      customFivePointSchool,
      {}
    )
    expect(initialPlan.flags).toMatchObject({ checkGrades: true, grades: true })

    const notifContentSlot = slots.select("settings.notifications.content")[0]!
    expect(
      renderToStaticMarkup(
        <ToggleGroup type="multiple">
          <ContributionOutlet entry={notifContentSlot} slots={slots} i18n={i18n} />
        </ToggleGroup>
      )
    ).toContain("成绩")

    // Disabling notifyGrades in gradesSettingsStore gates polling flag to false
    settingsStore.actions.setNotifyGrades(false)
    const disabledPlan = evaluateNotificationChannels(
      notifications.getSnapshot(),
      customFivePointSchool,
      {}
    )
    expect(disabledPlan.flags).toMatchObject({ checkGrades: false, grades: false })
    settingsStore.actions.setNotifyGrades(true)

    // Render GradesPage: GPA starts masked (`***`), then reveals `4.60` + custom 5.0 scale `A+` band
    const headerActions = slots.select("shell.header.actions")[0]!
    await dom.render(
      <>
        <header>
          <ContributionOutlet entry={headerActions} slots={slots} i18n={i18n} />
        </header>
        <main>
          <ContributionOutlet entry={gradesPage} slots={slots} i18n={i18n} />
        </main>
      </>
    )
    const header = dom.container.findAll((node) => node.tagName === "HEADER")[0]!
    const main = dom.container.findAll((node) => node.tagName === "MAIN")[0]!
    const sortButtonsIn = (root: MiniDomNode) =>
      root.findAll((node) => node.getAttribute("aria-label") === "排序")
    const termButtonsIn = (root: MiniDomNode) =>
      root.findAll(
        (node) =>
          node.tagName === "BUTTON" &&
          node.getAttribute("data-variant") === "ghost" &&
          node.textContent === "2025-2026-1"
      )

    await act(async () => router.push({ route: "evaluation" }))
    expect(header.children).toHaveLength(0)
    await act(async () => router.push({ pluginId: GRADES_PLUGIN_ID, pageId: "missing" }))
    expect(header.children).toHaveLength(0)
    await act(async () => router.push({ pluginId: GRADES_PLUGIN_ID }))
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("抽象代数")
      expect(termButtonsIn(header)).toHaveLength(1)
      expect(dom.container.textContent).toContain("***")
    })

    expect(sortButtonsIn(main)).toHaveLength(0)
    expect(termButtonsIn(main)).toHaveLength(0)
    expect(header.findAll((node) => node.tagName === "BUTTON")).toEqual([
      sortButtonsIn(header)[0],
      termButtonsIn(header)[0],
    ])
    const trigger = termButtonsIn(header)[0]!
    await act(async () => {
      const onClick = getReactProps(trigger).onClick
      expect(typeof onClick).toBe("function")
      if (typeof onClick === "function") onClick({ currentTarget: trigger })
    })
    const drawer = dom.bodyEl.findAll((node) => node.getAttribute("role") === "dialog")[0]!
    expect(drawer.textContent).toContain("查看各学期课程成绩与绩点")
    const searchButton = drawer.findAll(
      (node) => node.tagName === "BUTTON" && node.textContent === "查询"
    )[0]!
    await act(async () => {
      const onClick = getReactProps(searchButton).onClick
      expect(typeof onClick).toBe("function")
      if (typeof onClick === "function") onClick()
    })
    await vi.waitFor(() => {
      expect(dom.bodyEl.findAll((node) => node.getAttribute("role") === "dialog")).toHaveLength(0)
    })

    await act(async () => {
      settingsStore.actions.setGpaVisible(true)
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("4.60")
      expect(dom.container.textContent).toContain("相当于 A+ 档水平")
      expect(dom.container.textContent).toContain("已是最高档")
    })

    // Click grade card to open detail + analytics modal
    const gradeCardBtn = dom.container.findAll(
      (n) => n.getAttribute("data-grade-card") === "抽象代数"
    )[0]!
    expect(gradeCardBtn).toBeDefined()
    await act(async () => {
      const onClick = getReactProps(gradeCardBtn).onClick
      if (typeof onClick === "function") onClick({ preventDefault() {} })
    })
    await vi.waitFor(() => {
      expect(getGradeStatistics).toHaveBeenCalledWith({
        semester: "2025-2026-1",
        classId: "CLS-1",
        courseCode: undefined,
      })
      expect(dom.bodyEl.textContent).toContain("99.0")
      expect(dom.bodyEl.textContent).toContain("2 / 45")
    })

    // Course detail keeps type/credit badges under the title and grade point beside the score.
    const detailHero = dom.bodyEl.findAll((n) => n.hasAttribute("data-grade-detail"))[0]
    expect(detailHero).toBeDefined()
    const detailScore = dom.bodyEl.findAll((n) => n.hasAttribute("data-grade-detail-score"))[0]
    expect(detailScore?.textContent).toBe("96")
    const detailBadges = dom.bodyEl.findAll((n) => n.hasAttribute("data-grade-detail-badges"))[0]
    expect(detailBadges?.textContent).toContain("专业必修")
    expect(detailBadges?.textContent).toContain("学分 4")
    const detailGradePoint = dom.bodyEl.findAll((n) =>
      n.hasAttribute("data-grade-detail-grade-point")
    )[0]
    expect(detailGradePoint?.textContent).toBe("绩点4.8")
    expect(detailHero?.textContent).not.toContain("MATH301")
    expect(detailHero?.textContent).not.toContain("开课学院")

    // Publish a second grade -> triggers gacha modal & hides unrevealed grade from list until collected
    liveGrades = [...SAMPLE_GRADES]
    const queryService = runtime.context.get("query")!
    await act(async () => {
      queryService.invalidate({ feature: "grades" })
    })
    await vi.waitFor(() => {
      expect(dom.bodyEl.textContent).toContain("新成绩出炉!")
      expect(dom.bodyEl.textContent).toContain("1 门课程发布了成绩")
    })
    // Before collecting, new course ("音乐鉴赏") is hidden from main grades grid
    const gridCardsBefore = dom.container.findAll(
      (n) => n.getAttribute("data-grade-card") === "音乐鉴赏"
    )
    expect(gridCardsBefore).toHaveLength(0)

    // Click Skip/Collect in gacha modal -> commits pending & reveals "音乐鉴赏" in main list
    const skipBtn = dom.bodyEl.findAll(
      (n) => n.tagName === "BUTTON" && n.textContent === "跳过"
    )[0]!
    expect(skipBtn).toBeDefined()
    await act(async () => {
      const onClick = getReactProps(skipBtn).onClick
      if (typeof onClick === "function") onClick({ preventDefault() {} })
    })
    await vi.waitFor(() => {
      expect(
        dom.container.findAll((n) => n.getAttribute("data-grade-card") === "音乐鉴赏")
      ).toHaveLength(1)
    })

    const visibleCourses = () =>
      main
        .findAll((node) => node.hasAttribute("data-grade-card"))
        .map((node) => node.getAttribute("data-grade-card"))
    const clickSort = async () => {
      await act(async () => {
        const onClick = getReactProps(sortButtonsIn(header)[0]!).onClick
        expect(typeof onClick).toBe("function")
        if (typeof onClick === "function") onClick()
      })
    }
    await clickSort()
    expect(visibleCourses()).toEqual(["抽象代数", "音乐鉴赏"])
    await clickSort()
    expect(visibleCourses()).toEqual(["音乐鉴赏", "抽象代数"])
    await act(async () => router.push({ route: "evaluation" }))
    expect(header.children).toHaveLength(0)
    await act(async () => router.push({ route: "grades" }))
    expect(sortButtonsIn(header)).toHaveLength(1)

    // Render GradesSettingsPanel category via ContributionOutlet
    const settingsHtml = renderToStaticMarkup(
      <ContributionOutlet entry={gradesCategory} slots={slots} i18n={i18n} />
    )
    expect(settingsHtml).toContain("新成绩抽卡")
    expect(settingsHtml).toContain("成绩发布通知")

    // Render RecentGradesWidget via overview keyed slot and verify navigation to grades
    const widgetSlotEntry = slots.select("overview.widget", `${GRADES_PLUGIN_ID}:recent-grades`)[0]!
    expect(widgetSlotEntry).toBeDefined()
    await dom.render(<ContributionOutlet entry={widgetSlotEntry} slots={slots} i18n={i18n} />)
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("近期成绩")
      expect(dom.container.textContent).toContain("抽象代数")
    })
    const openBtn = dom.container.findAll(
      (n) => n.getAttribute("aria-label") === "查看全部成绩"
    )[0]!
    await act(async () => {
      const onClick = getReactProps(openBtn).onClick
      if (typeof onClick === "function") onClick({ preventDefault() {} })
    })
    expect(router.current.getSnapshot().route).toBe("grades")

    const gpaSlotEntry = slots.select("overview.widget", `${GRADES_PLUGIN_ID}:gpa-summary`)[0]!
    await dom.render(<ContributionOutlet entry={gpaSlotEntry} slots={slots} i18n={i18n} />)
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("初始绩点")
      expect(dom.container.textContent).toContain("4.60")
      expect(dom.container.textContent).toContain("93.2")
      expect(dom.container.textContent).toContain("92.0")
    })

    // Stopping plugin removes all registrations cleanly
    await act(async () => {
      runtime.stop(GRADES_PLUGIN_ID)
    })
    expect(slots.select("shell.header.actions")).toEqual([])
    expect(ui.getSnapshot().pages.filter((p) => p.pluginId === GRADES_PLUGIN_ID)).toEqual([])
    expect(ui.getSnapshot().navigation.filter((n) => n.pluginId === GRADES_PLUGIN_ID)).toEqual([])
    expect(settings.getSnapshot().filter((c) => c.pluginId === GRADES_PLUGIN_ID)).toEqual([])
    expect(notifications.getSnapshot().filter((c) => c.pluginId === GRADES_PLUGIN_ID)).toEqual([])
    expect(overview.getSnapshot().filter((w) => w.pluginId === GRADES_PLUGIN_ID)).toEqual([])
    expect(rootQuery.policy("grades")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    expect(rootQuery.policy("gpa-stats")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    expect(rootQuery.policy("grade-statistics")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    expect(rootQuery.policy("grade-distribution")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    expect(rootQuery.policy("grade-ranking")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    expect(rootQuery.policy("current-week")).toEqual({ ttl: SHORT_TTL_MS, persist: true })

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })

  it("keeps the grades page, navigation, settings and notification channel when overview is disabled", async () => {
    const localBackend = createMemoryStorage()
    const secureBackend = createMemoryStorage()
    const runtime = new PluginRuntime()
    runtime.context.set(
      "storage",
      new NamespacedStorageService({ local: localBackend, secure: secureBackend })
    )
    runtime.context.set("http", new StatelessHttpService())

    const provider: SchoolProvider = defineSchoolProvider({
      id: "optional-overview-uni",
      name: "Optional Overview University",
      timeZone: "Asia/Shanghai",
      slices: {
        grades: {
          getGrades: async () => [],
        },
        timetable: {
          getSchedule: async () => [],
          getCurrentWeek: async () => ({ week: 1, weekday: 1 }),
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

    const schoolPlugin = definePlugin({
      manifest: {
        id: "test.optional-overview-school",
        name: "Optional Overview School",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["providers"],
      },
      inject: ["providers"] as const,
      apply(ctx) {
        ctx.providers.registerProvider("optional-overview-uni", () => provider)
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
      notificationRegistryRuntimePlugin,
      schoolPlugin,
      gradesPlugin,
    ]) {
      if (p.manifest.id === queryRuntimePlugin.manifest.id) {
        runtime.register(p, "builtin", { policies: {} })
      } else if (
        p.manifest.id === sessionRuntimePlugin.manifest.id ||
        p.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(p, "builtin", { defaultSchoolId: "optional-overview-uni" })
      } else {
        runtime.register(p, "builtin")
      }
      runtime.start(p.manifest.id)
    }

    const ui = runtime.context.get("ui")!
    const settings = runtime.context.get("settings") as PluginSettingsRegistry
    const notifications = runtime.context.get("notifications")!

    expect(
      ui.getSnapshot().pages.some(
        (page) => page.pluginId === GRADES_PLUGIN_ID && page.id === "index"
      )
    ).toBe(true)
    expect(ui.getSnapshot().navigation.some((item) => item.pluginId === GRADES_PLUGIN_ID)).toBe(
      true
    )
    expect(settings.getSnapshot().some((category) => category.pluginId === GRADES_PLUGIN_ID)).toBe(
      true
    )
    expect(
      notifications.getSnapshot().some((channel) => channel.pluginId === GRADES_PLUGIN_ID)
    ).toBe(true)
    expect(runtime.context.get("overview")).toBeUndefined()

    runtime.dispose()
  })
})
