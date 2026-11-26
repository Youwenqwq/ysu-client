import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
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
  type ClassPeriod,
  type ClassroomInfo,
  type Course,
} from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { StatelessHttpService } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { routerRuntimePlugin } from "@orahako/runtime-router"
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
import {
  FREE_ROOMS_PLUGIN_ID,
  freeRoomsPlugin,
  type FreeRoomsPageInject,
  type FreeRoomsViewStoreInstance,
} from "../src"
import {
  computeRoomAvailability,
  resolveTimePreset,
  sortRoomAvailabilities,
} from "../src/availability"
import { BuildingScheduleScanner } from "../src/building-scanner"

function createMemoryStorage(): PluginKeyValueStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    async getItem(key) {
      return map.get(key) ?? null
    },
    async setItem(key, value) {
      map.set(key, value)
    },
    async removeItem(key) {
      map.delete(key)
    },
  }
}

class MiniDomNode {
  readonly nodeType: number
  readonly nodeName: string
  readonly tagName: string
  readonly childNodes: MiniDomNode[] = []
  readonly options: MiniDomNode[] = []
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
  readonly dataset: Record<string, string> = {}
  parentNode: MiniDomNode | null = null
  ownerDocument: MiniDomNode | null = null
  defaultView: unknown = null
  nodeValue: string | null = null
  documentElement: MiniDomNode | null = null
  head: MiniDomNode | null = null
  body: MiniDomNode | null = null
  activeElement: MiniDomNode | null = null
  private _value = ""
  get value(): string {
    return this._value
  }
  set value(next: string) {
    this._value = String(next)
  }
  checked = false
  type = ""
  disabled = false
  private readonly attrs = new Map<string, string>()
  private rawText = ""

  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.tagName = nodeName
  }

  get namespaceURI() {
    return "http://www.w3.org/1999/xhtml"
  }
  get firstChild() {
    return this.childNodes[0] ?? null
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null
  }
  get nextSibling(): MiniDomNode | null {
    if (!this.parentNode) return null
    const idx = this.parentNode.childNodes.indexOf(this)
    return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null
  }
  get previousSibling(): MiniDomNode | null {
    if (!this.parentNode) return null
    const idx = this.parentNode.childNodes.indexOf(this)
    return idx > 0 ? (this.parentNode.childNodes[idx - 1] ?? null) : null
  }
  get parentElement(): MiniDomNode | null {
    return this.parentNode?.nodeType === 1 ? this.parentNode : null
  }
  get isConnected() {
    return true
  }
  get className() {
    return this.attrs.get("class") ?? ""
  }
  set className(val: string) {
    this.attrs.set("class", val)
  }

  appendChild(child: MiniDomNode) {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }
  insertBefore(child: MiniDomNode, before: MiniDomNode | null) {
    if (!before) return this.appendChild(child)
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    const idx = this.childNodes.indexOf(before)
    if (idx < 0) this.childNodes.push(child)
    else this.childNodes.splice(idx, 0, child)
    return child
  }
  removeChild(child: MiniDomNode) {
    const idx = this.childNodes.indexOf(child)
    if (idx >= 0) this.childNodes.splice(idx, 1)
    child.parentNode = null
    return child
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, String(value))
  }
  setAttributeNS(_ns: string | null, name: string, value: string) {
    this.attrs.set(name, String(value))
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null
  }
  hasAttribute(name: string) {
    return this.attrs.has(name)
  }
  removeAttribute(name: string) {
    this.attrs.delete(name)
  }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return true
  }
  focus() {}
  blur() {}
  contains(target: MiniDomNode | null): boolean {
    if (!target) return false
    let cur: MiniDomNode | null = target
    while (cur) {
      if (cur === this) return true
      cur = cur.parentNode
    }
    return false
  }
  closest() {
    return null
  }
  querySelectorAll() {
    return []
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }
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
    innerWidth: 1280,
    innerHeight: 800,
    HTMLIFrameElement: class {},
    HTMLElement: MiniDomNode,
    HTMLSelectElement: MiniDomNode,
    HTMLFormElement: MiniDomNode,
    HTMLInputElement: MiniDomNode,
    Element: MiniDomNode,
    Node: MiniDomNode,
    document: doc,
    navigator: { userAgent: "VitestAgent/1.0" },
    location: { pathname: "/", search: "" },
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
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    getElementById: () => null,
  })

  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  g.IS_REACT_ACT_ENVIRONMENT = true
  g.window = fakeWin
  g.document = docWithFactories
  g.getComputedStyle = getCompStyle
  g.requestAnimationFrame = raf
  g.cancelAnimationFrame = caf
  g.HTMLElement = MiniDomNode
  g.HTMLSelectElement = MiniDomNode
  g.HTMLFormElement = MiniDomNode
  g.HTMLInputElement = MiniDomNode
  g.NodeFilter = { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 }
  g.Element = MiniDomNode
  g.Node = MiniDomNode
  g.MutationObserver = NoopObserver
  g.ResizeObserver = NoopObserver

  const container = docWithFactories.createElement("div")
  bodyEl.appendChild(container)
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
      for (const [k, v] of Object.entries(saved)) {
        g[k] = v
      }
    },
  }
}

