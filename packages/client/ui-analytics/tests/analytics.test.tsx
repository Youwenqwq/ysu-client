import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const capacitorMocks = vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>
  if (!g.window) {
    g.window = {}
  }
  if (!g.document) {
    const stubHead = { appendChild() {} }
    g.document = {
      head: stubHead,
      getElementsByTagName: () => [stubHead],
      createElement: () => ({ appendChild() {}, setAttribute() {}, style: {} }),
      createTextNode: () => ({}),
    }
  }
  return {
    isNative: false,
  }
})

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => capacitorMocks.isNative,
  },
  registerPlugin: () => ({}),
}))

import { PluginRuntime } from "@orahako/kernel"
import { PluginI18nRegistry } from "@orahako/runtime-i18n"
import { ContributionOutlet, PluginSlotRegistry } from "@orahako/runtime-slots"
import { NamespacedStorageService } from "@orahako/runtime-storage"
import {
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import {
  ANALYTICS_PLUGIN_ID,
  analyticsPlugin,
  AnalyticsPrompt,
  AnalyticsSettingsToggle,
  APP_LAUNCH_DEDUPE_KEY,
  ConfiguredAnalyticsService,
  type PluginAnalyticsService,
} from "../src/index"

class MemoryKeyValueStorage implements PluginKeyValueStorage {
  readonly data = new Map<string, string>()

  async getItem(key: string): Promise<string | null> {
    return this.data.get(key) ?? null
  }

  async setItem(key: string, value: string): Promise<void> {
    this.data.set(key, value)
  }

  async removeItem(key: string): Promise<void> {
    this.data.delete(key)
  }
}

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
  readonly style: Record<string, string> = {
    setProperty: (() => {}) as never,
    removeProperty: (() => "") as never,
    getPropertyValue: (() => "") as never,
  }
  readonly attributes = new Map<string, string>()
  private readonly listeners = new Map<string, Set<EventListenerFn>>()
  private rawText = ""

  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    if (nodeType === 1) {
      this.tagName = nodeName
    }
  }

  get isConnected(): boolean {
    return true
  }

  get children(): MiniDomNode[] {
    return this.childNodes.filter((c) => c.nodeType === 1)
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
    if (child.parentNode) {
      child.parentNode.removeChild(child)
    }
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore(child: MiniDomNode, before: MiniDomNode | null): MiniDomNode {
    if (!before) return this.appendChild(child)
    if (child.parentNode) {
      child.parentNode.removeChild(child)
    }
    const index = this.childNodes.indexOf(before)
    child.parentNode = this
    if (index >= 0) {
      this.childNodes.splice(index, 0, child)
    } else {
      this.childNodes.push(child)
    }
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
    this.attributes.set(name, String(val))
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40 }
  }

  focus(): void {}
  blur(): void {}

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

function findReactProps(node: MiniDomNode): Record<string, unknown> {
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith("__reactProps$") && typeof val === "object" && val !== null) {
      return val as Record<string, unknown>
    }
  }
  return {}
}

function mountInteractiveDom() {
  const g = globalThis as Record<string, unknown>
  const saved = {
    window: g.window,
    document: g.document,
    getComputedStyle: g.getComputedStyle,
    HTMLElement: g.HTMLElement,
    HTMLFormElement: g.HTMLFormElement,
    HTMLInputElement: g.HTMLInputElement,
    NodeFilter: g.NodeFilter,
    Element: g.Element,
    Node: g.Node,
    MutationObserver: g.MutationObserver,
    ResizeObserver: g.ResizeObserver,
    CustomEvent: g.CustomEvent,
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

  const fakeWin = {
    event: undefined,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    innerWidth: 1280,
    innerHeight: 720,
    screen: { width: 1920, height: 1080 },
    HTMLIFrameElement: class {},
    HTMLElement: MiniDomNode,
    Element: MiniDomNode,
    Node: MiniDomNode,
    document: doc,
    navigator: { userAgent: "OrahakoTestBrowser/3.0" },
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
    constructor(type: string) {
      this.type = type
    }
    preventDefault() {}
  }

  g.IS_REACT_ACT_ENVIRONMENT = true
  g.window = fakeWin
  g.document = docWithFactories
  g.getComputedStyle = fakeWin.getComputedStyle
  vi.stubGlobal("navigator", fakeWin.navigator)
  g.HTMLElement = MiniDomNode
  g.HTMLFormElement = class {}
  g.HTMLInputElement = class {}
  g.NodeFilter = { SHOW_ELEMENT: 1, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 }
  g.Element = MiniDomNode
  g.Node = MiniDomNode
  g.MutationObserver = NoopObserver
  g.ResizeObserver = NoopObserver
  g.CustomEvent = FakeCustomEvent

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
      if (vi.isFakeTimers()) {
        vi.runOnlyPendingTimers()
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) {
          delete g[k]
        } else {
          g[k] = v
        }
      }
    },
  }
}

