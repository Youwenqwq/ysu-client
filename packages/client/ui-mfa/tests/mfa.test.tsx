import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const toastMocks = vi.hoisted(() => {
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
    error: vi.fn(),
  }
})

vi.mock("sonner", () => ({
  toast: {
    error: toastMocks.error,
  },
}))

import { PluginRuntime } from "@orahako/kernel"
import { i18nRegistryPlugin, PluginI18nRegistry } from "@orahako/runtime-i18n"
import { ContributionOutlet, PluginSlotRegistry } from "@orahako/runtime-slots"
import {
  createObservableSource,
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type MutableObservableSource,
} from "@orahako/sdk"
import type {
  MfaService,
  ProviderRuntimeService,
  ProviderRuntimeSnapshot,
  SchoolProvider,
  SessionService,
  SessionSnapshot,
  WechatQrPollResult,
} from "@orahako/academic-sdk"
import {
  createMfaService,
  MFA_COUNTDOWN_SECONDS,
  MFA_PLUGIN_ID,
  MfaCancelledError,
  MFAModal,
  mfaPlugin,
  STATIC_UNAVAILABLE_PROVIDER_SOURCE,
  UNAVAILABLE_PROVIDER_SNAPSHOT,
  type MfaModalInject,
} from "../src/index"

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
    return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 40, width: 100, height: 40 }
  }

  focus(): void {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this
    }
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

function findReactProps(node: MiniDomNode): Record<string, unknown> {
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith("__reactProps$") && typeof val === "object" && val !== null) {
      return val as Record<string, unknown>
    }
  }
  return {}
}

