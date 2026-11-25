import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { expandScheduleCourses } from "@orahako/academic-kit"
import {
  DEFAULT_TTL_MS,
  LONG_TTL_MS,
  notificationRegistryRuntimePlugin,
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
  SHORT_TTL_MS,
} from "@orahako/academic-runtime"
import {
  defineSchoolProvider,
  type ClassPeriod,
  type Course,
  type CurrentWeek,
  type Exam,
  type SchoolProvider,
  type TermCalendar,
} from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { notificationsPlugin } from "@orahako/plugin-notifications"
import { overviewPlugin, OVERVIEW_PLUGIN_ID } from "@orahako/plugin-overview"
import { StatelessHttpService } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { createNativeService, widgetRuntimePlugin } from "@orahako/runtime-native"
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
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
  type ScheduleEntry,
} from "@orahako/sdk"
import * as publicApi from "../src"
import { SCHEDULE_PLUGIN_ID, schedulePlugin } from "../src"
import {
  ClassReminderAndWidgetController,
  computeClassAlarms,
  NOTIFICATIONS_CORE_CAPABILITY,
  REMINDERS_CLASSES_CAPABILITY,
  WIDGETS_GENERIC_CAPABILITY,
  WIDGETS_SCHEDULE_CAPABILITY,
} from "../src/controller"
import {
  NATIVE_GEOLOCATION_CAPABILITY,
  CourseActivityModal,
  CourseSigninModal,
  resolveGeolocationCoordinates,
  type MobileLessonBridge,
} from "../src/modals"
import { scheduleDictionary } from "../src/dictionary"
import { ScheduleAdjustmentDialog, ScheduleAdjustmentsDialog } from "../src/editor-dialogs"
import { WidgetDiscovery } from "../src/widget-discovery"
import {
  computeEffectiveScheduleSnapshot,
  computeSchedulePatchScope,
  createSchedulePatchMutators,
  createValidatedSchedulePatch,
  schedulePatchesStore,
  scheduleSettingsStore,
  type ScheduleSettingsStoreInstance,
  type ScheduleViewStoreInstance,
} from "../src/stores"

vi.mock("@orahako/ui-primitives", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const PassThrough = ({ children }: { children: ReactNode }) => <>{children}</>
  return {
    ...actual,
    ResponsiveModal: PassThrough,
    ResponsiveModalContent: PassThrough,
    ResponsiveModalHeader: PassThrough,
    ResponsiveModalTitle: PassThrough,
    ResponsiveModalDescription: PassThrough,
    ResponsiveModalBody: PassThrough,
    ResponsiveModalFooter: PassThrough,
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

  findAll(predicate: (node: MiniDomNode) => boolean): MiniDomNode[] {
    const matches: MiniDomNode[] = []
    const visit = (node: MiniDomNode) => {
      if (predicate(node)) matches.push(node)
      for (const child of node.childNodes) visit(child)
    }
    visit(this)
    return matches
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
    innerWidth: 1280,
    innerHeight: 800,
    screen: { width: 1280, height: 800 },
    HTMLIFrameElement: class {},
    HTMLElement: MiniDomNode,
    HTMLSelectElement: MiniDomNode,
    HTMLFormElement: MiniDomNode,
    HTMLInputElement: MiniDomNode,
    Element: MiniDomNode,
    Node: MiniDomNode,
    document: doc,
    navigator: { userAgent: "VitestAgent/1.0" },
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
  vi.stubGlobal("navigator", fakeWin.navigator)
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

function createMemoryStorage(): PluginKeyValueStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value)
    },
    removeItem: async (key) => {
      map.delete(key)
    },
  }
}

const sampleCourses: Course[] = [
  {
    name: "高等数学",
    code: "MATH101",
    teacher: "张老师",
    classroom: "A101",
    weekDay: 1,
    startSection: 1,
    endSection: 2,
    weeks: "1-16周",
    weekList: [1, 2, 3],
    classId: "CLS-1",
    scheduleId: "SCH-1",
    classType: "1",
  },
  {
    name: "大学英语",
    code: "ENG102",
    teacher: "刘老师",
    classroom: "B205",
    weekDay: 2,
    startSection: 3,
    endSection: 4,
    weeks: "1-16周",
    weekList: [1, 2, 3],
    classId: "CLS-2",
    scheduleId: "SCH-2",
    classType: "1",
  },
]

const samplePeriods: ClassPeriod[] = [
  { section: 1, startTime: "08:00", endTime: "08:45", isInUse: true },
  { section: 2, startTime: "08:55", endTime: "09:40", isInUse: true },
  { section: 3, startTime: "10:00", endTime: "10:45", isInUse: true },
  { section: 4, startTime: "10:55", endTime: "11:40", isInUse: true },
]

const sampleCalendar: TermCalendar = {
  semester: "2026-2027-1",
  startDate: "2026-09-07",
  totalWeeks: 20,
  teachingWeeks: 18,
  isInUse: true,
}

const sampleWeek: CurrentWeek = {
  week: 1,
  weekday: 1,
  semester: "2026-2027-1",
  date: "2026-09-07",
  weekStartDate: "2026-09-07",
}

const sampleExams: Exam[] = [
  {
    name: "英语分级考",
    startAt: "2026-09-09T08:00:00",
    endAt: "2026-09-09T09:40:00",
    examLocation: "东区C102",
    seatNumber: "18",
  },
]

