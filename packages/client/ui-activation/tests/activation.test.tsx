import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const capacitorMocks = vi.hoisted(() => ({
  isNative: false,
}))

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => capacitorMocks.isNative,
  },
  CapacitorHttp: {
    request: vi.fn(),
  },
  registerPlugin: () => ({}),
}))

import { PluginRuntime } from "@orahako/kernel"
import { httpRuntimePlugin } from "@orahako/runtime-http"
import { i18nRegistryPlugin, PluginI18nRegistry } from "@orahako/runtime-i18n"
import { ContributionOutlet, PluginSlotRegistry, slotRegistryPlugin } from "@orahako/runtime-slots"
import { NamespacedStorageService } from "@orahako/runtime-storage"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type PluginHttpService,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import {
  ACTIVATION_HEADER,
  ACTIVATION_PLUGIN_ID,
  ActivationGate,
  activationPlugin,
  DEFAULT_VERIFY_ENDPOINT,
  resolveActivationRequired,
  resolveVerifyEndpoint,
  verifyActivationToken,
} from "../src/index"

class MemoryKeyValueStorage implements PluginKeyValueStorage {
  readonly data = new Map<string, string>()
  readBarrier: Promise<void> | null = null

  async getItem(key: string): Promise<string | null> {
    if (this.readBarrier) {
      await this.readBarrier
    }
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
  body?: MiniDomNode
  documentElement?: MiniDomNode
  nodeValue?: string
  value = ""
  disabled = false
  type = ""
  readonly style: Record<string, string> = {}
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

function mountInteractiveDom() {
  const g = globalThis as Record<string, unknown>
  const prevWindow = g.window
  const prevDocument = g.document
  const prevAct = g.IS_REACT_ACT_ENVIRONMENT
  const prevElement = g.HTMLElement

  const doc = new MiniDomNode(9, "#document")
  const htmlEl = new MiniDomNode(1, "HTML")
  const bodyEl = new MiniDomNode(1, "BODY")
  htmlEl.ownerDocument = doc
  bodyEl.ownerDocument = doc
  doc.appendChild(htmlEl)
  htmlEl.appendChild(bodyEl)
  doc.documentElement = htmlEl
  doc.body = bodyEl

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    HTMLElement: MiniDomNode,
    document: doc,
    addEventListener: () => {},
    removeEventListener: () => {},
    getComputedStyle: () => ({}),
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
  })