const samplePeriods: ClassPeriod[] = [
  { section: 1, startTime: "08:00", endTime: "08:45", isInUse: true },
  { section: 2, startTime: "08:55", endTime: "09:40", isInUse: true },
  { section: 3, startTime: "10:05", endTime: "10:50", isInUse: true },
  { section: 4, startTime: "11:00", endTime: "11:45", isInUse: true },
  { section: 5, startTime: "14:00", endTime: "14:45", isInUse: true },
  { section: 6, startTime: "14:55", endTime: "15:40", isInUse: true },
  { section: 7, startTime: "16:05", endTime: "16:50", isInUse: true },
  { section: 8, startTime: "17:00", endTime: "17:45", isInUse: true },
  { section: 9, startTime: "19:00", endTime: "19:45", isInUse: true },
  { section: 10, startTime: "19:55", endTime: "20:40", isInUse: true },
]

const sampleRooms: ClassroomInfo[] = [
  {
    code: "RM-101",
    name: "一教101",
    campusDisplay: "东校区",
    buildingDisplay: "第一教学楼",
    typeDisplay: "多媒体",
    floor: 1,
    classSeats: 60,
    isScheduled: true,
  },
  {
    code: "RM-201",
    name: "一教201",
    campusDisplay: "东校区",
    buildingDisplay: "第一教学楼",
    typeDisplay: "阶梯教室",
    floor: 2,
    classSeats: 120,
    isScheduled: true,
  },
  {
    code: "RM-305",
    name: "一教305",
    campusDisplay: "东校区",
    buildingDisplay: "第一教学楼",
    typeDisplay: "自习室",
    floor: 3,
    classSeats: 40,
    isScheduled: false,
  },
]

describe("free-rooms availability & time preset engine", () => {
  it("resolves now, next, afternoon, evening, and tomorrow presets accurately", () => {
    const base = {
      currentWeek: 5,
      totalWeeks: 20,
      weekday: 3,
      nowMinutes: 9 * 60 + 10, // 09:10 -> in section 2
      periods: samplePeriods,
    }
    expect(resolveTimePreset("now", base)).toEqual({
      week: 5,
      day: 3,
      startSection: 2,
      endSection: 2,
    })
    expect(resolveTimePreset("next", base)).toEqual({
      week: 5,
      day: 3,
      startSection: 3,
      endSection: 4,
    })
    expect(resolveTimePreset("afternoon", base)).toEqual({
      week: 5,
      day: 3,
      startSection: 5,
      endSection: 8,
    })
    expect(resolveTimePreset("evening", base)).toEqual({
      week: 5,
      day: 3,
      startSection: 9,
      endSection: 10,
    })
    expect(resolveTimePreset("tomorrow", { ...base, weekday: 7 })).toEqual({
      week: 6,
      day: 1,
      startSection: 1,
      endSection: 2,
    })
  })

  it("computes free duration, next class hint, occupied status, and sorts free rooms first", () => {
    const rm101Courses: Course[] = [
      {
        name: "高等数学",
        weekDay: 3,
        startSection: 5,
        endSection: 6,
        weeks: "1-16周",
        weekList: [1, 2, 3, 4, 5],
      },
    ]
    const rm201Courses: Course[] = [
      {
        name: "编译原理",
        weekDay: 3,
        startSection: 1,
        endSection: 2,
        weeks: "1-16周",
        weekList: [1, 2, 3, 4, 5],
      },
    ]

    const slot = { week: 5, day: 3, startSection: 1, endSection: 2 }
    const a101 = computeRoomAvailability(sampleRooms[0]!, rm101Courses, samplePeriods, slot)
    const a201 = computeRoomAvailability(sampleRooms[1]!, rm201Courses, samplePeriods, slot)
    const a305 = computeRoomAvailability(sampleRooms[2]!, [], samplePeriods, slot)

    expect(a101.status).toBe("free")
    expect(a101.freeAllDay).toBe(false)
    expect(a101.freeUntilSection).toBe(4)
    expect(a101.freeUntilTime).toBe("11:45")
    expect(a101.nextCourse?.name).toBe("高等数学")
    expect(a101.nextCourseStartTime).toBe("14:00")

    expect(a201.status).toBe("occupied")
    expect(a201.currentCourse?.name).toBe("编译原理")
    expect(a201.nextFreeSection).toBe(3)
    expect(a201.nextFreeTime).toBe("10:05")

    expect(a305.status).toBe("free")
    expect(a305.freeAllDay).toBe(true)

    const sorted = sortRoomAvailabilities([a201, a101, a305], new Set(["RM-101"]))
    expect(sorted.map((item) => item.room.code)).toEqual(["RM-101", "RM-305", "RM-201"])
  })
})