describe("@orahako/plugin-schedule export discipline & manifest", () => {
  it("exports ONLY plugin constant, plugin definition, and default export at runtime", () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      "SCHEDULE_PLUGIN_ID",
      "default",
      "schedulePlugin",
    ])
    expect(publicApi.default).toBe(schedulePlugin)

    const validated = validatePluginManifest(schedulePlugin.manifest)
    expect(validated.id).toBe("orahako.schedule")
    expect(validated.kind).toBe("feature")
    expect(validated.nativeCapabilities).toEqual([
      NOTIFICATIONS_CORE_CAPABILITY,
      REMINDERS_CLASSES_CAPABILITY,
      WIDGETS_GENERIC_CAPABILITY,
      WIDGETS_SCHEDULE_CAPABILITY,
    ])
    expect(validated.provides).toEqual(["schedule"])
    expect(validated.inject).toEqual([
      "ui",
      "slots",
      "settings",
      "router",
      "i18n",
      "storage",
      "native",
      "widgets",
      "assets",
    ])
    expect(schedulePlugin.optionalInject).toEqual([
      "provider",
      "session",
      "query",
      "notifications",
      "overview",
    ])
  })
})

describe("scheduleSettingsStore & schedulePatchesStore validation and persistence", () => {
  it("persists settings to local storage, clamps numeric bounds, and persists patches to secure storage with dependency cascade", async () => {
    const local = createMemoryStorage()
    const secure = createMemoryStorage()

    const settings = scheduleSettingsStore.create({ local, secure })
    await vi.waitFor(() => expect(settings.hydrated.getSnapshot()).toBe(true))

    settings.actions.setCompactMode(true)
    settings.actions.setWidgetSyncReminderHours(999)
    settings.actions.setClassReminderMinutes(0)
    settings.actions.setClassReminderDays(30)

    expect(settings.source.getSnapshot()).toMatchObject({
      compactMode: true,
      widgetSyncReminderHours: 168,
      classReminderMinutes: 1,
      classReminderDays: 14,
    })
    await vi.waitFor(() => expect(local.map.has("schedule-settings")).toBe(true))
    expect(secure.map.size).toBe(0)

    const patches = schedulePatchesStore.create({ local, secure })
    await vi.waitFor(() => expect(patches.hydrated.getSnapshot()).toBe(true))

    const occurrences = expandScheduleCourses(sampleCourses, "2026-09-07", 20)
    const mathWeek1 = occurrences.find((c) => c.name === "高等数学" && c.date === "2026-09-07")!
    expect(mathWeek1).toBeDefined()

    // Rejects out-of-term targetDate
    expect(() =>
      createValidatedSchedulePatch({
        draft: {
          kind: "course",
          mode: "move",
          sourceDate: "2026-09-07",
          targetDate: "2025-01-01",
          targetStartSection: 1,
          note: "bad date",
          source: [mathWeek1],
          replaced: [],
          dependsOn: [],
        },
        stored: [],
        rawCourses: sampleCourses,
        termStartDate: "2026-09-07",
        totalWeeks: 20,
      })
    ).toThrow("scheduleEditor.issue_invalidDate")

    // Valid move patch (2026-09-07 -> 2026-09-09 section 1)
    const patch1 = createValidatedSchedulePatch({
      draft: {
        kind: "course",
        mode: "move",
        sourceDate: "2026-09-07",
        targetDate: "2026-09-09",
        targetStartSection: 1,
        classroom: "D404",
        note: "Holiday move",
        source: [mathWeek1],
        replaced: [],
        dependsOn: [],
      },
      stored: [],
      rawCourses: sampleCourses,
      termStartDate: "2026-09-07",
      totalWeeks: 20,
      generateId: () => "patch-1",
      nowMs: 1_700_000_000_000,
    })

    const scope = JSON.stringify(["ysu", "20240001", "2026-2027-1"])
    patches.actions.add(scope, patch1)
    await vi.waitFor(() => expect(secure.map.has("schedule-patches")).toBe(true))

    // Dependent second patch moving the relocated occurrence to 2026-09-10
    const fakeProviderSnap = {
      status: "ready" as const,
      schoolId: "ysu",
      provider: defineSchoolProvider({
        id: "ysu",
        name: "YSU",
        timeZone: "Asia/Shanghai",
        slices: {},
        async initialize() {},
        async reset() {},
        async logout() {},
        async dispose() {},
        async relogin() {
          return true
        },
      }),
      error: null,
      generation: 1,
    }
    const fakeSessionSnap = {
      activeSchoolId: "ysu",
      credential: "ticket",
      username: "20240001",
      isAuthenticated: true,
      sessionExpired: false,
      hasHydrated: true,
      artifacts: {},
    }

    const afterPatch1 = computeEffectiveScheduleSnapshot({
      rawCourses: sampleCourses,
      calendar: sampleCalendar,
      currentWeek: sampleWeek,
      providerSnapshot: fakeProviderSnap,
      sessionSnapshot: fakeSessionSnap,
      patchesState: patches.source.getSnapshot(),
      patchesHydrated: true,
    })
    expect(afterPatch1.ready).toBe(true)
    const movedMath = afterPatch1.courses.find(
      (c) => c.name === "高等数学" && c.date === "2026-09-09"
    )!
    expect(movedMath.classroom).toBe("D404")

    const mutators = createSchedulePatchMutators({
      patchesStore: patches,
      getProviderSnapshot: () => fakeProviderSnap,
      getSessionSnapshot: () => fakeSessionSnap,
    })
    const mutationCtx = {
      expectedScope: afterPatch1.scope,
      rawCourses: sampleCourses,
      termStartDate: afterPatch1.termStartDate,
      totalWeeks: afterPatch1.totalWeeks,
    }

    const patch2Id = mutators.addPatch(mutationCtx, {
      kind: "course",
      mode: "move",
      sourceDate: "2026-09-09",
      targetDate: "2026-09-10",
      targetStartSection: 3,
      note: "Second hop",
      source: [movedMath],
      replaced: [],
      dependsOn: [],
    })
    expect(patch2Id).toBeTruthy()

    // Disabling patch-1 cascades to disable dependent patch2Id
    mutators.setPatchEnabled(mutationCtx, "patch-1", false)
    const storedAfterDisable = patches.source.getSnapshot().byScope[scope]!
    expect(storedAfterDisable.every((p) => !p.enabled)).toBe(true)

    // Re-enabling child while parent disabled throws missingDependency
    expect(() => mutators.setPatchEnabled(mutationCtx, patch2Id, true)).toThrow(
      "scheduleEditor.issue_missingDependency"
    )

    // Removing parent removes child transitively
    mutators.removePatch(mutationCtx, "patch-1")
    expect(patches.source.getSnapshot().byScope[scope]).toEqual([])

    // Provider generation changes no longer move the patch scope
    expect(
      computeSchedulePatchScope({
        providerSnapshot: { ...fakeProviderSnap, generation: 9 },
        sessionSnapshot: fakeSessionSnap,
        semester: "2026-2027-1",
      })
    ).toBe(afterPatch1.scope)

    // Legacy generation-scoped patches migrate into the stable scope on hydration
    const legacyScope = JSON.stringify(["ysu", "ysu:7", "20240001", "2026-2027-1"])
    const legacyBackend = createMemoryStorage()
    await legacyBackend.setItem(
      "schedule-patches",
      JSON.stringify({ version: 1, state: { byScope: { [legacyScope]: [patch1] } } })
    )
    const migratedPatches = schedulePatchesStore.create({
      local: createMemoryStorage(),
      secure: legacyBackend,
    })
    await vi.waitFor(() => expect(migratedPatches.hydrated.getSnapshot()).toBe(true))
    expect(migratedPatches.source.getSnapshot().byScope[scope]).toEqual([patch1])
    expect(migratedPatches.source.getSnapshot().byScope[legacyScope]).toBeUndefined()
    migratedPatches.dispose()

    settings.dispose()
    patches.dispose()
  })
})

