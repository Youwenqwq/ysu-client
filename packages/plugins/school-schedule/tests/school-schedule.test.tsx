import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
} from "@orahako/academic-runtime"
import { defineSchoolProvider, type SchoolProvider } from "@orahako/academic-sdk"
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
  validatePluginManifest,
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import * as publicApi from "../src"
import { SCHOOL_SCHEDULE_PLUGIN_ID, schoolSchedulePlugin } from "../src"
import type { SchoolSchedulePageInject } from "../src"
import { FILTER_ALL, type SchoolScheduleFilterStoreInstance } from "../src/store"

vi.mock("@orahako/ui-primitives", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
    TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }
})

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

  set value(next: string) {
    this._value = String(next)
  }
  readonly style: Record<string, unknown> = {
    setProperty(name: string, value: string) {
      ;(this as Record<string, unknown>)[name] = value
    },
    removeProperty(name: string) {
      delete (this as Record<string, unknown>)[name]
    },
    getPropertyValue() {
      return ""
    },
  }
  readonly attributes = new Map<string, string>()
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
    return this.childNodes.filter((child) => child.tagName === "OPTION")
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

  setAttribute(name: string, value: string): void {
    const str = String(value)
    this.attributes.set(name, str)
    if (name === "id") this.id = str
    if (name === "type") this.type = str
    if (name === "value") this.value = str
    if (name === "disabled") this.disabled = true
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
    if (name === "disabled") this.disabled = false
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40 }
  }

  focus(): void {
    if (this.ownerDocument) this.ownerDocument.activeElement = this
  }

  blur(): void {
    if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = null
  }

  addEventListener(): void {}
  removeEventListener(): void {}
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
  const g = globalThis as Record<string, unknown>
  const saved = {
    window: g.window,
    document: g.document,
    getComputedStyle: g.getComputedStyle,
    requestAnimationFrame: g.requestAnimationFrame,
    cancelAnimationFrame: g.cancelAnimationFrame,
    HTMLElement: g.HTMLElement,
    HTMLSelectElement: g.HTMLSelectElement,
    HTMLFormElement: g.HTMLFormElement,
    HTMLInputElement: g.HTMLInputElement,
    NodeFilter: g.NodeFilter,
    CustomEvent: g.CustomEvent,
    Element: g.Element,
    Node: g.Node,
    MutationObserver: g.MutationObserver,
    ResizeObserver: g.ResizeObserver,
    IS_REACT_ACT_ENVIRONMENT: g.IS_REACT_ACT_ENVIRONMENT,
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
  htmlEl.appendChild(bodyEl)
  doc.documentElement = htmlEl
  doc.head = headEl
  doc.body = bodyEl
  doc.activeElement = bodyEl

  const raf = (cb: (t: number) => void) => {
    queueMicrotask(() => cb(0))
    return 0
  }
  const caf = () => {}
  const getCompStyle = () => ({
    animationName: "none",
    getPropertyValue: () => "",
    display: "block",
    visibility: "visible",
  })

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
    HTMLSelectElement: MiniDomNode,
    HTMLFormElement: MiniDomNode,
    HTMLInputElement: MiniDomNode,
    Element: MiniDomNode,
    Node: MiniDomNode,
    document: doc,
    location: { pathname: "/", search: "", reload: vi.fn() },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    requestAnimationFrame: raf,
    cancelAnimationFrame: caf,
    getComputedStyle: getCompStyle,
  }
  doc.defaultView = fakeWin
  const docWithFactories = Object.assign(doc, {
    visibilityState: "visible",
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

  g.IS_REACT_ACT_ENVIRONMENT = true
  g.window = fakeWin
  g.document = docWithFactories
  g.getComputedStyle = getCompStyle
  g.requestAnimationFrame = raf
  g.cancelAnimationFrame = caf
  vi.stubGlobal("navigator", { userAgent: "VitestAgent/1.0" })
  g.HTMLElement = MiniDomNode
  g.HTMLSelectElement = MiniDomNode
  g.HTMLFormElement = MiniDomNode
  g.HTMLInputElement = MiniDomNode
  g.NodeFilter = { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 }
  g.CustomEvent = FakeCustomEvent
  g.Element = MiniDomNode
  g.Node = MiniDomNode
  g.MutationObserver = NoopObserver
  g.ResizeObserver = NoopObserver

  const container = docWithFactories.createElement("div")
  bodyEl.appendChild(container)
  const root = createRoot(container as never, {
    onUncaughtError(error) {
      console.error("UNCAUGHT_RENDER_ERROR:", error)
    },
    onCaughtError(error) {
      console.error("CAUGHT_RENDER_ERROR:", error)
    },
  })

  return {
    container,
    body: bodyEl,
    async render(node: ReactNode) {
      await act(async () => {
        root.render(node)
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      for (const [k, v] of Object.entries(saved)) {
        g[k] = v
      }
    },
  }
}

let activeUnmount: (() => Promise<void>) | undefined
afterEach(async () => {
  vi.useRealTimers()
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

describe("@orahako/plugin-school-schedule export discipline, lazy filtering & timetable rendering", () => {
  it("enforces strict export discipline and valid v3 feature manifest", () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      "SCHOOL_SCHEDULE_PLUGIN_ID",
      "default",
      "schoolSchedulePlugin",
    ])
    expect(publicApi.default).toBe(schoolSchedulePlugin)
    const validated = validatePluginManifest(schoolSchedulePlugin.manifest)
    expect(validated.id).toBe("orahako.school-schedule")
    expect(validated.kind).toBe("feature")
    expect(validated.inject).toEqual(["ui", "router", "i18n", "provider", "session", "query"])
  })

  it("defers class/classroom queries until filters are chosen, renders class & classroom timetables, and supports free-room deep links", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date("2026-09-22T10:00:00+08:00"))
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const getSchoolClasses = vi.fn(async (opts?: { grade?: string; department?: string }) => [
      {
        classId: "cls-cs-2401",
        className: `计算机2401-${opts?.grade ?? "all"}-${opts?.department ?? "all"}`,
        gradeDisplay: "2024级",
        departmentDisplay: "信息科学与工程学院",
        majorDisplay: "计算机科学与技术",
        studentCount: 32,
        isScheduled: true,
      },
      {
        classId: "cls-cs-2402",
        className: "计算机2402",
        gradeDisplay: "2024级",
        isScheduled: false,
      },
    ])
    const getSchoolClassSchedule = vi.fn(async (classId: string) => [
      {
        name: `数据结构(${classId})`,
        teacher: "王教授",
        classroom: "信息馆301",
        weekDay: 2,
        startSection: 1,
        endSection: 2,
        weeks: "1-16周",
        weekList: [1, 2, 3, 4],
      },
    ])
    const getSchoolClassrooms = vi.fn(async (opts?: { campus?: string; name?: string }) => [
      {
        code: "RM-301",
        name: opts?.name ? `搜索教室-${opts.name}` : "东区信息馆301",
        campusDisplay: "东校区",
        buildingDisplay: "信息馆",
        typeDisplay: "多媒体教室",
        classSeats: 120,
        isScheduled: true,
      },
    ])
    const getSchoolClassroomSchedule = vi.fn(async (code: string) => [
      {
        name: `编译原理(${code})`,
        teacher: "李老师",
        classroom: "东区信息馆301",
        weekDay: 3,
        startSection: 3,
        endSection: 4,
        weeks: "1-16周",
        weekList: [1, 2, 3],
      },
    ])

    const schoolProvider: SchoolProvider = defineSchoolProvider({
      id: "ysu",
      name: "燕山大学",
      slices: {
        timetable: {
          getSchedule: async () => [],
          getCurrentWeek: async () => ({
            week: 3,
            weekday: 2,
            semester: "2026-2027-1",
            date: "2026-09-22",
            weekStartDate: "2026-09-21",
          }),
          getTermCalendar: async () => ({
            semester: "2026-2027-1",
            startDate: "2026-09-07",
            totalWeeks: 20,
            teachingWeeks: 18,
            isInUse: true,
          }),
          getClassPeriods: async () => [
            { section: 1, startTime: "08:00", endTime: "08:45", isInUse: true },
            { section: 2, startTime: "08:55", endTime: "09:40", isInUse: true },
            { section: 3, startTime: "10:00", endTime: "10:45", isInUse: true },
            { section: 4, startTime: "10:55", endTime: "11:40", isInUse: true },
          ],
        },
        schoolSchedule: {
          getSchoolGradeYears: async () => [{ id: "2024", name: "2024级" }],
          getSchoolDepartments: async () => [{ id: "ise", name: "信息科学与工程学院" }],
          getSchoolMajors: async (dept) =>
            dept === "ise" ? [{ id: "cs", name: "计算机科学与技术", department: "ise" }] : [],
          getSchoolClasses,
          getSchoolClassSchedule,
          getSchoolCampuses: async () => [{ id: "east", name: "东校区" }],
          getSchoolBuildings: async (campus) =>
            campus === "east" ? [{ id: "info-bldg", name: "信息馆" }] : [],
          getSchoolClassrooms,
          getSchoolClassroomSchedule,
        },
      },
      async initialize() {},
      async reset() {},
      async logout() {},
      async relogin() {
        return true
      },
    })

    const providersPlugin = definePlugin({
      manifest: {
        id: "test.school",
        name: "Test School",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["providers"],
      },
      inject: ["providers"] as const,
      apply(ctx) {
        ctx.providers.registerProvider("ysu", () => schoolProvider)
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

    for (const p of [
      slotRegistryPlugin,
      uiRegistryPlugin,
      i18nRegistryPlugin,
      routerRuntimePlugin,
      navigationRuntimePlugin,
      providerRegistryRuntimePlugin,
      sessionRuntimePlugin,
      providerRuntimePlugin,
      queryRuntimePlugin,
      providersPlugin,
      schoolSchedulePlugin,
    ]) {
      if (
        p.manifest.id === sessionRuntimePlugin.manifest.id ||
        p.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(p, "builtin", { defaultSchoolId: "ysu" })
      } else {
        runtime.register(p, "builtin")
      }
      runtime.start(p.manifest.id)
    }

    const ui = runtime.context.get("ui")!
    const router = runtime.context.get("router")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({
      schoolId: "ysu",
      credential: "ticket",
      username: "20240001",
    })
    await providerRuntime.initialize()

    const pageEntry = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === SCHOOL_SCHEDULE_PLUGIN_ID && p.id === "index")!
    const navEntry = ui
      .getSnapshot()
      .navigation.find((n) => n.pluginId === SCHOOL_SCHEDULE_PLUGIN_ID && n.id === "school-schedule")!
    expect(pageEntry.route).toBe("school-schedule")
    expect(pageEntry.capability).toBe("schoolSchedule")
    expect(navEntry.group).toBe("platform")
    expect(navEntry.capability).toBe("schoolSchedule")

    router.push({ route: "school-schedule" })
    await dom.render(
      <ContributionOutlet
        entry={pageEntry}
        slots={slots}
        i18n={i18n}
        onError={(err) => {
          console.error("OUTLET_ERROR:", err)
          throw err
        }}
      />
    )

    // Before selecting any filter, full class/room lists are NOT queried!
    expect(dom.container.textContent).toContain("选择筛选条件后查询")
    expect(getSchoolClasses).not.toHaveBeenCalled()
    expect(getSchoolClassrooms).not.toHaveBeenCalled()

    const store = pageEntry.store as SchoolScheduleFilterStoreInstance

    // Selecting department resets major and fetches filtered classes
    await act(async () => {
      store.actions.setMajor("old-major")
      store.actions.setDepartment("ise")
    })
    expect(store.source.getSnapshot().major).toBe(FILTER_ALL)

    await vi.waitFor(() => {
      expect(getSchoolClasses).toHaveBeenCalledWith({ department: "ise" })
      expect(dom.container.textContent).toContain("计算机2401-all-ise")
      expect(dom.container.textContent).toContain("32 人")
      expect(dom.container.textContent).toContain("未排课")
    })

    // Selecting a class loads its timetable view
    await act(async () => {
      store.actions.selectClass({
        classId: "cls-cs-2401",
        className: "计算机2401",
      })
    })

    await vi.waitFor(() => {
      expect(getSchoolClassSchedule).toHaveBeenCalledWith("cls-cs-2401")
      expect(dom.container.textContent).toContain("数据结构(cls-cs-2401)")
      expect(dom.container.textContent).toContain("信息馆301")
    })

    // Router back pops selectedClass back to class list
    router.back()
    await act(async () => {})
    expect(store.source.getSnapshot().selectedClass).toBeNull()

    // Navigating with free-room context deep link switches to room tab and shows context banner
    await act(async () => {
      router.push({
        route: "school-schedule",
        params: { tab: "room", week: 3, day: 2, section: 5 },
      })
    })

    await vi.waitFor(() => {
      expect(store.source.getSnapshot().tab).toBe("room")
      expect(dom.container.textContent).toContain("正在查找第3周 · 星期二第5节 的空教室")
    })

    const { onTabChange } = pageEntry.inject!(runtime.context) as SchoolSchedulePageInject
    await act(async () => {
      onTabChange("class")
    })
    expect(store.source.getSnapshot().tab).toBe("class")
    expect(router.current.getSnapshot().params).toEqual({ week: "3", day: "2", section: "5" })

    await act(async () => {
      router.replace(router.current.getSnapshot().href)
    })
    expect(store.source.getSnapshot().tab).toBe("class")

    await act(async () => {
      router.push({ route: "school-schedule", params: { tab: "room", week: 3, day: 2, section: 5 } })
    })
    expect(store.source.getSnapshot().tab).toBe("room")

    // Switch locale to English and search classrooms
    await act(async () => {
      i18n.setLocale("en")
      store.actions.setRoomNameInput("301")
      store.actions.submitRoomSearch()
    })

    await vi.waitFor(() => {
      expect(getSchoolClassrooms).toHaveBeenCalledWith({ name: "301" })
      expect(dom.container.textContent).toContain(
        "Finding free rooms · week 3, Tuesday, section 5"
      )
      expect(dom.container.textContent).toContain("搜索教室-301")
      expect(dom.container.textContent).toContain("120 seats")
    })

    // Select classroom -> renders classroom schedule
    await act(async () => {
      store.actions.selectRoom({ code: "RM-301", name: "东区信息馆301" })
    })

    await vi.waitFor(() => {
      expect(getSchoolClassroomSchedule).toHaveBeenCalledWith("RM-301")
      expect(dom.container.textContent).toContain("编译原理(RM-301)")
    })

    // Static SSR markup sanity check
    const ssrHtml = renderToStaticMarkup(
      <ContributionOutlet entry={pageEntry} slots={slots} i18n={i18n} />
    )
    expect(ssrHtml).toContain("东区信息馆301")

    // Stopping plugin cleans up page & navigation
    await act(async () => {
      runtime.stop(SCHOOL_SCHEDULE_PLUGIN_ID)
    })
    expect(ui.getSnapshot().pages.filter((p) => p.pluginId === SCHOOL_SCHEDULE_PLUGIN_ID)).toEqual(
      []
    )
    expect(
      ui.getSnapshot().navigation.filter((n) => n.pluginId === SCHOOL_SCHEDULE_PLUGIN_ID)
    ).toEqual([])

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