function mountInteractiveDom(screenWidth = 390, screenHeight = 844) {
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
    innerWidth: screenWidth,
    innerHeight: screenHeight,
    screen: { width: screenWidth, height: screenHeight },
    HTMLIFrameElement: class {},
    HTMLElement: MiniDomNode,
    Element: MiniDomNode,
    Node: MiniDomNode,
    document: doc,
    navigator: { userAgent: "VitestAgent/1.0" },
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
      return {
        nextNode: () => null,
      }
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
  toastMocks.error.mockReset()
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

describe("@orahako/ui-mfa", () => {
  it("validates manifest and cleanly rejects superseded or disposed MFA promises", async () => {
    expect(validatePluginManifest(mfaPlugin.manifest)).toMatchObject({
      id: MFA_PLUGIN_ID,
      apiVersion: PLUGIN_API_VERSION,
      kind: "runtime",
      provides: ["mfa"],
      providerIndependent: true,
      inject: ["slots", "i18n"],
    })
    expect(mfaPlugin.optionalInject).toEqual(["provider", "session"])
    expect(STATIC_UNAVAILABLE_PROVIDER_SOURCE.getSnapshot().status).toBe("unavailable")

    const service = createMfaService()
    const firstPromise = service.show({ username: "u1", method: "sms" })
    const secondPromise = service.show({ username: "u2", method: "cpdaily" })

    await expect(firstPromise).rejects.toMatchObject({
      name: "MfaCancelledError",
      reason: "superseded",
    })

    service.dispose()
    await expect(secondPromise).rejects.toMatchObject({
      name: "MfaCancelledError",
      reason: "disposed",
    })
    await expect(service.show({ username: "u3" })).rejects.toBeInstanceOf(MfaCancelledError)
  })

  it("applies without optional services and rebinds provider source", async () => {
    const slots = new PluginSlotRegistry()
    slots.declare({ name: "shell.overlay", kind: "list" })
    const i18n = new PluginI18nRegistry()

    const runtime = new PluginRuntime()
    runtime.context.set("slots", slots)
    runtime.context.set("i18n", i18n)
    runtime.register(mfaPlugin, "builtin")
    await runtime.startAndWait(mfaPlugin.manifest.id)

    const readInject = (): MfaModalInject => {
      const entry = slots.select("shell.overlay")[0]
      expect(entry).toBeDefined()
      return entry!.inject!(runtime.context) as MfaModalInject
    }

    const makeProviderService = (
      state: MutableObservableSource<ProviderRuntimeSnapshot>
    ): ProviderRuntimeService => ({
      state,
      getSnapshot: state.getSnapshot,
      subscribe: state.subscribe,
      getActive: () => {
        throw new Error("not used")
      },
      selectSchool: () => {
        throw new Error("not used")
      },
      initialize: async () => {
        throw new Error("not used")
      },
      reset: async () => {},
      logout: async () => {},
      relogin: async () => false,
    })

    try {
      expect(readInject().hooks.providerState).toBe(STATIC_UNAVAILABLE_PROVIDER_SOURCE)

      const providerAState = createObservableSource<ProviderRuntimeSnapshot>({
        status: "ready",
        schoolId: "ysu",
        provider: null,
        error: null,
        generation: 1,
      })
      const releaseProviderA = runtime.context.set(
        "provider",
        makeProviderService(providerAState)
      )
      await vi.waitFor(() => {
        expect(readInject().hooks.providerState).toBe(providerAState)
      })

      const providerBState = createObservableSource<ProviderRuntimeSnapshot>({
        status: "ready",
        schoolId: "ysu",
        provider: null,
        error: null,
        generation: 2,
      })
      releaseProviderA()
      const releaseProviderB = runtime.context.set(
        "provider",
        makeProviderService(providerBState)
      )
      await vi.waitFor(() => {
        expect(readInject().hooks.providerState).toBe(providerBState)
      })

      releaseProviderB()
      await vi.waitFor(() => {
        expect(readInject().hooks.providerState.getSnapshot()).toBe(
          UNAVAILABLE_PROVIDER_SNAPSHOT
        )
      })
    } finally {
      runtime.dispose()
    }
  })

  it("never selects an MFA method outside the available set", async () => {
    const dom = mountInteractiveDom(390, 844)
    activeUnmount = dom.unmount

    const slots = new PluginSlotRegistry()
    slots.declare({ name: "shell.overlay", kind: "list" })
    const i18n = new PluginI18nRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("slots", slots)
    runtime.context.set("i18n", i18n)
    runtime.register(mfaPlugin, "builtin")
    await runtime.startAndWait(mfaPlugin.manifest.id)

    try {
      const mfaService = runtime.context.get("mfa") as MfaService
      const overlayEntry = slots.select("shell.overlay")[0]!
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

      await act(async () => {
        const pending = mfaService.show({
          username: "20241234",
          method: "cpdaily",
          methods: ["sms"],
        })
        void pending.catch(() => {})
      })

      // The requested/challenge method is outside the offered set, so the
      // modal must fall back to the first available method instead.
      expect(dom.bodyEl.textContent).toContain("短信")
      expect(dom.bodyEl.textContent).not.toContain("今日校园")
    } finally {
      activeUnmount = undefined
      await dom.unmount()
      runtime.dispose()
    }
  })

  it("boots in non-academic composition without provider/session and supports pre-populated challenge + code submission via ContributionOutlet", async () => {
    const dom = mountInteractiveDom(390, 844)
    activeUnmount = dom.unmount

    const slots = new PluginSlotRegistry()
    slots.declare({ name: "shell.overlay", kind: "list" })
    const i18n = new PluginI18nRegistry()

    const runtime = new PluginRuntime()
    runtime.context.set("slots", slots)
    runtime.context.set("i18n", i18n)
    runtime.register(mfaPlugin, "builtin")
    await runtime.startAndWait(mfaPlugin.manifest.id)

    try {
      const mfaService = runtime.context.get("mfa") as MfaService
      const overlayEntry = slots.select("shell.overlay")[0]!
      expect(overlayEntry.component).toBe(MFAModal)

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

      let pendingResult!: Promise<unknown>
      await act(async () => {
        pendingResult = mfaService.show({
          username: "20241234",
          methods: ["sms", "cpdaily"],
          challenge: {
            method: "sms",
            methodCode: "PRE-MC-1",
            mobileHint: "138****8888",
          },
        })
      })

      // Dialog portals into document.body with pre-populated mobileHint and 120s resend label
      expect(dom.bodyEl.textContent).toContain("请输入 MFA 验证码")
      expect(dom.bodyEl.textContent).toContain("138****8888")
      expect(dom.bodyEl.textContent).toContain(`${MFA_COUNTDOWN_SECONDS}s`)

      const codeInput = dom.bodyEl.findAll((n) => n.id === "mfa-modal-code")[0]!
      const formNode = dom.bodyEl.findAll((n) => n.tagName === "FORM")[0]!

      await act(async () => {
        const onChange = findReactProps(codeInput).onChange as
          | ((e: { target: { value: string } }) => void)
          | undefined
        onChange?.({ target: { value: "987654" } })
      })

      await act(async () => {
        const onSubmit = findReactProps(formNode).onSubmit as
          | ((e: { preventDefault(): void }) => void)
          | undefined
        onSubmit?.({ preventDefault() {} })
      })

      await expect(pendingResult).resolves.toEqual({
        type: "code",
        method: "sms",
        methodCode: "PRE-MC-1",
        code: "987654",
      })
    } finally {
      activeUnmount = undefined
      await dom.unmount()
      runtime.dispose()
    }
  })

  it("drives tablet WeChat QR polling with standard <img>, retry backoff, scanned/confirmed states, and session.setCredential", async () => {
    // Tablet screen (short edge >= 600)
    const dom = mountInteractiveDom(800, 1180)
    activeUnmount = dom.unmount

    const pollQueue: Array<() => Promise<WechatQrPollResult>> = []
    let resolveNextPoll: ((res: WechatQrPollResult) => void) | null = null

    const initiateWechatMfa = vi.fn(async () => ({
      uuid: "wx-uuid-1",
      state: "wx-state-1",
      qrImageUrl: "https://example.com/wechat-qr.png",
      oauthUrl: "https://example.com/oauth",
    }))
    const pollWechatMfaQr = vi.fn(
      (
        _uuid: string,
        _lastErrcode?: number,
        _signal?: AbortSignal
      ): Promise<WechatQrPollResult> => {
        const next = pollQueue.shift()
        if (next) return next()
        return new Promise<WechatQrPollResult>((resolve) => {
          resolveNextPoll = resolve
        })
      }
    )
    const completeWechatMfa = vi.fn(async () => "WECHAT-CASTGC-CRED")
    const requestMfaCode = vi.fn(async () => ({
      method: "sms",
      methodCode: "SMS-CODE-1",
      mobileHint: "139****0000",
      username: "20249999",
    }))

    const fakeProvider: SchoolProvider = {
      id: "ysu",
      name: "YSU",
      timeZone: "Asia/Shanghai",
      slices: {
        auth: {
          prepareLogin: async () => {},
          resetLoginSession: () => {},
          login: async () => {},
          loginStep1: async () => ({ authenticated: false, needsMfa: true, username: "20249999" }),
          checkAuthStatus: async () => ({ authenticated: false }),
          isAuthenticated: () => false,
          requestMfaCode,
          wechatMfa: {
            initiateWechatMfa,
            pollWechatMfaQr,
            completeWechatMfa,
          },
        },
      },
      initialize: async () => {},
      reset: async () => {},
      logout: async () => {},
      dispose: async () => {},
      relogin: async () => false,
    }

    const providerState = createObservableSource<ProviderRuntimeSnapshot>({
      status: "ready",
      schoolId: "ysu",
      provider: fakeProvider,
      error: null,
      generation: 1,
    })

    const fakeProviderService: ProviderRuntimeService = {
      state: providerState,
      getSnapshot: providerState.getSnapshot,
      subscribe: providerState.subscribe,
      getActive: () => fakeProvider,
      selectSchool: () => fakeProvider,
      initialize: async () => fakeProvider,
      reset: async () => {},
      logout: async () => {},
      relogin: async () => false,
    }

    const setCredential = vi.fn()
    const sessionSnap: SessionSnapshot = {
      activeSchoolId: "ysu",
      credential: null,
      username: null,
      isAuthenticated: false,
      sessionExpired: false,
      hasHydrated: true,
      artifacts: {},
    }
    const sessionState = createObservableSource<SessionSnapshot>(sessionSnap)
    const fakeSessionService: SessionService = {
      state: sessionState,
      getSnapshot: sessionState.getSnapshot,
      subscribe: sessionState.subscribe,
      setCredential,
      activateSchool: () => {},
      clearCredential: () => {},
      setSessionExpired: () => {},
      setArtifact: () => {},
      getArtifact: () => null,
      createCookieJar: () => {
        throw new Error("not used")
      },
      fetchWithJar: async () => {
        throw new Error("not used")
      },
    }

    const slots = new PluginSlotRegistry()
    slots.declare({ name: "shell.overlay", kind: "list" })
    const runtime = new PluginRuntime()
    runtime.context.set("slots", slots)
    runtime.context.set("provider", fakeProviderService)
    runtime.context.set("session", fakeSessionService)
    runtime.register(i18nRegistryPlugin, "builtin")
    runtime.register(mfaPlugin, "builtin")
    await runtime.startAndWait(i18nRegistryPlugin.manifest.id)
    await runtime.startAndWait(mfaPlugin.manifest.id)

    try {
      const mfaService = runtime.context.get("mfa") as MfaService
      const overlayEntry = slots.select("shell.overlay")[0]!

      await dom.render(
        <ContributionOutlet
          entry={overlayEntry}
          slots={slots}
          onError={(err) => {
            throw err
          }}
        />
      )

      let mfaPromise!: Promise<unknown>
      await act(async () => {
        mfaPromise = mfaService.show({ username: "20249999" })
      })

      // Default method on tablet with wechatMfa is "weixin" -> shows "获取二维码" button
      const openQrButton = dom.bodyEl.findAll(
        (n) => n.tagName === "BUTTON" && n.textContent.includes("获取二维码")
      )[0]!
      expect(openQrButton).toBeDefined()

      // Queue: 1st poll returns scanned, 2nd poll hangs so we can inspect standard <img> & scanned text
      pollQueue.push(async () => ({ status: "scanned", errcode: 404 }))

      await act(async () => {
        const onClick = findReactProps(openQrButton).onClick as (() => void) | undefined
        onClick?.()
        await Promise.resolve()
      })

      const qrImg = dom.bodyEl.findAll((n) => n.tagName === "IMG")[0]!
      expect(qrImg).toBeDefined()
      expect(qrImg.getAttribute("src")).toBe("https://example.com/wechat-qr.png")
      expect(qrImg.getAttribute("alt")).toBe("WeChat QR")
      expect(dom.bodyEl.textContent).toContain("已扫码，请在微信中确认登录")

      // Resolve 2nd poll as confirmed -> completes WeChat MFA and stores credential in session
      await act(async () => {
        resolveNextPoll?.({ status: "confirmed", code: "WX-AUTH-CODE" })
        await Promise.resolve()
      })

      await expect(mfaPromise).resolves.toEqual({ type: "wechat" })
      expect(completeWechatMfa).toHaveBeenCalledWith("WX-AUTH-CODE", "wx-state-1")
      expect(setCredential).toHaveBeenCalledWith({
        schoolId: "ysu",
        credential: "WECHAT-CASTGC-CRED",
        username: "20249999",
      })

      // Also verify expired QR state and user cancel rejection
      let secondPromise!: Promise<unknown>
      await act(async () => {
        secondPromise = mfaService.show({ username: "20249999" })
      })
      secondPromise.catch(() => {})

      pollQueue.push(async () => ({ status: "expired" }))
      const openQrButton2 = dom.bodyEl.findAll(
        (n) => n.tagName === "BUTTON" && n.textContent.includes("获取二维码")
      )[0]!
      await act(async () => {
        const onClick = findReactProps(openQrButton2).onClick as (() => void) | undefined
        onClick?.()
        await Promise.resolve()
      })
      expect(dom.bodyEl.textContent).toContain("二维码已失效，请重新获取")

      const backButton = dom.bodyEl.findAll(
        (n) => n.tagName === "BUTTON" && n.textContent.includes("返回")
      )[0]!
      await act(async () => {
        const onClick = findReactProps(backButton).onClick as (() => void) | undefined
        onClick?.()
      })
      await expect(secondPromise).rejects.toMatchObject({
        name: "MfaCancelledError",
        reason: "cancelled",
      })
    } finally {
      activeUnmount = undefined
      await dom.unmount()
      runtime.dispose()
    }
  })
})