describe("BuildingScheduleScanner concurrency, caching & cancellation", () => {
  it("skips unscheduled rooms, persists cache to local storage, and reuses cache on reload", async () => {
    const storage = createMemoryStorage()
    const fetcher = vi.fn(
      async (code: string): Promise<Course[]> => [
        {
          name: `课程-${code}`,
          weekDay: 1,
          startSection: 1,
          endSection: 2,
          weekList: [1, 2, 3],
        },
      ]
    )

    const scanner1 = new BuildingScheduleScanner(storage)
    await scanner1.scanBuilding({
      scopeKey: "ysu:2026-2027-1:b1",
      rooms: sampleRooms,
      fetchRoomSchedule: fetcher,
      concurrency: 2,
    })

    // RM-305 has isScheduled: false so it is NOT fetched over the network!
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(scanner1.getSnapshot().status).toBe("ready")
    expect(scanner1.getSnapshot().schedulesByRoom["RM-305"]).toEqual([])
    expect(scanner1.getSnapshot().schedulesByRoom["RM-101"]?.[0]?.name).toBe("课程-RM-101")
    scanner1.dispose()

    // New scanner instance hydrates from local storage -> 0 network calls!
    const fetcher2 = vi.fn(async () => [])
    const scanner2 = new BuildingScheduleScanner(storage)
    await scanner2.scanBuilding({
      scopeKey: "ysu:2026-2027-1:b1",
      rooms: sampleRooms,
      fetchRoomSchedule: fetcher2,
    })
    expect(fetcher2).not.toHaveBeenCalled()
    expect(scanner2.getSnapshot().status).toBe("ready")
    expect(scanner2.getSnapshot().schedulesByRoom["RM-201"]?.[0]?.name).toBe("课程-RM-201")
    scanner2.dispose()
  })
})

let activeUnmount: (() => Promise<void>) | undefined
afterEach(async () => {
  await activeUnmount?.()
  activeUnmount = undefined
})