describe("computeClassAlarms & ClassReminderAndWidgetController", () => {
  it("does not schedule a reminder whose trigger time has already passed", () => {
    const now = new Date("2026-09-07T00:30:00Z") // 08:30 Asia/Shanghai, during the 08:00 class
    expect(
      computeClassAlarms(
        [sampleCourses[0]!],
        sampleWeek,
        samplePeriods,
        1,
        sampleCalendar,
        15,
        now,
        "Asia/Shanghai"
      )
    ).toEqual([])
  })

  it("computes Shanghai-timezone alarms, merges conflicting courses, and handles geolocation lookup", async () => {
    const now = new Date("2026-09-06T17:00:00Z") // 2026-09-07 01:00 Asia/Shanghai (Monday)
    const conflicting: Course[] = [
      sampleCourses[0]!,
      {
        ...sampleCourses[0]!,
        name: "线性代数",
        classroom: "A102",
        scheduleId: "SCH-CONFLICT",
      },
    ]

    const alarms = computeClassAlarms(
      conflicting,
      sampleWeek,
      samplePeriods,
      1,
      sampleCalendar,
      15,
      now,
      "Asia/Shanghai"
    )
    expect(alarms).toEqual([
      {
        alarmId: "2026-09-07|1",
        alarmTime: Date.parse("2026-09-07T07:45:00+08:00"),
        courseName: "高等数学 / 线性代数",
        classroom: "A101 / A102",
        startTime: "08:00",
        remindMinutes: 15,
        conflictCount: 2,
        endTime: "09:40",
        endAt: Date.parse("2026-09-07T09:40:00+08:00"),
      },
    ])

    // Bare undated week never fabricates week 1
    expect(computeClassAlarms(sampleCourses, null, samplePeriods, 7, undefined, 15, now)).toEqual(
      []
    )
    expect(
      computeClassAlarms(
        sampleCourses,
        { week: 1, weekday: 1 },
        samplePeriods,
        7,
        undefined,
        15,
        now
      )
    ).toEqual([])

    // Geolocation via native.geolocation@1
    const nativeWithGeo = createNativeService({
      isNative: () => true,
      loadCapabilities: async () => [],
      capabilities: {
        list: () => [{ id: "native.geolocation", version: 1, methods: ["getCurrentPosition"] }],
        has: (id) => id === NATIVE_GEOLOCATION_CAPABILITY,
        acquire: async () => async () => {},
        invoke: (async () => ({
          coords: { latitude: 39.9087, longitude: 119.5321, accuracy: 8.5 },
        })) as never,
      },
    })
    await expect(
      resolveGeolocationCoordinates(nativeWithGeo, {
        required: true,
        loadCapabilities: async () => [],
      })
    ).resolves.toEqual({
      latitude: 39.9087,
      longitude: 119.5321,
      accuracy: 8.5,
    })
  })

  it("syncs alarms & schedule/tomorrow widgets, guards post-logout permission races, and cleans up on channel disable, logout, and plugin dispose", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const local = createMemoryStorage()
    const secure = createMemoryStorage()
    const runtime = new PluginRuntime()
    runtime.context.set("storage", new NamespacedStorageService({ local, secure }))
    runtime.context.set("http", new StatelessHttpService())
    runtime.context.set("assets", { url: (path) => `/${path}` })

    let permissionGranted = true
    let exactAlarmGranted = true
    let scheduledAlarms: unknown[] = []
    let alarmCancelCalls = 0
    const widgetUpdates = new Map<string, { snapshot: unknown; settings: unknown }>()
    const widgetClears: string[] = []
    const pinnedWidgets: string[] = []

    const requestPermissionsMock = vi.fn(async () => ({ granted: permissionGranted }))

    const invoke = vi.fn(async (id: string, method: string, payload?: Record<string, unknown>) => {
      if (id === NOTIFICATIONS_CORE_CAPABILITY) {
        if (method === "checkPermissions") return { granted: permissionGranted }
        if (method === "requestPermissions") return requestPermissionsMock()
        if (method === "checkExactAlarmPermission") return { granted: exactAlarmGranted }
        if (method === "requestExactAlarmPermission") return { granted: exactAlarmGranted }
        if (method === "cancelAll") return { cancelled: true }
      }
      if (id === REMINDERS_CLASSES_CAPABILITY) {
        if (method === "schedule") {
          scheduledAlarms = Array.isArray(payload?.alarms) ? payload.alarms : []
          return { scheduled: scheduledAlarms.length }
        }
        if (method === "cancel" || method === "cancelAll") {
          scheduledAlarms = []
          alarmCancelCalls += 1
          return { cancelled: true }
        }
      }
      if (id === WIDGETS_GENERIC_CAPABILITY) {
        if (method === "update") {
          const widget = String(payload?.widget ?? "")
          widgetUpdates.set(widget, {
            snapshot: payload?.snapshot,
            settings: payload?.settings,
          })
          return null
        }
        if (method === "settings") {
          const widget = String(payload?.widget ?? "")
          const existing = widgetUpdates.get(widget)
          if (existing) {
            widgetUpdates.set(widget, { ...existing, settings: payload?.settings })
          }
          return null
        }
        if (method === "clear") {
          widgetClears.push(String(payload?.widget ?? "*"))
          widgetUpdates.delete(String(payload?.widget ?? ""))
          return null
        }
        if (method === "pin") {
          pinnedWidgets.push(String(payload?.widget ?? ""))
          return { added: true }
        }
      }
      if (id === NATIVE_GEOLOCATION_CAPABILITY && method === "getCurrentPosition") {
        return { coords: { latitude: 39.9, longitude: 119.5, accuracy: 5 } }
      }
      return {}
    })

    const nativeService = createNativeService({
      isNative: () => true,
      loadCapabilities: async () => [],
      capabilities: {
        list: () => [
          { id: "notifications.core", version: 1, methods: [] },
          { id: "reminders.classes", version: 1, methods: ["schedule", "cancel"] },
          { id: "widgets.generic", version: 1, methods: ["update", "settings", "clear", "pin"] },
          { id: "widgets.schedule", version: 1, methods: ["sync", "settings", "clear"] },
          { id: "native.geolocation", version: 1, methods: ["getCurrentPosition"] },
        ],
        has: () => true,
        acquire: async () => async () => {},
        invoke: invoke as never,
      },
    })
    runtime.context.set("native", nativeService)

    const doStudentSign = vi.fn(async () => ({
      signStatus: 1,
      attendanceStatus: 1,
      signOrder: 5,
      signinType: 4,
    }))

    const schoolProvider: SchoolProvider = defineSchoolProvider({
      id: "ysu",
      name: "燕山大学",
      timeZone: "Asia/Shanghai",
      slices: {
        timetable: {
          getSchedule: async () => sampleCourses,
          getCurrentWeek: async () => sampleWeek,
          getTermCalendar: async () => sampleCalendar,
          getClassPeriods: async () => samplePeriods,
          scheduleRules: { timeZone: "Asia/Shanghai", lunchAfter: 4, dinnerAfter: 8 },
          mobile: {
            getCurrentLesson: async () => ({
              lessonId: "LESSON-1",
              activityList: [
                {
                  activityId: "ACT-1",
                  type: 1,
                  status: 1,
                  title: "签到",
                  icon: null,
                  signType: "4",
                  signClazz: "1",
                  isEnd: false,
                  isCreator: false,
                  createTime: "2026-09-07 08:01:00",
                },
              ],
            }),
            getSigninDetail: async () => ({
              activityId: "ACT-1",
              duration: 300,
              endTime: "2026-09-07 08:10:00",
              leftSeconds: 180,
              signinType: 4,
              startTime: "2026-09-07 08:00:00",
            }),
            getStudentSigninStatus: async () => ({
              signStatus: 0,
              attendanceStatus: 0,
              signOrder: 0,
              signinType: 4,
            }),
            doStudentSign,
          },
        },
        exams: {
          getExams: async () => sampleExams,
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

    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date("2026-09-07T07:30:00+08:00"))

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
      providersPlugin,
      overviewPlugin,
      notificationsPlugin,
      schedulePlugin,
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
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const settings = runtime.context.get("settings") as PluginSettingsRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const router = runtime.context.get("router")!
    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!
    const notifications = runtime.context.get("notifications")!
    const overview = runtime.context.get("overview")!
    const query = runtime.context.get("query")!

    slots.declare({ name: "settings.startupOptions", kind: "list" })
    slots.declare({ name: "shell.header.actions", kind: "list" })

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({
      schoolId: "ysu",
      credential: "ticket",
      username: "20240001",
    })
    await providerRuntime.initialize()

    // Verify notification channel, overview widgets, settings category, and slot registrations
    expect(notifications.getSnapshot().map((c) => [c.id, c.pluginId, c.slice])).toContainEqual([
      "schedule",
      SCHEDULE_PLUGIN_ID,
      "timetable",
    ])
    expect(overview.getSnapshot().map((w) => [w.id, w.pluginId, w.order])).toEqual(
      expect.arrayContaining([
        ["course-progress", SCHEDULE_PLUGIN_ID, 40],
        ["today-courses", SCHEDULE_PLUGIN_ID, 50],
      ])
    )

    const widgetsCategory = settings.getSnapshot().find((c) => c.id === "widgets")!
    expect(widgetsCategory).toBeDefined()
    expect(widgetsCategory.order).toBe(40)
    expect(
      slots.select("settings.startupOptions").some((s) => s.pluginId === SCHEDULE_PLUGIN_ID)
    ).toBe(true)
    expect(slots.select("settings.widgets").some((s) => s.pluginId === SCHEDULE_PLUGIN_ID)).toBe(
      true
    )
    expect(
      slots
        .select("settings.notifications.reminders")
        .some((s) => s.pluginId === SCHEDULE_PLUGIN_ID)
    ).toBe(true)
    expect(
      slots.select("shell.header.actions").some((s) => s.pluginId === SCHEDULE_PLUGIN_ID)
    ).toBe(true)

    // Home-screen widgets ("schedule" and "tomorrow") automatically synced from default query sources!
    await vi.waitFor(() => {
      expect(widgetUpdates.has("schedule")).toBe(true)
      expect(widgetUpdates.has("tomorrow")).toBe(true)
    })

    expect(query.policy("schedule")).toEqual({ ttl: LONG_TTL_MS, persist: true })
    expect(query.policy("current-week")).toEqual({ ttl: SHORT_TTL_MS, persist: true })
    expect(query.policy("class-periods")).toEqual({ ttl: LONG_TTL_MS, persist: true })
    expect(query.policy("term-calendar")).toEqual({ ttl: LONG_TTL_MS, persist: true })
    // Exams query policy belongs to orahako.exams, not orahako.schedule.
    expect(query.policy("exams")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })

    // Enable class reminders via plugin settings store -> schedules native alarms on reminders.classes@1
    const scheduleStore = widgetsCategory.store as ScheduleSettingsStoreInstance
    await vi.waitFor(() => expect(scheduleStore.hydrated.getSnapshot()).toBe(true))
    await act(async () => {
      scheduleStore.actions.setClassReminderEnabled(true)
      scheduleStore.actions.setClassLiveUpdateEnabled(true)
      scheduleStore.actions.setClassVibrationEnabled(true)
    })

    await vi.waitFor(() => {
      expect(scheduledAlarms.length).toBeGreaterThanOrEqual(1)
      expect(scheduledAlarms[0]).toMatchObject({
        courseName: "高等数学",
        classroom: "A101",
        liveUpdateEnabled: true,
        vibrationEnabled: true,
      })
    })

    // External exam source registered onto ctx.schedule renders on SchedulePage
    const examEntries = createObservableSource<readonly ScheduleEntry[]>([
      {
        id: "exam:english-placement",
        sourceId: "exams",
        sourcePluginId: "orahako.exams",
        category: "exam",
        title: "英语分级考",
        location: "西区301",
        date: "2026-09-09",
        weekDay: 3,
        time: { startMinute: 9 * 60, endMinute: 11 * 60 },
      },
    ])
    const unregisterExamSource = runtime.context.get("schedule")!.registerSource({
      id: "exams",
      order: 40,
      category: "exam",
      entries: examEntries,
    })

    // Render SchedulePage + OverviewPage + Settings panels cleanly
    const schedulePage = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === SCHEDULE_PLUGIN_ID && p.id === "index")!
    expect(schedulePage.route).toBe("schedule")
    expect(schedulePage.primary).toBe(true)
    expect(schedulePage.fullscreen).toBeUndefined()
    expect(schedulePage.title).toBe("日程")
    expect(schedulePage.titleKey).toBe("navTitle")

    await act(async () => {
      router.push({ route: "schedule" })
    })
    await dom.render(<ContributionOutlet entry={schedulePage} slots={slots} i18n={i18n} />)
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("高等数学")
      expect(dom.container.textContent).toContain("英语分级考")
      expect(dom.container.textContent).toContain("日程查询")
    })
    unregisterExamSource()

    // Schedule stays decoupled from school-schedule and free-rooms plugins
    await dom.render(<ContributionOutlet entry={schedulePage} slots={slots} i18n={i18n} />)
    expect(dom.container.textContent).not.toContain("全校课表")
    expect(dom.container.textContent).not.toContain("查空教室")

    const viewStore = schedulePage.store as ScheduleViewStoreInstance
    await act(async () => {
      viewStore.actions.setShowOriginal(true)
      router.back()
    })
    expect(viewStore.source.getSnapshot().showOriginal).toBe(false)
    expect(router.current.getSnapshot().route).toBe("schedule")

    await act(async () => {
      router.push({ route: "student-info" })
      router.back()
    })
    expect(router.current.getSnapshot().route).toBe("schedule")

    // Verify mobileBridge sign-in executes location sign-in via native.geolocation@1 -> doStudentSign
    const injectedPage = schedulePage.inject!(runtime.context) as {
      mobileBridge: {
        getCurrentLesson: (q: {
          teachClassId: string
          teachClassType: string
          scheduleId: string
          week: number
          weekDay: number
          startNode: number
          endNode: number
        }) => Promise<{ lessonId: string | null; activityList: Array<{ activityId: string }> }>
        signIn: (input: { activityId: string; requireLocation?: boolean }) => Promise<{
          signOrder: number
          signStatus: number
        }>
      }
    }
    const lesson = await injectedPage.mobileBridge.getCurrentLesson({
      teachClassId: "CLS-1",
      teachClassType: "1",
      scheduleId: "SCH-1",
      week: 1,
      weekDay: 1,
      startNode: 1,
      endNode: 2,
    })
    expect(lesson.activityList[0]?.activityId).toBe("ACT-1")
    const signRes = await injectedPage.mobileBridge.signIn({
      activityId: "ACT-1",
      requireLocation: true,
    })
    expect(signRes.signOrder).toBe(5)
    expect(doStudentSign).toHaveBeenCalledWith({
      activityId: "ACT-1",
      latitude: 39.9,
      longitude: 119.5,
      accuracy: 5,
    })

    // Verify widget pinning via ScheduleWidgetsCategoryInject
    const injectedWidgetsCat = widgetsCategory.inject!(runtime.context) as {
      requestPinWidget: (w: "schedule" | "tomorrow") => Promise<boolean>
    }
    await expect(injectedWidgetsCat.requestPinWidget("schedule")).resolves.toBe(true)
    await expect(injectedWidgetsCat.requestPinWidget("tomorrow")).resolves.toBe(true)
    expect(pinnedWidgets).toEqual(["schedule", "tomorrow"])

    // Header actions render on schedule route and hide on non-schedule route
    const headerActionEntry = slots
      .select("shell.header.actions")
      .find((s) => s.pluginId === SCHEDULE_PLUGIN_ID)!
    await dom.render(<ContributionOutlet entry={headerActionEntry} slots={slots} i18n={i18n} />)
    expect(dom.container.textContent).toContain("第1周")
    await act(async () => {
      router.push({ route: "overview" })
    })
    await vi.waitFor(() => expect(dom.container.textContent).not.toContain("第1周"))

    // Render OverviewPage with CourseProgressWidget ("下一节") and TodayCoursesWidget ("今日课程")
    const overviewPage = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === OVERVIEW_PLUGIN_ID && p.id === "index")!
    await dom.render(<ContributionOutlet entry={overviewPage} slots={slots} i18n={i18n} />)
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("下一节")
      expect(dom.container.textContent).toContain("今日课程")
      expect(dom.container.textContent).toContain("高等数学")
    })

    // Render widgets category panel, reminder settings, startup option, and widget assistant settings
    const widgetsHtml = renderToStaticMarkup(
      <ContributionOutlet entry={widgetsCategory} slots={slots} i18n={i18n} />
    )
    expect(widgetsHtml).toContain("添加小组件")
    expect(widgetsHtml).toContain("日程页小组件助手")
    expect(widgetsHtml).toContain("/widgets/buro.png")
    expect(widgetsHtml).not.toContain("data-widget-pin-card")

    await act(async () => {
      router.push({ route: "settings-category", params: { category: "widgets", expand: "add" } })
    })
    const expandedWidgetsHtml = renderToStaticMarkup(
      <ContributionOutlet entry={widgetsCategory} slots={slots} i18n={i18n} />
    )
    expect(expandedWidgetsHtml).toContain("今日课表")
    expect(expandedWidgetsHtml).toContain("明日课表")
    expect(expandedWidgetsHtml.match(/src="\/widgets\/schedule\.png"/g)).toHaveLength(2)
    expect(expandedWidgetsHtml).toContain("日程页小组件助手")
    expect(expandedWidgetsHtml).toContain("手动添加")

    const reminderSlotEntry = slots
      .select("settings.notifications.reminders")
      .find((s) => s.pluginId === SCHEDULE_PLUGIN_ID)!
    const reminderHtml = renderToStaticMarkup(
      <ContributionOutlet entry={reminderSlotEntry} slots={slots} i18n={i18n} />
    )
    expect(reminderHtml).toContain("开启上课提醒")
    expect(reminderHtml).toContain("提前提醒时间")

    // Disabling "schedule" channel via notifications store triggers onDisable -> cancels alarms & clears schedule/tomorrow widgets
    widgetClears.length = 0
    const notifCategory = settings.getSnapshot().find((c) => c.id === "notifications")!
    const notifStore = notifCategory.store as {
      actions: { setChannelEnabled(id: string, enabled: boolean): void }
    }
    await act(async () => {
      notifStore.actions.setChannelEnabled("schedule", false)
    })

    await vi.waitFor(() => {
      expect(scheduledAlarms).toEqual([])
      expect(widgetClears).toEqual(expect.arrayContaining(["schedule", "tomorrow"]))
    })

    // Unrelated reminder setting changes must not bypass the disabled channel
    await act(async () => {
      scheduleStore.actions.setClassReminderMinutes(5)
    })
    expect(scheduledAlarms).toEqual([])
    expect(widgetUpdates.has("schedule")).toBe(false)

    // Re-enabling the channel rebuilds alarms and widgets from current data
    await act(async () => {
      notifStore.actions.setChannelEnabled("schedule", true)
    })
    await vi.waitFor(() => {
      expect(scheduledAlarms.length).toBeGreaterThanOrEqual(1)
      expect(widgetUpdates.has("schedule")).toBe(true)
      expect(widgetUpdates.has("tomorrow")).toBe(true)
    })

    // Standalone controller race test: permission prompt completing after logout returns false
    permissionGranted = false
    const deferredPerm = Promise.withResolvers<{ granted: boolean }>()
    requestPermissionsMock.mockReturnValueOnce(deferredPerm.promise)
    const standaloneSettings = scheduleSettingsStore.create()
    const standalonePatches = schedulePatchesStore.create()
    const standaloneController = new ClassReminderAndWidgetController({
      pluginId: SCHEDULE_PLUGIN_ID,
      settingsStore: standaloneSettings,
      patchesStore: standalonePatches,
      provider: providerRuntime,
      session,
      native: nativeService,
      widgets: runtime.context.get("widgets")!,
      loadCapabilities: async () => [],
    })
    const enablePromise = standaloneController.setClassReminderEnabled(true)
    await Promise.resolve()
    await act(async () => {
      session.clearCredential("ysu")
    })
    deferredPerm.resolve({ granted: true })
    expect(await enablePromise).toBe(false)
    expect(standaloneSettings.source.getSnapshot().classReminderEnabled).toBe(false)
    await standaloneController.dispose()
    standaloneSettings.dispose()
    standalonePatches.dispose()

    // Stopping schedulePlugin cancels class alarms, clears widgets, and removes all UI/slot/overview/settings contributions
    widgetClears.length = 0
    const prevCancels = alarmCancelCalls
    await act(async () => {
      runtime.stop(SCHEDULE_PLUGIN_ID)
    })

    await vi.waitFor(() => {
      expect(alarmCancelCalls).toBeGreaterThan(prevCancels)
      expect(widgetClears).toEqual(expect.arrayContaining(["schedule", "tomorrow"]))
    })
    expect(ui.getSnapshot().pages.filter((p) => p.pluginId === SCHEDULE_PLUGIN_ID)).toEqual([])
    expect(overview.getSnapshot().filter((w) => w.pluginId === SCHEDULE_PLUGIN_ID)).toEqual([])
    expect(settings.getSnapshot().filter((c) => c.pluginId === SCHEDULE_PLUGIN_ID)).toEqual([])
    expect(notifications.getSnapshot().filter((c) => c.pluginId === SCHEDULE_PLUGIN_ID)).toEqual([])
    expect(
      slots.select("settings.startupOptions").filter((s) => s.pluginId === SCHEDULE_PLUGIN_ID)
    ).toEqual([])
    expect(
      slots.select("settings.widgets").filter((s) => s.pluginId === SCHEDULE_PLUGIN_ID)
    ).toEqual([])
    expect(
      slots
        .select("settings.notifications.reminders")
        .filter((s) => s.pluginId === SCHEDULE_PLUGIN_ID)
    ).toEqual([])
    expect(
      slots.select("shell.header.actions").filter((s) => s.pluginId === SCHEDULE_PLUGIN_ID)
    ).toEqual([])

    exactAlarmGranted = false
    void pinnedWidgets
    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })

  it("renders CourseActivityModal, CourseSigninModal, ScheduleAdjustmentDialog, ScheduleAdjustmentsDialog, and WidgetDiscovery interactively", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const i18nRuntime = new PluginRuntime()
    i18nRuntime.register(i18nRegistryPlugin, "builtin")
    i18nRuntime.start(i18nRegistryPlugin.manifest.id)
    const i18n = i18nRuntime.context.get("i18n")!
    const t = i18n.translator(scheduleDictionary)

    const bridge: MobileLessonBridge = {
      hasMobileSupport: () => true,
      getCurrentLesson: async () => ({
        lessonId: "L-100",
        activityList: [
          {
            activityId: "ACT-OTP",
            type: 1,
            status: 1,
            title: "课堂签到",
            icon: null,
            signType: "2",
            signClazz: "1",
            isEnd: false,
            isCreator: false,
            createTime: "2026-09-07T08:05:00",
          },
          {
            activityId: "ACT-OUT",
            type: 1,
            status: 2,
            title: "课堂签退",
            icon: null,
            signType: "1",
            signClazz: "2",
            isEnd: true,
            isCreator: false,
            createTime: "2026-09-07T09:40:00",
          },
        ],
      }),
      getSigninContext: async () => ({
        detail: {
          activityId: "ACT-OTP",
          duration: 180,
          endTime: "2026-09-07 08:10:00",
          leftSeconds: 120,
          signinType: 2,
          startTime: "2026-09-07 08:05:00",
        },
        status: {
          signStatus: 0,
          attendanceStatus: 0,
          signOrder: 0,
          signinType: 2,
        },
      }),
      signIn: async () => ({
        signStatus: 1,
        attendanceStatus: 1,
        signOrder: 3,
        signinType: 2,
      }),
    }

    const occurrences = expandScheduleCourses(sampleCourses, "2026-09-07", 20)
    const firstOccurrence = occurrences[0]!
    const samplePatch = createValidatedSchedulePatch({
      draft: {
        kind: "course",
        mode: "move",
        sourceDate: "2026-09-07",
        targetDate: "2026-09-09",
        targetStartSection: 1,
        note: "Makeup lesson",
        source: [firstOccurrence],
        replaced: [],
        dependsOn: [],
      },
      stored: [],
      rawCourses: sampleCourses,
      termStartDate: "2026-09-07",
      totalWeeks: 20,
      generateId: () => "patch-ui-1",
    })

    await dom.render(
      <div>
        <CourseActivityModal
          course={sampleCourses[0]!}
          week={1}
          open={true}
          mobileBridge={bridge}
          t={t}
          onOpenChange={() => {}}
        />
        <CourseSigninModal
          activityId="ACT-OTP"
          signinType={2}
          open={true}
          mobileBridge={bridge}
          t={t}
          onOpenChange={() => {}}
        />
        <ScheduleAdjustmentDialog
          drop={{
            selection: {
              kind: "course",
              date: "2026-09-07",
              courses: [firstOccurrence],
            },
            targetDate: "2026-09-09",
            targetStartSection: 1,
          }}
          courses={occurrences}
          periods={samplePeriods}
          termStartDate="2026-09-07"
          totalWeeks={20}
          t={t}
          onClose={() => {}}
          onSave={() => {}}
        />
        <ScheduleAdjustmentsDialog
          view={{ kind: "manager", selectedPatchId: "patch-ui-1" }}
          patches={[samplePatch]}
          issues={[]}
          t={t}
          onClose={() => {}}
          onConfirm={() => {}}
          onRemove={() => {}}
          onToggle={() => {}}
          onJump={() => {}}
          onShowOriginal={() => {}}
        />
        <WidgetDiscovery
          isNative={true}
          hidden={false}
          position={{ x: 0.85, y: 0.8 }}
          assistantSrc="/widgets/buro.png"
          widgetsSettingsHref="/?plugin=orahako.settings&page=category&category=widgets"
          t={t}
          onSetHidden={() => {}}
          onSetPosition={() => {}}
          onRequestPinSchedule={async () => true}
          onOpenWidgetsSettings={() => {}}
        />
      </div>
    )

    await vi.waitFor(() => {
      const fullText = dom.body.textContent
      expect(fullText).toContain("课堂签到")
      expect(fullText).toContain("课堂签退")
      expect(fullText).toContain("请输入 4 位数字签到码")
      expect(fullText).toContain("调整单次课程")
      expect(fullText).toContain("Makeup lesson")
    })

    const triggerBtn = dom.body.findAll((node) =>
      node.hasAttribute("data-widget-discovery-trigger")
    )[0]
    expect(triggerBtn).toBeDefined()
    expect(triggerBtn!.parentNode?.parentNode).toBe(dom.body)

    const assistantAvatar = dom.body.findAll((node) =>
      node.hasAttribute("data-widget-assistant-avatar")
    )[0]
    expect(assistantAvatar).toBeDefined()
    expect(assistantAvatar!.getAttribute("src")).toBe("/widgets/buro.png")

    // The detail box carries teacher/classroom/weeks/sections, so the header must not repeat them.
    expect(dom.body.textContent).not.toContain("张老师 · A101")
    expect(dom.body.textContent).toContain("1-16周")

    activeUnmount = undefined
    await dom.unmount()
    i18nRuntime.dispose()
  })

  it("boots standalone with ZERO academic services, exposes open ScheduleService + slots, and supports personal/external sources + remindable free-time alarms", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const externalEntries = createObservableSource<readonly ScheduleEntry[]>([
      {
        id: "club:weekly-sync",
        sourceId: "club-calendar",
        sourcePluginId: "community.club",
        category: "personal",
        title: "开源社团例会",
        location: "活动中心 302",
        weekDay: 3,
        time: { startMinute: 19 * 60 + 30, endMinute: 21 * 60 },
        remindable: true,
        badge: "社团",
      },
    ])

    const communityCalendarPlugin = definePlugin({
      manifest: {
        id: "community.club",
        name: "Community Club Calendar",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        providerIndependent: true,
      },
      inject: ["slots"] as const,
      optionalInject: ["schedule"] as const,
      apply(ctx) {
        ctx.schedule?.registerSource({
          id: "club-calendar",
          order: 50,
          category: "personal",
          entries: externalEntries,
        })
        ctx.slots.inject("schedule.toolbar.actions", () =>
          ctx.slots.register({ id: "club-sync-btn", slot: "schedule.toolbar.actions" }, () => (
            <button type="button">CLUB_TOOLBAR_ACTION</button>
          ))
        )
        ctx.slots.inject("schedule.entry.detail", () =>
          ctx.slots.register({ id: "club-detail-ext", slot: "schedule.entry.detail" }, (props) => (
            <div>CLUB_DETAIL:{props.entry.title}</div>
          ))
        )
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
    runtime.context.set("native", createNativeService({ isNative: () => false }))
    runtime.context.set("assets", { url: (p: string) => `/assets/${p}` })

    // Boot ONLY universal platform runtime plugins + schedulePlugin + communityCalendarPlugin
    // ZERO academic services (no provider, no session, no query, no notifications, no overview)!
    for (const plugin of [
      slotRegistryPlugin,
      uiRegistryPlugin,
      settingsRegistryPlugin,
      i18nRegistryPlugin,
      routerRuntimePlugin,
      navigationRuntimePlugin,
      widgetRuntimePlugin,
      schedulePlugin,
      communityCalendarPlugin,
    ]) {
      runtime.register(plugin, "builtin")
      runtime.start(plugin.manifest.id)
    }

    expect(runtime.context.get("provider")).toBeUndefined()
    expect(runtime.context.get("session")).toBeUndefined()
    expect(runtime.context.get("query")).toBeUndefined()

    const scheduleService = runtime.context.get("schedule")!
    expect(scheduleService).toBeDefined()
    expect(scheduleService.getSources().map((s) => s.scopedId)).toEqual([
      "orahako.schedule:personal",
      "community.club:club-calendar",
    ])
    expect(scheduleService.getEffectiveSnapshot().entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "开源社团例会" })])
    )
    expect(scheduleService.getEffectiveSnapshot().allEntries).toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "开源社团例会" })])
    )
    await expect(scheduleService.refresh()).resolves.toBeUndefined()

    // Render SchedulePage standalone: external source & toolbar slot render cleanly!
    const ui = runtime.context.get("ui")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const schedulePage = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === SCHEDULE_PLUGIN_ID && p.id === "index")!
    expect(schedulePage.requiresProvider).toBe(false)

    await dom.render(<ContributionOutlet entry={schedulePage} slots={slots} i18n={i18n} />)
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("CLUB_TOOLBAR_ACTION")
      expect(dom.container.textContent).toContain("开源社团例会")
      expect(dom.container.textContent).toContain("新建")
      expect(dom.container.textContent).toContain("管理")
    })

    // Free-time remindable entries generate exact-minute alarms even alongside courses
    const extraAlarms = computeClassAlarms(
      [],
      null,
      samplePeriods,
      7,
      undefined,
      15,
      new Date("2026-09-09T09:00:00+08:00"),
      "Asia/Shanghai",
      scheduleService.getEffectiveSnapshot().entries
    )
    expect(extraAlarms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          courseName: "开源社团例会",
          classroom: "活动中心 302",
          startTime: "19:30",
          endTime: "21:00",
        }),
      ])
    )

    // Stopping the community plugin automatically unregisters its source and UI slots!
    await act(async () => {
      runtime.stop("community.club")
    })
    expect(scheduleService.getSources().map((s) => s.scopedId)).toEqual([
      "orahako.schedule:personal",
    ])
    expect(scheduleService.getEffectiveSnapshot().entries).toEqual([])
    expect(slots.select("schedule.toolbar.actions")).toEqual([])
    expect(slots.select("schedule.entry.detail")).toEqual([])

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