  g.IS_REACT_ACT_ENVIRONMENT = true
  g.window = fakeWin
  g.document = docWithFactories
  g.HTMLElement = MiniDomNode

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
      g.IS_REACT_ACT_ENVIRONMENT = prevAct
      g.window = prevWindow
      g.document = prevDocument
      g.HTMLElement = prevElement
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

describe("@orahako/ui-activation", () => {
  it("validates manifest and resolves config defaults cleanly", () => {
    expect(validatePluginManifest(activationPlugin.manifest)).toMatchObject({
      id: ACTIVATION_PLUGIN_ID,
      apiVersion: PLUGIN_API_VERSION,
      kind: "feature",
      providerIndependent: true,
      inject: ["slots", "i18n", "storage", "http"],
    })
    expect(ACTIVATION_HEADER).toBe("x-activation")
    expect(resolveVerifyEndpoint(undefined)).toBe(DEFAULT_VERIFY_ENDPOINT)
    expect(resolveVerifyEndpoint("  /custom/activate  ")).toBe("/custom/activate")
    expect(resolveActivationRequired(true)).toBe(true)
    expect(resolveActivationRequired(false)).toBe(false)
    const currentEnv = (
      globalThis as { readonly process?: { readonly env?: Record<string, string | undefined> } }
    ).process?.env?.NODE_ENV
    expect(resolveActivationRequired(undefined)).toBe(currentEnv === "production")
  })

  it("attaches x-activation on http/request and clears stale token on 401/403 ACTIVATION_REQUIRED while preserving downstream body", async () => {
    const localBackend = new MemoryKeyValueStorage()
    const secureBackend = new MemoryKeyValueStorage()
    secureBackend.data.set(
      `orahako-plugin:${ACTIVATION_PLUGIN_ID}:activation`,
      JSON.stringify({ version: 1, state: { token: "persisted-secret" } })
    )

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const receivedToken = headers.get("x-activation")
      if (receivedToken === "persisted-secret") {
        return new Response(JSON.stringify({ code: "ACTIVATION_REQUIRED" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        })
      }
      return new Response("public-ok", {
        status: 200,
        headers: {
          "x-proxy-status": "200",
          "x-had-activation": receivedToken ?? "none",
        },
      })
    })
    vi.stubGlobal("fetch", fetchMock)

    const runtime = new PluginRuntime()
    let consumerHttp!: PluginHttpService

    const customStoragePlugin = definePlugin({
      manifest: {
        id: "test.storage",
        name: "Test Storage",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "runtime",
        entry: "index.js",
        provides: ["storage"],
      },
      apply(ctx) {
        ctx.set(
          "storage",
          new NamespacedStorageService({ local: localBackend, secure: secureBackend })
        )
      },
    })

    const consumerPlugin = definePlugin({
      manifest: {
        id: "test.consumer",
        name: "Consumer",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["http"],
      },
      inject: ["http"] as const,
      apply(ctx) {
        consumerHttp = ctx.http
      },
    })

    try {
      runtime.register(slotRegistryPlugin, "builtin")
      runtime.register(i18nRegistryPlugin, "builtin")
      runtime.register(customStoragePlugin, "builtin")
      runtime.register(httpRuntimePlugin, "builtin")
      runtime.register(activationPlugin, "builtin", { required: true })
      runtime.register(consumerPlugin, "builtin")

      await runtime.startAndWait(slotRegistryPlugin.manifest.id)
      await runtime.startAndWait(i18nRegistryPlugin.manifest.id)
      await runtime.startAndWait(customStoragePlugin.manifest.id)
      await runtime.startAndWait(httpRuntimePlugin.manifest.id)
      await runtime.startAndWait(activationPlugin.manifest.id)
      await runtime.startAndWait(consumerPlugin.manifest.id)

      // 1st request attaches hydrated "persisted-secret" via "x-activation", receives 403 ACTIVATION_REQUIRED
      const firstResp = await consumerHttp.send({
        method: "GET",
        url: "https://jwxt.ysu.edu.cn/api/test",
        redirect: "manual",
      })
      expect(firstResp.status).toBe(403)
      // Downstream body remains completely intact!
      expect(await firstResp.text()).toContain("ACTIVATION_REQUIRED")

      const firstInit = fetchMock.mock.calls[0]?.[1]
      expect(new Headers(firstInit?.headers).get("x-activation")).toBe("persisted-secret")

      // 2nd request should NOT attach x-activation because token was cleared on 403 ACTIVATION_REQUIRED
      const secondResp = await consumerHttp.send({
        method: "GET",
        url: "https://jwxt.ysu.edu.cn/api/public",
        redirect: "manual",
      })
      expect(secondResp.status).toBe(200)
      expect(await secondResp.text()).toBe("public-ok")
      const secondInit = fetchMock.mock.calls[1]?.[1]
      expect(new Headers(secondInit?.headers).get("x-activation")).toBeNull()
    } finally {
      runtime.dispose()
    }
  })

  it("renders ActivationGate through shell.gate chain slot and ContributionOutlet across hydration, verification, locale, and native passthrough", async () => {
    const dom = mountInteractiveDom()
    activeUnmount = dom.unmount

    const localBackend = new MemoryKeyValueStorage()
    const secureBackend = new MemoryKeyValueStorage()
    let releaseHydration!: () => void
    secureBackend.readBarrier = new Promise<void>((resolve) => {
      releaseHydration = resolve
    })

    const slots = new PluginSlotRegistry()
    const i18n = new PluginI18nRegistry()
    const runtime = new PluginRuntime()
    runtime.context.set("slots", slots)
    runtime.context.set("i18n", i18n)
    runtime.context.set(
      "storage",
      new NamespacedStorageService({ local: localBackend, secure: secureBackend })
    )
    runtime.register(httpRuntimePlugin, "builtin")
    await runtime.startAndWait(httpRuntimePlugin.manifest.id)

    const shellHostPlugin = definePlugin({
      manifest: {
        id: "test.shell-host",
        name: "Shell Host",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "shell",
        entry: "index.js",
        inject: ["slots"],
      },
      inject: ["slots"] as const,
      apply(ctx) {
        ctx.slots.register(
          {
            id: "shell-root",
            slot: "root",
            children: {
              "shell.gate": { kind: "chain" },
            },
          },
          (props) => props.renderSlotChain("shell.gate", <div data-protected="">Protected App</div>)
        )
      },
    })

    try {
      runtime.register(shellHostPlugin, "builtin")
      runtime.register(activationPlugin, "builtin", {
        required: true,
        verifyEndpoint: "/api/custom-activate",
      })
      await runtime.startAndWait(shellHostPlugin.manifest.id)
      await runtime.startAndWait(activationPlugin.manifest.id)

      const rootEntry = slots.select("root")[0]!
      expect(slots.select("shell.gate")[0]?.component).toBe(ActivationGate)

      // 1. Before hydration completes -> renders null (no flash of activation form or protected content)
      await dom.render(<ContributionOutlet entry={rootEntry} slots={slots} i18n={i18n} />)
      expect(dom.container.textContent).toBe("")

      // 2. Release hydration with no token -> renders activation Card form in zh
      await act(async () => {
        releaseHydration()
        await Promise.resolve()
      })
      expect(dom.container.textContent).toContain("激活应用")
      expect(dom.container.textContent).not.toContain("Protected App")

      // Switch locale to English -> updates via ContributionOutlet dictionary
      await act(async () => {
        i18n.setLocale("en")
      })
      expect(dom.container.textContent).toContain("Activate App")

      // 3. Interactive form submission: 401 -> invalid error, 502 -> network error, 200 -> unlocks Protected App
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
        .mockResolvedValueOnce(new Response("server error", { status: 502 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ activated: true }), { status: 200 }))
      vi.stubGlobal("fetch", fetchMock)

      const findReactProps = (node: MiniDomNode): Record<string, unknown> => {
        for (const [key, val] of Object.entries(node)) {
          if (key.startsWith("__reactProps$") && typeof val === "object" && val !== null) {
            return val as Record<string, unknown>
          }
        }
        return {}
      }

      const inputNode = dom.container.findAll((n) => n.tagName === "INPUT")[0]!
      const formNode = dom.container.findAll((n) => n.tagName === "FORM")[0]!

      await act(async () => {
        const onChange = findReactProps(inputNode).onChange as
          | ((e: { target: { value: string } }) => void)
          | undefined
        onChange?.({ target: { value: "wrong-key" } })
      })

      await act(async () => {
        const onSubmit = findReactProps(formNode).onSubmit as
          | ((e: { preventDefault(): void }) => void)
          | undefined
        onSubmit?.({ preventDefault() {} })
      })
      expect(dom.container.textContent).toContain("Invalid key, please check and try again")
      expect(fetchMock).toHaveBeenCalledWith("/api/custom-activate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "wrong-key" }),
      })

      await act(async () => {
        const onSubmit = findReactProps(formNode).onSubmit as
          | ((e: { preventDefault(): void }) => void)
          | undefined
        onSubmit?.({ preventDefault() {} })
      })
      expect(dom.container.textContent).toContain(
        "Verification failed, please check your network and try again"
      )

      await act(async () => {
        const onChange = findReactProps(inputNode).onChange as
          | ((e: { target: { value: string } }) => void)
          | undefined
        onChange?.({ target: { value: "valid-secret" } })
      })
      await act(async () => {
        const onSubmit = findReactProps(formNode).onSubmit as
          | ((e: { preventDefault(): void }) => void)
          | undefined
        onSubmit?.({ preventDefault() {} })
      })
      expect(dom.container.textContent).toContain("Protected App")
      expect(
        await verifyActivationToken("/api/activate", "x", () =>
          Promise.reject(new Error("offline"))
        )
      ).toBe("network")

      // Native passthrough check: re-register with native=true
      capacitorMocks.isNative = true
      await act(async () => {
        runtime.stop(activationPlugin.manifest.id)
        await runtime.startAndWait(activationPlugin.manifest.id)
      })
      const nativeGateEntry = slots.select("shell.gate")[0]!
      const nativeMarkup = renderToStaticMarkup(
        <ContributionOutlet
          entry={nativeGateEntry}
          owner={{ children: <span>Native Passthrough</span> }}
          slots={slots}
          i18n={i18n}
        />
      )
      expect(nativeMarkup).toContain("Native Passthrough")
    } finally {
      activeUnmount = undefined
      await dom.unmount()
      runtime.dispose()
    }
  })
})
