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
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}))

import {
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
} from "@orahako/academic-runtime"
import {
  defineSchoolProvider,
  type MakeupExamCourse,
  type MakeupExamSignupInput,
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
  validatePluginManifest,
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import * as makeupPublic from "../src"
import { MAKEUP_EXAMS_PLUGIN_ID, makeupExamsPlugin } from "../src"

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

describe("@orahako/plugin-makeup-exams export discipline, signup & navigation", () => {
  it("enforces strict public export discipline and valid feature manifest", () => {
    expect(Object.keys(makeupPublic).sort()).toEqual(
      ["MAKEUP_EXAMS_PLUGIN_ID", "default", "makeupExamsPlugin"].sort()
    )
    expect(makeupPublic.default).toBe(makeupExamsPlugin)
    expect(validatePluginManifest(makeupExamsPlugin.manifest)).toStrictEqual(
      makeupExamsPlugin.manifest
    )
    expect(makeupExamsPlugin.manifest.id).toBe("orahako.makeup-exams")
    expect(makeupExamsPlugin.manifest.kind).toBe("feature")
    expect(makeupExamsPlugin.manifest.inject).toEqual([
      "ui",
      "i18n",
      "provider",
      "session",
      "query",
    ])
  })

  it("registers index page & academic navigation (order 35), queries batches/courses, executes signup & refreshes state", async () => {
    const dom = mountInteractiveDom()
    activeUnmount = dom.unmount

    const runtime = new PluginRuntime()
    runtime.context.set(
      "storage",
      new NamespacedStorageService({
        local: createMemoryStorage(),
        secure: createMemoryStorage(),
      })
    )
    runtime.context.set("http", new StatelessHttpService())

    let signedUp = false
    const signupCalls: MakeupExamSignupInput[] = []

    const availableCourse: MakeupExamCourse = {
      name: "复变函数",
      code: "MATH205",
      credit: "3",
      hours: "48",
      department: "理学院",
      status: "可报名",
      isAvailable: true,
      signupStart: "2026-09-01T08:00:00",
      signupEnd: "2026-09-05T18:00:00",
      batchId: "batch-2026-fall",
      taskId: "task-complex-1",
      note: "请按时参加",
    }

    const makeupSchool: SchoolProvider = defineSchoolProvider({
      id: "makeup-school",
      name: "补考测试大学",
      slices: {
        makeupExams: {
          getMakeupExamBatches: async () => [
            {
              name: "2026秋季期初补考",
              batchId: "batch-2026-fall",
              term: "2026-2027-1",
              signupStart: "2026-09-01T08:00:00",
              signupEnd: "2026-09-05T18:00:00",
              availableCount: signedUp ? 0 : 1,
              registeredCount: signedUp ? 1 : 0,
            },
          ],
          getMakeupExamCourses: async (opts) => {
            if (opts?.batchId !== "batch-2026-fall") return []
            if (opts.registered) {
              return signedUp ? [{ ...availableCourse, status: "已报名" }] : []
            }
            return signedUp ? [] : [availableCourse]
          },
          signupMakeupExam: async (input) => {
            signupCalls.push(input)
            signedUp = true
          },
        },
      },
      async initialize() {},
      async reset() {},
      async logout() {},
      async relogin() {
        return true
      },
    })

    const schoolPlugin = definePlugin({
      manifest: {
        id: "test.makeup-school",
        name: "Makeup School",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["providers"],
      },
      inject: ["providers"] as const,
      apply(ctx) {
        ctx.providers.registerProvider("makeup-school", () => makeupSchool)
      },
    })

    for (const p of [
      slotRegistryPlugin,
      uiRegistryPlugin,
      i18nRegistryPlugin,
      providerRegistryRuntimePlugin,
      sessionRuntimePlugin,
      providerRuntimePlugin,
      queryRuntimePlugin,
      schoolPlugin,
      makeupExamsPlugin,
    ]) {
      if (
        p.manifest.id === sessionRuntimePlugin.manifest.id ||
        p.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(p, "builtin", { defaultSchoolId: "makeup-school" })
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

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({
      schoolId: "makeup-school",
      credential: "ticket-mk",
      username: "20260003",
    })
    await providerRuntime.initialize()

    const page = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === MAKEUP_EXAMS_PLUGIN_ID && p.id === "index")!
    expect(page).toMatchObject({
      route: "makeup-exams",
      capability: "makeupExams",
    })

    const nav = ui
      .getSnapshot()
      .navigation.find((n) => n.pluginId === MAKEUP_EXAMS_PLUGIN_ID && n.id === "makeup-exams")!
    expect(nav).toMatchObject({
      page: "index",
      group: "academic",
      order: 35,
      capability: "makeupExams",
    })

    await dom.render(
      <ContributionOutlet
        entry={page}
        slots={slots}
        i18n={i18n}
        onError={(err) => {
          throw err
        }}
      />
    )

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("2026秋季期初补考")
      expect(dom.container.textContent).toContain("可报名 1 门")
      expect(dom.container.textContent).toContain("复变函数")
    })

    // Click signup button -> opens confirmation dialog -> confirm signup -> refreshes batches & courses
    const signupTrigger = dom.container.findAll(
      (n) => n.getAttribute("data-makeup-signup-trigger") === "task-complex-1"
    )[0]!
    expect(signupTrigger).toBeDefined()
    await act(async () => {
      const onClick = getReactProps(signupTrigger).onClick
      if (typeof onClick === "function") onClick({ preventDefault() {} })
    })

    await vi.waitFor(() => {
      expect(dom.bodyEl.textContent).toContain("确认报名")
      expect(dom.bodyEl.textContent).toContain("确定要报名《复变函数》的补考吗")
    })

    const confirmBtn = dom.bodyEl.findAll((n) => n.attributes.has("data-makeup-signup-confirm"))[0]!
    expect(confirmBtn).toBeDefined()
    await act(async () => {
      const onClick = getReactProps(confirmBtn).onClick
      if (typeof onClick === "function") onClick({ preventDefault() {} })
    })

    await vi.waitFor(() => {
      expect(signupCalls).toEqual([
        {
          taskId: "task-complex-1",
          batchId: "batch-2026-fall",
        },
      ])
      expect(dom.container.textContent).toContain("可报名 0 门")
      expect(dom.container.textContent).toContain("已报名 1 门")
      expect(dom.container.textContent).toContain("暂无可报名课程")
    })

    // Switch locale to English and verify bilingual rendering
    await act(async () => {
      i18n.setLocale("en")
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("No courses available for signup")
      expect(dom.container.textContent).toContain("1 registered")
    })

    // Stopping plugin removes page and navigation
    await act(async () => {
      runtime.stop(MAKEUP_EXAMS_PLUGIN_ID)
    })
    expect(ui.getSnapshot().pages.filter((p) => p.pluginId === MAKEUP_EXAMS_PLUGIN_ID)).toEqual([])
    expect(
      ui.getSnapshot().navigation.filter((n) => n.pluginId === MAKEUP_EXAMS_PLUGIN_ID)
    ).toEqual([])

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
