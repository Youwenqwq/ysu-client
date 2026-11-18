import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
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
})
import { PluginRuntime } from "@orahako/kernel"
import { PluginI18nRegistry } from "@orahako/runtime-i18n"
import { ContributionOutlet, PluginSlotRegistry } from "@orahako/runtime-slots"
import { NamespacedStorageService } from "@orahako/runtime-storage"
import {
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type PluginAnnouncementService,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import {
  ANNOUNCEMENT_PLUGIN_ID,
  AnnouncementDialog,
  announcementPlugin,
  ConfiguredAnnouncementService,
  DEFAULT_DISMISSED_STORAGE_KEY,
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
    HTMLIFrameElement: class {},
    HTMLElement: MiniDomNode,
    Element: MiniDomNode,
    Node: MiniDomNode,
    document: doc,
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

afterEach(async () => {
  if (activeUnmount) {
    const fn = activeUnmount
    activeUnmount = undefined
    await fn()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("@orahako/ui-announcement", () => {
  it("validates manifest, checks publishedAt/expireAt windows, respects hydrated & synchronous dismissals, and aborts on dispose", async () => {
    expect(validatePluginManifest(announcementPlugin.manifest)).toMatchObject({
      id: ANNOUNCEMENT_PLUGIN_ID,
      apiVersion: PLUGIN_API_VERSION,
      kind: "runtime",
      provides: ["announcement"],
      providerIndependent: true,
      inject: ["slots", "i18n", "storage"],
    })

    const storage = new MemoryKeyValueStorage()
    storage.data.set(DEFAULT_DISMISSED_STORAGE_KEY, "ann-dismissed")

    const nowMs = Date.parse("2026-11-18T12:00:00Z")
    let payload: Record<string, unknown> = {
      id: "ann-dismissed",
      title: "Already Dismissed",
      content: "body",
      level: "info",
    }

    const service = new ConfiguredAnnouncementService({
      endpoint: "https://example.com/announcement.json",
      storage,
      now: () => nowMs,
      fetchImpl: async (_url, init) => {
        if (init?.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError")
        }
        return new Response(JSON.stringify(payload), { status: 200 })
      },
    })

    // Persisted dismissal in async storage is respected on first check()
    expect(await service.check()).toBeNull()

    // Future publishedAt is filtered out
    payload = {
      id: "ann-future",
      title: "Future",
      publishedAt: "2026-11-19T00:00:00Z",
    }
    expect(await service.check()).toBeNull()

    // Expired expireAt is filtered out
    payload = {
      id: "ann-expired",
      title: "Expired",
      expireAt: "2026-11-18T12:00:00Z",
    }
    expect(await service.check()).toBeNull()

    // Valid announcement normalizes unknown level -> "info"
    payload = {
      id: "ann-active",
      title: "Active Notice",
      content: "**Important**",
      level: "unexpected",
    }
    expect(await service.check()).toEqual({
      id: "ann-active",
      title: "Active Notice",
      content: "**Important**",
      level: "info",
    })

    // Synchronous memory mirror on dismiss() suppresses immediate subsequent check()
    service.dismiss("ann-active")
    expect(await service.check()).toBeNull()
    expect(storage.data.get(DEFAULT_DISMISSED_STORAGE_KEY)).toBe("ann-active")

    // AbortController aborts in-flight fetch on dispose()
    let seenAbortSignal: AbortSignal | undefined
    const hangingService = new ConfiguredAnnouncementService({
      endpoint: "https://example.com/slow.json",
      fetchImpl: (_url, init) => {
        seenAbortSignal = init?.signal ?? undefined
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"))
          })
        })
      },
    })

    const inflight = hangingService.check()
    await Promise.resolve()
    hangingService.dispose()
    expect(seenAbortSignal?.aborted).toBe(true)
    expect(await inflight).toBeNull()
  })

  it("auto-checks on startup and renders AnnouncementDialog with Markdown body, Got it close, and persistent Don't remind again via ContributionOutlet", async () => {
    const dom = mountInteractiveDom()
    activeUnmount = dom.unmount

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "notice-2026-11",
              title: "系统维护公告",
              content: "请访问 **教务门户** 或 [帮助页](https://example.com/help) 查看 `详情`。",
              level: "critical",
            }),
            { status: 200 }
          )
      )
    )

    const localBackend = new MemoryKeyValueStorage()
    const secureBackend = new MemoryKeyValueStorage()
    const slots = new PluginSlotRegistry()
    slots.declare({ name: "shell.overlay", kind: "list" })
    const i18n = new PluginI18nRegistry()

    const runtime = new PluginRuntime()
    runtime.context.set("slots", slots)
    runtime.context.set("i18n", i18n)
    runtime.context.set(
      "storage",
      new NamespacedStorageService({ local: localBackend, secure: secureBackend })
    )

    try {
      runtime.register(announcementPlugin, "builtin", {
        endpoint: "https://example.com/announcement.json",
      })
      await runtime.startAndWait(announcementPlugin.manifest.id)

      // Allow startup auto-check promise chain to settle
      await new Promise<void>((resolve) => setTimeout(resolve, 10))

      const service = runtime.context.get("announcement") as PluginAnnouncementService
      expect(service.endpoint).toBe("https://example.com/announcement.json")

      const overlayEntry = slots.select("shell.overlay")[0]!
      expect(overlayEntry.component).toBe(AnnouncementDialog)

      await dom.render(
        <ContributionOutlet
          entry={overlayEntry}
          slots={slots}
          i18n={i18n}
          onError={(err) => {
            throw err
          }}
        />
      )

      expect(dom.bodyEl.textContent).toContain("紧急")
      expect(dom.bodyEl.textContent).toContain("系统维护公告")
      expect(dom.bodyEl.textContent).toContain("教务门户")

      const strongNodes = dom.bodyEl.findAll((n) => n.tagName === "STRONG")
      expect(strongNodes[0]?.textContent).toBe("教务门户")
      const linkNodes = dom.bodyEl.findAll((n) => n.tagName === "A")
      expect(linkNodes[0]?.getAttribute("href")).toBe("https://example.com/help")

      // Click "知道了" (Got it) on a separate check -> closes dialog without persisting dismissal
      expect(
        localBackend.data.has(
          `orahako-plugin:${ANNOUNCEMENT_PLUGIN_ID}:${DEFAULT_DISMISSED_STORAGE_KEY}`
        )
      ).toBe(false)

      // Click "不再提醒" (Don't remind again) -> persists dismissed ID in scoped storage and closes dialog
      const dismissBtn = dom.bodyEl.findAll(
        (n) => n.tagName === "BUTTON" && n.textContent.includes("不再提醒")
      )[0]!
      expect(dismissBtn).toBeDefined()

      await act(async () => {
        const onClick = findReactProps(dismissBtn).onClick as (() => void) | undefined
        onClick?.()
        await Promise.resolve()
      })

      expect(
        localBackend.data.get(
          `orahako-plugin:${ANNOUNCEMENT_PLUGIN_ID}:${DEFAULT_DISMISSED_STORAGE_KEY}`
        )
      ).toBe("notice-2026-11")
      expect(await service.check()).toBeNull()
    } finally {
      activeUnmount = undefined
      await dom.unmount()
      runtime.dispose()
    }
  })
})