describe("@orahako/plugin-free-rooms export discipline, scanning & UI integration", () => {
  it("enforces strict exports, registers in academic group, scans building rooms, and supports detail view", async () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      "FREE_ROOMS_PLUGIN_ID",
      "default",
      "freeRoomsPlugin",
    ])
    expect(publicApi.default).toBe(freeRoomsPlugin)
    const validated = validatePluginManifest(freeRoomsPlugin.manifest)
    expect(validated.id).toBe("orahako.free-rooms")
    expect(validated.kind).toBe("feature")

    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const getSchoolClassroomSchedule = vi.fn(async (code: string): Promise<Course[]> => {
      if (code === "RM-201") {
        return [
          {
            name: "操作系统",
            teacher: "李老师",
            classroom: "一教201",
            weekDay: 1,
            startSection: 1,
            endSection: 2,
            weeks: "1-16周",
            weekList: [1, 2, 3, 4, 5],
          },
        ]
      }
      return []
    })

    const mockProvider = defineSchoolProvider({
      id: "ysu",
      name: "YSU Mock",
      timeZone: "Asia/Shanghai",
      slices: {
        timetable: {
          getSchedule: async () => [],
          getCurrentWeek: async () => ({ week: 3, weekday: 1, semester: "2026-2027-1" }),
          getTermCalendar: async () => ({
            semester: "2026-2027-1",
            startDate: "2026-08-31",
            totalWeeks: 20,
            teachingWeeks: 18,
            isInUse: true,
          }),
          getClassPeriods: async () => samplePeriods,
        },
        schoolSchedule: {
          getSchoolGradeYears: async () => [],
          getSchoolDepartments: async () => [],
          getSchoolMajors: async () => [],
          getSchoolClasses: async () => [],
          getSchoolClassSchedule: async () => [],
          getSchoolCampuses: async () => [{ id: "east", name: "东校区" }],
          getSchoolBuildings: async () => [{ id: "b1", name: "第一教学楼" }],
          getSchoolClassrooms: async () => sampleRooms,
          getSchoolClassroomSchedule,
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

    const providersPlugin = definePlugin({
      manifest: {
        id: "test.free-rooms.provider",
        name: "Mock Provider",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["providers"],
      },
      inject: ["providers"] as const,
      apply(ctx) {
        ctx.providers.registerProvider("ysu", () => mockProvider)
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
      providerRegistryRuntimePlugin,
      sessionRuntimePlugin,
      providerRuntimePlugin,
      queryRuntimePlugin,
      providersPlugin,
      freeRoomsPlugin,
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
    const query = runtime.context.get("query")!

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({ schoolId: "ysu", credential: "ticket", username: "20240001" })
    await providerRuntime.initialize()

    const pageEntry = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === FREE_ROOMS_PLUGIN_ID && p.id === "index")!
    const navEntry = ui
      .getSnapshot()
      .navigation.find((n) => n.pluginId === FREE_ROOMS_PLUGIN_ID && n.id === "free-rooms")!
    expect(pageEntry.route).toBe("free-rooms")
    expect(pageEntry.capability).toBe("schoolSchedule")
    expect(navEntry.group).toBe("academic")
    expect(navEntry.order).toBe(40)
    expect(navEntry.capability).toBe("schoolSchedule")

    router.push({ route: "free-rooms" })
    await dom.render(
      <ContributionOutlet
        entry={pageEntry}
        slots={slots}
        i18n={i18n}
        onError={(err) => {
          console.error("FREE_ROOMS_OUTLET_ERROR:", err)
          throw err
        }}
      />
    )
    expect(dom.container.textContent).toContain("先选择一栋教学楼")

    const viewStore = pageEntry.store as FreeRoomsViewStoreInstance
    const injected = pageEntry.inject!(runtime.context) as FreeRoomsPageInject

    // Select custom slot Week 3 Mon Sec 1-2 and choose building b1
    await act(async () => {
      viewStore.actions.enterCustomSlot({ week: 3, day: 1, startSection: 1, endSection: 2 })
      injected.setBuilding("b1")
    })

    // RM-101 and RM-305 are free all day; RM-201 is occupied by 操作系统 (hidden when onlyFree=true)
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("一教101")
      expect(dom.container.textContent).toContain("一教305")
      expect(dom.container.textContent).toContain("全天无课")
      expect(dom.container.textContent).not.toContain("一教201")
    })

    // Turning off onlyFree reveals RM-201 with occupied course name
    await act(async () => {
      injected.setOnlyFree(false)
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("一教201")
      expect(dom.container.textContent).toContain("上课中")
      expect(dom.container.textContent).toContain("操作系统")
    })

    // Selecting RM-201 opens weekly timetable detail, and router.back() returns to list
    await act(async () => {
      viewStore.actions.selectRoom({ code: "RM-201", name: "一教201" })
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("一教201")
      expect(dom.container.textContent).toContain("操作系统")
    })
    const ssrHtml = renderToStaticMarkup(
      <ContributionOutlet entry={pageEntry} slots={slots} i18n={i18n} />
    )
    expect(ssrHtml).toContain("一教201")

    const hrefBeforeBack = router.current.getSnapshot().href
    router.back()
    await act(async () => {})
    expect(viewStore.source.getSnapshot().selectedRoom).toBeNull()
    expect(router.current.getSnapshot().href).toBe(hrefBeforeBack)

    // Stopping plugin cleans up page, nav & policies
    await act(async () => {
      runtime.stop(FREE_ROOMS_PLUGIN_ID)
    })
    expect(ui.getSnapshot().pages.filter((p) => p.pluginId === FREE_ROOMS_PLUGIN_ID)).toEqual([])
    expect(ui.getSnapshot().navigation.filter((n) => n.pluginId === FREE_ROOMS_PLUGIN_ID)).toEqual(
      []
    )
    expect(query.policy("school-classrooms")).toEqual({
      ttl: DEFAULT_TTL_MS,
      persist: false,
    })

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
