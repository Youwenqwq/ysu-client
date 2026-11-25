import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

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
} from "@orahako/academic-runtime"
import { defineSchoolProvider, type Exam, type SchoolProvider } from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { evaluateNotificationChannels } from "@orahako/plugin-notifications"
import { overviewPlugin } from "@orahako/plugin-overview"
import { StatelessHttpService } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { createNativeService, widgetRuntimePlugin } from "@orahako/runtime-native"
import { navigationRuntimePlugin, routerRuntimePlugin } from "@orahako/runtime-router"
import { settingsRegistryPlugin } from "@orahako/runtime-settings"
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
  WIDGETS_EXAM_CAPABILITY,
  WIDGETS_GENERIC_CAPABILITY,
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import * as examsPublic from "../src"
import { EXAMS_PLUGIN_ID, examsPlugin } from "../src"
import { UpcomingExamsWidget } from "../src/overview-widget"
import type { ExamsSettingsStoreInstance } from "../src/store"
import { computeExamDayDiff } from "../src/widget-sync"

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
  value = ""
  disabled = false
  type = ""
  id = ""
  readonly style: Record<string, unknown> = {
    setProperty() {},
    removeProperty() {
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

  getBoundingClientRect() {
    return { x: 0, y: 0, left: 0, top: 0, width: 100, height: 40, right: 100, bottom: 40 }
  }

  focus(): void {
    if (this.ownerDocument) this.ownerDocument.activeElement = this
  }

  blur(): void {
    if (this.ownerDocument?.activeElement === this) {
      this.ownerDocument.activeElement = null
    }
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

  dispatchEvent(): boolean {
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

function mountInteractiveDom() {
  const keys = [
    "window",
    "document",
    "getComputedStyle",
    "HTMLElement",
    "HTMLFormElement",
    "HTMLInputElement",
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
  doc.appendChild(headEl)
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
    innerWidth: 1024,
    innerHeight: 768,
    screen: { width: 1024, height: 768 },
    HTMLIFrameElement: class {},
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
    getElementById() {
      return null
    },
    createTreeWalker() {
      return { nextNode: () => null }
    },
  })

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

describe("@orahako/plugin-exams export discipline, widget sync/clear & runtime integration", () => {
  it("enforces strict public export discipline and declares widget nativeCapabilities", () => {
    expect(Object.keys(examsPublic).sort()).toEqual(
      ["EXAMS_PLUGIN_ID", "default", "examsPlugin"].sort()
    )
    expect(examsPublic.default).toBe(examsPlugin)
    expect(validatePluginManifest(examsPlugin.manifest)).toStrictEqual(examsPlugin.manifest)
    expect(examsPlugin.manifest.id).toBe("orahako.exams")
    expect(examsPlugin.manifest.kind).toBe("feature")
    expect(examsPlugin.manifest.nativeCapabilities).toEqual([
      WIDGETS_GENERIC_CAPABILITY,
      WIDGETS_EXAM_CAPABILITY,
    ])
    expect(examsPlugin.manifest.inject).toEqual([
      "ui",
      "slots",
      "router",
      "i18n",
      "storage",
      "provider",
      "session",
      "query",
      "notifications",
      "native",
      "widgets",
    ])
    expect(examsPlugin.optionalInject).toEqual(["overview", "assets"])
  })

  it("computes school-timezone exam day countdowns accurately", () => {
    const now = new Date("2026-12-20T02:00:00Z") // 2026-12-20 10:00 Asia/Shanghai
    expect(
      computeExamDayDiff({ name: "编译原理", startAt: "2026-12-20T14:00:00" }, now, "Asia/Shanghai")
    ).toBe(0)
    expect(
      computeExamDayDiff({ name: "操作系统", startAt: "2026-12-21T09:00:00" }, now, "Asia/Shanghai")
    ).toBe(1)
    expect(
      computeExamDayDiff({ name: "计算机网络", startAt: "2026-12-25T09:00:00" }, now, "Asia/Shanghai")
    ).toBe(5)
    expect(computeExamDayDiff({ name: "待定考试" }, now, "Asia/Shanghai")).toBeNull()
  })

  it("derives exam countdowns from the provider time zone, not the timetable slice", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-12-20T02:00:00Z"))

    const exam: Exam = {
      name: "编译原理",
      startAt: "2026-12-21T00:30:00",
      endAt: "2026-12-21T02:30:00",
    }
    const examsSnap = {
      status: "success",
      data: [exam],
      error: null,
      isLoading: false,
      isRefreshing: false,
      isStale: false,
      updatedAt: null,
      refresh: async () => undefined,
    }
    const providerSnap = {
      status: "ready",
      schoolId: "exam-school",
      provider: {
        id: "exam-school",
        name: "测试大学",
        timeZone: "Asia/Shanghai",
        slices: {
          timetable: {
            scheduleRules: { timeZone: "UTC", lunchAfter: 4, dinnerAfter: 8 },
          },
        },
      },
      error: null,
      generation: 1,
    }

    const render = UpcomingExamsWidget as unknown as (props: unknown) => ReactNode
    const html = renderToStaticMarkup(
      render({
        t: (key: string) => (key === "widgets.upcomingExams.examTomorrow" ? "明天" : key),
        useExams: () => examsSnap,
        useProvider: () => providerSnap,
        openExams: () => {},
      })
    )

    expect(html).toContain("明天")
    expect(html).not.toContain("今天")
    vi.useRealTimers()
  })

  it("syncs exam widget snapshots on query success, pins home-screen widgets, and clears widgets on channel disable & plugin dispose", async () => {
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

    const nativeService = createNativeService({
      isNative: () => true,
      loadCapabilities: async () => [],
      capabilities: {
        list: () => [],
        has: () => true,
        acquire: async () => async () => {},
        invoke: (async () => ({})) as never,
      },
    })
    runtime.context.set("native", nativeService)

    const futureExams: Exam[] = [
      {
        name: "高等数学A",
        examName: "期末考试",
        startAt: "2099-01-15T09:00:00",
        endAt: "2099-01-15T11:00:00",
        timeText: "2099-01-15 09:00-11:00",
        examLocation: "西区一教 204",
        seatNumber: "18",
      },
      {
        name: "大学英语",
        examName: "期中考试",
        startAt: "2020-05-10T09:00:00",
        endAt: "2020-05-10T11:00:00",
        examLocation: "东区二教 101",
      },
    ]

    const getExams = vi.fn(async (opts?: { semester?: string }) => {
      if (opts?.semester === "2024-2025-1") {
        return [
          {
            name: "历史学期线性代数",
            startAt: "2025-01-08T09:00:00",
            endAt: "2025-01-08T11:00:00",
            examLocation: "里仁教学楼 302",
          },
        ]
      }
      return futureExams
    })

    const examSchool: SchoolProvider = defineSchoolProvider({
      id: "exam-school",
      name: "测试大学",
      timeZone: "Asia/Shanghai",
      slices: {
        exams: {
          getExams,
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
        id: "test.exam-school",
        name: "Exam School",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["providers"],
      },
      inject: ["providers"] as const,
      apply(ctx) {
        ctx.providers.registerProvider("exam-school", () => examSchool)
      },
    })

    for (const p of [
      slotRegistryPlugin,
      uiRegistryPlugin,
      settingsRegistryPlugin,
      i18nRegistryPlugin,
      routerRuntimePlugin,
      navigationRuntimePlugin,
      widgetRuntimePlugin,
      providerRegistryRuntimePlugin,
      sessionRuntimePlugin,
      providerRuntimePlugin,
      queryRuntimePlugin,
      notificationRegistryRuntimePlugin,
      schoolPlugin,
      overviewPlugin,
      examsPlugin,
    ]) {
      if (
        p.manifest.id === sessionRuntimePlugin.manifest.id ||
        p.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(p, "builtin", { defaultSchoolId: "exam-school" })
      } else {
        runtime.register(p, "builtin")
      }
      runtime.start(p.manifest.id)
    }

    const ui = runtime.context.get("ui")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!
    const notifications = runtime.context.get("notifications")!
    const overview = runtime.context.get("overview")!
    const widgets = runtime.context.get("widgets")!
    const query = runtime.context.get("query")!

    const updateSpy = vi.spyOn(widgets, "update").mockResolvedValue(undefined)
    const clearSpy = vi.spyOn(widgets, "clear").mockResolvedValue(undefined)
    const pinSpy = vi.spyOn(widgets, "requestPin").mockResolvedValue(true)

    slots.declare({ name: "settings.notifications.content", kind: "list" })
    slots.declare({ name: "settings.widgets", kind: "list" })

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({
      schoolId: "exam-school",
      credential: "ticket-exam",
      username: "20260002",
    })
    await providerRuntime.initialize()

    const examsPage = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === EXAMS_PLUGIN_ID && p.id === "index")!
    expect(examsPage).toMatchObject({
      route: "exams",
      capability: "exams",
    })
    expect(query.policy("exams")).toEqual({ ttl: DEFAULT_TTL_MS, persist: true })
    const examsNav = ui
      .getSnapshot()
      .navigation.find((n) => n.pluginId === EXAMS_PLUGIN_ID && n.id === "exams")!
    expect(examsNav).toMatchObject({
      group: "academic",
      order: 30,
      capability: "exams",
    })
    expect(
      overview
        .getSnapshot()
        .find((w) => w.pluginId === EXAMS_PLUGIN_ID && w.id === "upcoming-exams")
    ).toMatchObject({
      slice: "exams",
      order: 60,
    })

    const widgetPinEntries = slots.select("settings.widgets")
    expect(widgetPinEntries.map((e) => e.id)).toEqual(["exam", "exam-compact"])

    // Render widget pin card and verify standard <img> + requestPin("exam")
    await dom.render(<ContributionOutlet entry={widgetPinEntries[0]!} slots={slots} i18n={i18n} />)
    const imgNodes = dom.container.findAll((n) => n.tagName === "IMG")
    expect(imgNodes).toHaveLength(1)
    expect(imgNodes[0]!.getAttribute("src")).toContain("/widgets/exam.png")
    const pinBtn = dom.container.findAll((n) => n.tagName === "BUTTON")[0]!
    await act(async () => {
      const onClick = getReactProps(pinBtn).onClick
      if (typeof onClick === "function") onClick({ preventDefault() {} })
    })
    expect(pinSpy).toHaveBeenCalledWith("exam")

    // Render ExamsPage -> triggers exam query AND syncs both "exam" & "exam-compact" widget snapshots
    await dom.render(<ContributionOutlet entry={examsPage} slots={slots} i18n={i18n} />)
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("高等数学A")
      expect(dom.container.textContent).toContain("大学英语")
      expect(dom.container.textContent).toContain("天后")
      expect(dom.container.textContent).toContain("已完成")
    })

    expect(updateSpy).toHaveBeenCalledWith(
      "exam",
      {
        exams: [
          expect.objectContaining({
            name: "高等数学A",
            exam_name: "期末考试",
            exam_location: "西区一教 204",
            seat_number: "18",
          }),
          expect.objectContaining({
            name: "大学英语",
          }),
        ],
      },
      { syncReminderHours: 24 }
    )
    expect(updateSpy).toHaveBeenCalledWith(
      "exam-compact",
      expect.objectContaining({ exams: expect.any(Array) }),
      { syncReminderHours: 24 }
    )

    // Querying a specific historical semester renders historical exams without overwriting home-screen widgets
    updateSpy.mockClear()
    const termInput = dom.container.findAll((n) => n.tagName === "INPUT")[0]!
    await act(async () => {
      const onChange = getReactProps(termInput).onChange
      if (typeof onChange === "function") {
        onChange({ target: { value: "2024-2025-1" } })
      }
    })
    const queryBtn = dom.container.findAll(
      (n) => n.tagName === "BUTTON" && n.textContent.includes("查询")
    )[0]!
    await act(async () => {
      const onClick = getReactProps(queryBtn).onClick
      if (typeof onClick === "function") onClick({ preventDefault() {} })
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("历史学期线性代数")
    })
    expect(updateSpy).not.toHaveBeenCalled()

    // Render UpcomingExamsWidget in English
    await act(async () => {
      i18n.setLocale("en")
    })
    const upcomingSlot = slots.select("overview.widget", `${EXAMS_PLUGIN_ID}:upcoming-exams`)[0]!
    const upcomingHtml = renderToStaticMarkup(
      <ContributionOutlet entry={upcomingSlot} slots={slots} i18n={i18n} />
    )
    expect(upcomingHtml).toContain("Upcoming Exams")
    expect(upcomingHtml).toContain("1 exams")
    expect(upcomingHtml).toContain("Seat 18")

    // Notification channel evaluation & onDisable clearing widgets
    const examChannel = notifications.getSnapshot().find((c) => c.id === "exams")!
    expect(examChannel).toBeDefined()
    const plan = evaluateNotificationChannels([examChannel], examSchool, {})
    expect(plan.flags).toMatchObject({ checkExams: true, exams: true })

    clearSpy.mockClear()
    await examChannel.onDisable?.()
    expect(clearSpy).toHaveBeenCalledWith("exam")
    expect(clearSpy).toHaveBeenCalledWith("exam-compact")

    // Re-enabling the channel restores widgets from the current exam data
    updateSpy.mockClear()
    await examChannel.onEnable?.()
    expect(updateSpy).toHaveBeenCalledWith(
      "exam",
      expect.objectContaining({ exams: expect.any(Array) }),
      expect.objectContaining({ syncReminderHours: expect.any(Number) })
    )

    // Toggling notifyExams off in scoped examsSettingsStore also clears widgets & disables flag
    const notifContentEntry = slots.select("settings.notifications.content")[0]!
    const examsStore = notifContentEntry.store as ExamsSettingsStoreInstance
    clearSpy.mockClear()
    await act(async () => {
      examsStore.actions.setNotifyExams(false)
    })
    await vi.waitFor(() => {
      expect(clearSpy).toHaveBeenCalledWith("exam")
      expect(clearSpy).toHaveBeenCalledWith("exam-compact")
    })
    const disabledPlan = evaluateNotificationChannels(notifications.getSnapshot(), examSchool, {})
    expect(disabledPlan.flags).toMatchObject({ checkExams: false, exams: false })

    // Disposing plugin clears exam widgets and removes all contributions
    clearSpy.mockClear()
    await act(async () => {
      runtime.stop(EXAMS_PLUGIN_ID)
    })
    expect(clearSpy).toHaveBeenCalledWith("exam")
    expect(clearSpy).toHaveBeenCalledWith("exam-compact")
    expect(notifications.getSnapshot()).toEqual([])
    expect(slots.select("settings.widgets")).toEqual([])
    expect(slots.select("settings.notifications.content")).toEqual([])
    expect(ui.getSnapshot().pages.filter((p) => p.pluginId === EXAMS_PLUGIN_ID)).toEqual([])

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