let activeUnmount: (() => Promise<void>) | undefined

beforeEach(() => {
  capacitorMocks.isNative = false
})

afterEach(async () => {
  if (activeUnmount) {
    const fn = activeUnmount
    activeUnmount = undefined
    await fn()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("@orahako/ui-analytics", () => {
  it("validates manifest and enforces oncePerDay dedupe across synchronous concurrent calls and storage reloads", async () => {
    expect(validatePluginManifest(analyticsPlugin.manifest)).toMatchObject({
      id: ANALYTICS_PLUGIN_ID,
      apiVersion: PLUGIN_API_VERSION,
      kind: "runtime",
      provides: ["analytics"],
      providerIndependent: true,
      inject: ["slots", "i18n", "storage"],
    })

    const storage = new MemoryKeyValueStorage()
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok", { status: 200 })
    )
    let currentDay = "2026-11-18T08:00:00Z"

    const service1 = new ConfiguredAnalyticsService({
      endpoint: "https://example.com/api/stats",
      storage,
      now: () => new Date(currentDay),
      fetchImpl: fetchMock,
    })

    // Disabled & unavailable checks
    expect(await service1.track({ a: 1 }, { enabled: false })).toEqual({
      tracked: false,
      reason: "disabled",
      date: null,
    })
    const disabledEndpoint = new ConfiguredAnalyticsService({})
    expect(await disabledEndpoint.track({ a: 1 }, { enabled: true })).toEqual({
      tracked: false,
      reason: "unavailable",
      date: null,
    })

    // Synchronous concurrent calls on same dedupeKey only send 1 POST!
    const [r1, r2] = await Promise.all([
      service1.track(
        { launch: 1 },
        { enabled: true, oncePerDay: true, dedupeKey: APP_LAUNCH_DEDUPE_KEY }
      ),
      service1.track(
        { launch: 2 },
        { enabled: true, oncePerDay: true, dedupeKey: APP_LAUNCH_DEDUPE_KEY }
      ),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect([r1.reason, r2.reason]).toEqual(["sent", "duplicate"])
    expect(r1.date).toBe("2026-11-18")

    // Reload: fresh service instance reading same storage suppresses duplicate on same day
    const service2 = new ConfiguredAnalyticsService({
      endpoint: "https://example.com/api/stats",
      storage,
      now: () => new Date(currentDay),
      fetchImpl: fetchMock,
    })
    expect(
      await service2.track(
        { launch: 3 },
        { enabled: true, oncePerDay: true, dedupeKey: APP_LAUNCH_DEDUPE_KEY }
      )
    ).toEqual({
      tracked: false,
      reason: "duplicate",
      date: "2026-11-18",
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Next day sends again
    currentDay = "2026-11-19T08:00:00Z"
    expect(
      await service2.track(
        { launch: 4 },
        { enabled: true, oncePerDay: true, dedupeKey: APP_LAUNCH_DEDUPE_KEY }
      )
    ).toEqual({
      tracked: true,
      reason: "sent",
      date: "2026-11-19",
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("prompts on first run via shell.overlay, tracks launch on Agree & on consented reload, and toggles consent in settings.general via ContributionOutlet", async () => {
    const dom = mountInteractiveDom()
    activeUnmount = dom.unmount

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("ok", { status: 200 })
    )
    vi.stubGlobal("fetch", fetchMock)

    const localBackend = new MemoryKeyValueStorage()
    const secureBackend = new MemoryKeyValueStorage()
    const slots = new PluginSlotRegistry()
    slots.declare({ name: "shell.overlay", kind: "list" })
    slots.declare({ name: "settings.general", kind: "list" })
    const i18n = new PluginI18nRegistry()

    const runtime = new PluginRuntime()
    runtime.context.set("slots", slots)
    runtime.context.set("i18n", i18n)
    runtime.context.set(
      "storage",
      new NamespacedStorageService({ local: localBackend, secure: secureBackend })
    )

    try {
      runtime.register(analyticsPlugin, "builtin", {
        endpoint: "https://example.com/api/stats",
        appVersion: "3.0.0",
      })
      await runtime.startAndWait(analyticsPlugin.manifest.id)
      await Promise.resolve()
      await Promise.resolve()

      const service = runtime.context.get("analytics") as PluginAnalyticsService
      expect(service.endpoint).toBe("https://example.com/api/stats")

      const overlayEntry = slots.select("shell.overlay")[0]!
      const settingsEntry = slots.select("settings.general")[0]!
      expect(overlayEntry.component).toBe(AnalyticsPrompt)
      expect(settingsEntry.component).toBe(AnalyticsSettingsToggle)

      // No telemetry sent before user consents
      expect(fetchMock).not.toHaveBeenCalled()

      await dom.render(
        <div>
          <ContributionOutlet
            entry={overlayEntry}
            slots={slots}
            i18n={i18n}
            onError={(err) => {
              throw err
            }}
          />
          <ContributionOutlet
            entry={settingsEntry}
            slots={slots}
            i18n={i18n}
            onError={(err) => {
              throw err
            }}
          />
        </div>
      )

      // First-run AnalyticsPrompt is open in shell.overlay
      expect(dom.bodyEl.textContent).toContain("是否参与匿名使用统计")
      expect(dom.container.textContent).toContain("参与匿名统计")

      // Click Agree ("好的！") -> persists consent=true & promptVersion="3.0.0" and fires app-launch track!
      const agreeBtn = dom.bodyEl.findAll(
        (n) => n.tagName === "BUTTON" && n.textContent.includes("好的！")
      )[0]!
      expect(agreeBtn).toBeDefined()

      await act(async () => {
        const onClick = findReactProps(agreeBtn).onClick as (() => void) | undefined
        onClick?.()
        await Promise.resolve()
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [calledUrl, calledInit] = fetchMock.mock.calls[0]!
      expect(calledUrl).toBe("https://example.com/api/stats")
      expect(JSON.parse(String(calledInit?.body))).toEqual({
        version: "3.0.0",
        viewport: "1280x720",
        screen: "1920x1080",
        platform: "web",
        ua: "OrahakoTestBrowser/3.0",
      })

      const persistedConsentRaw = localBackend.data.get(
        `orahako-plugin:${ANALYTICS_PLUGIN_ID}:consent`
      )
      expect(JSON.parse(String(persistedConsentRaw))).toEqual({
        version: 1,
        state: {
          consent: true,
          promptVersion: "3.0.0",
        },
      })

      // Settings general toggle renders checked Switch ("data-checked") and toggles consent off when clicked
      const staticSettingsHtml = renderToStaticMarkup(
        <ContributionOutlet entry={settingsEntry} slots={slots} i18n={i18n} />
      )
      expect(staticSettingsHtml).toContain('data-slot="switch"')
      expect(staticSettingsHtml).not.toContain('data-slot="card"')

      const switchBtn = dom.container.findAll((n) => n.getAttribute("data-slot") === "switch")[0]!
      expect(switchBtn.getAttribute("aria-checked")).toBe("true")

      await act(async () => {
        const onClick = findReactProps(switchBtn).onClick as
          | ((e: { stopPropagation(): void; isPropagationStopped(): boolean }) => void)
          | undefined
        onClick?.({ stopPropagation() {}, isPropagationStopped: () => false })
        await Promise.resolve()
      })

      expect(switchBtn.getAttribute("aria-checked")).toBe("false")
      expect(
        JSON.parse(String(localBackend.data.get(`orahako-plugin:${ANALYTICS_PLUGIN_ID}:consent`)))
      ).toEqual({
        version: 1,
        state: {
          consent: false,
          promptVersion: "3.0.0",
        },
      })

      // Also verify startup launch tracking when promptVersion & consent=true are already persisted on boot
      localBackend.data.set(
        `orahako-plugin:${ANALYTICS_PLUGIN_ID}:consent`,
        JSON.stringify({ version: 1, state: { consent: true, promptVersion: "3.0.0" } })
      )
      // Clear dedupe key so a fresh day/launch sends telemetry
      localBackend.data.delete(
        `orahako-plugin:${ANALYTICS_PLUGIN_ID}:dedupe:${APP_LAUNCH_DEDUPE_KEY}`
      )

      await act(async () => {
        runtime.stop(analyticsPlugin.manifest.id)
        await runtime.startAndWait(analyticsPlugin.manifest.id)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)

      // Verify Decline on fresh state sets consent=false & promptVersion without sending telemetry
      localBackend.data.clear()
      await act(async () => {
        runtime.stop(analyticsPlugin.manifest.id)
        await runtime.startAndWait(analyticsPlugin.manifest.id)
        await Promise.resolve()
        await Promise.resolve()
      })
      const freshOverlay = slots.select("shell.overlay")[0]!
      await dom.render(<ContributionOutlet entry={freshOverlay} slots={slots} i18n={i18n} />)
      const declineBtn = dom.bodyEl.findAll(
        (n) => n.tagName === "BUTTON" && n.textContent.includes("还是算了")
      )[0]!
      await act(async () => {
        const onClick = findReactProps(declineBtn).onClick as (() => void) | undefined
        onClick?.()
        await Promise.resolve()
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(
        JSON.parse(String(localBackend.data.get(`orahako-plugin:${ANALYTICS_PLUGIN_ID}:consent`)))
      ).toEqual({
        version: 1,
        state: {
          consent: false,
          promptVersion: "3.0.0",
        },
      })
    } finally {
      activeUnmount = undefined
      await dom.unmount()
      runtime.dispose()
    }
  })
})
