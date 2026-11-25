import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const toastMocks = vi.hoisted(() => ({
  warning: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: toastMocks,
}))

import {
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
} from "@orahako/academic-runtime"
import {
  defineSchoolProvider,
  type EpayRecord,
  type EpaySessionStatus,
  type SchoolProvider,
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
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import * as epayEntry from "../src"
import { EPAY_PLUGIN_ID, epayPlugin } from "../src"

class MiniDomNode {
  readonly nodeType: number
  readonly nodeName: string
  readonly tagName?: string
  readonly namespaceURI = "http://www.w3.org/1999/xhtml"
  readonly childNodes: MiniDomNode[] = []
  parentNode: MiniDomNode | null = null
  ownerDocument: MiniDomNode | null = null
  defaultView: unknown = undefined
  activeElement: unknown = null
  nodeValue?: string
  readonly style: Record<string, unknown> = {
    setProperty(name: string, value: string) {
      ;(this as Record<string, unknown>)[name] = value
    },
    removeProperty(name: string) {
      delete (this as Record<string, unknown>)[name]
    },
  }
  readonly attributes = new Map<string, string>()
  private rawText = ""

  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    if (nodeType === 1) this.tagName = nodeName
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

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value))
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  closest(): null {
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

  findAll(predicate: (node: MiniDomNode) => boolean): MiniDomNode[] {
    const found: MiniDomNode[] = []
    if (predicate(this)) found.push(this)
    for (const child of this.childNodes) {
      found.push(...child.findAll(predicate))
    }
    return found
  }
}

function mountMiniDom() {
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const prevAct = Reflect.get(globalThis, "IS_REACT_ACT_ENVIRONMENT")
  const prevGetComputedStyle = globalThis.getComputedStyle
  const prevRaf = globalThis.requestAnimationFrame
  const prevCaf = globalThis.cancelAnimationFrame
  const prevHtmlFormElement = Reflect.get(globalThis, "HTMLFormElement")

  const getComputedStyleStub = () => ({ animationName: "none" })
  const rafStub = (cb: (time: number) => void) => Number(setTimeout(() => cb(Date.now()), 0))
  const cafStub = (id: number) => clearTimeout(id)

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    HTMLFormElement: class {},
    location: { pathname: "/", search: "", reload: vi.fn() },
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    getComputedStyle: getComputedStyleStub,
    requestAnimationFrame: rafStub,
    cancelAnimationFrame: cafStub,
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  }
  const doc = new MiniDomNode(9, "#document")
  doc.defaultView = fakeWin
  const docWithFactories = Object.assign(doc, {
    querySelector: () => null,
    querySelectorAll: () => [],
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

  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true)
  Reflect.set(globalThis, "window", fakeWin)
  Reflect.set(globalThis, "document", docWithFactories)
  Reflect.set(globalThis, "getComputedStyle", getComputedStyleStub)
  Reflect.set(globalThis, "requestAnimationFrame", rafStub)
  Reflect.set(globalThis, "cancelAnimationFrame", cafStub)
  Reflect.set(globalThis, "HTMLFormElement", fakeWin.HTMLFormElement)

  const container = docWithFactories.createElement("div")
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
      Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", prevAct)
      Reflect.set(globalThis, "window", prevWindow)
      Reflect.set(globalThis, "document", prevDocument)
      Reflect.set(globalThis, "getComputedStyle", prevGetComputedStyle)
      Reflect.set(globalThis, "requestAnimationFrame", prevRaf)
      Reflect.set(globalThis, "cancelAnimationFrame", prevCaf)
      Reflect.set(globalThis, "HTMLFormElement", prevHtmlFormElement)
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

beforeEach(() => {
  toastMocks.warning.mockReset()
  toastMocks.error.mockReset()
  toastMocks.success.mockReset()
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

describe("@orahako/plugin-epay", () => {
  it("enforces strict export discipline on src/index.ts", () => {
    expect(Object.keys(epayEntry).sort()).toEqual(["EPAY_PLUGIN_ID", "default", "epayPlugin"])
    expect(epayEntry.default).toBe(epayPlugin)
    expect(epayPlugin.manifest.id).toBe("orahako.epay")
  })

  it("renders fee lists and a route-scoped mobile refresh, and contributes unpaid reminders", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const unpaidRecord: EpayRecord = {
      id: "u1",
      payName: "2026 学年住宿费",
      chargeYear: "2026",
      currencyTypeShow: "人民币",
      amountN: 1200,
      amount: "1200.00",
      payAmount: "0.00",
      refundAmount: "0.00",
      status: "1",
      expired: "0",
      startTime: "2026-09-01",
      overTime: "",
    }
    const paidRecord: EpayRecord = {
      id: "p1",
      payName: "2025 学年学费",
      chargeYear: "2025",
      currencyTypeShow: "人民币",
      amountN: 4800,
      amount: "4800.00",
      payAmount: "4800.00",
      refundAmount: "0.00",
      status: "2",
      expired: "0",
      startTime: "2025-09-01",
      overTime: "2025-09-02",
    }

    const fetchPayments = vi.fn<() => Promise<EpaySessionStatus>>().mockResolvedValue({
      ready: true,
      records: [unpaidRecord, paidRecord],
      unpaid: [unpaidRecord],
    })

    const epaySchool: SchoolProvider = defineSchoolProvider({
      id: "epay-school",
      name: "缴费大学",
      slices: {
        epay: {
          fetchPayments,
          recordStatus: (record) => (record.status === "2" ? "paid" : "unpaid"),
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

    const plainSchool: SchoolProvider = defineSchoolProvider({
      id: "plain-school",
      name: "无缴费大学",
      slices: {},
      async initialize() {},
      async reset() {},
      async logout() {},
      async dispose() {},
      async relogin() {
        return true
      },
    })

    const schoolsPlugin = definePlugin({
      manifest: {
        id: "test.schools",
        name: "Schools",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["providers"],
      },
      inject: ["providers"] as const,
      apply(ctx) {
        ctx.providers.registerProvider("epay-school", () => epaySchool)
        ctx.providers.registerProvider("plain-school", () => plainSchool)
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

    for (const plugin of [
      slotRegistryPlugin,
      uiRegistryPlugin,
      i18nRegistryPlugin,
      routerRuntimePlugin,
      providerRegistryRuntimePlugin,
      sessionRuntimePlugin,
      providerRuntimePlugin,
      queryRuntimePlugin,
      schoolsPlugin,
      epayPlugin,
    ]) {
      if (
        plugin.manifest.id === sessionRuntimePlugin.manifest.id ||
        plugin.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(plugin, "builtin", { defaultSchoolId: "epay-school" })
      } else {
        runtime.register(plugin, "builtin")
      }
      runtime.start(plugin.manifest.id)
    }

    const ui = runtime.context.get("ui")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!
    const router = runtime.context.get("router")!

    slots.declare({ name: "shell.header.actions", kind: "list" })
    const [headerActions] = slots.select("shell.header.actions")
    expect(headerActions?.pluginId).toBe(EPAY_PLUGIN_ID)

    // Declare appReminders slot (as notificationsPlugin does in production)
    slots.declare({ name: "settings.notifications.appReminders", kind: "list" })
    const reminderContributions = slots.select("settings.notifications.appReminders")
    expect(reminderContributions).toHaveLength(1)
    expect(reminderContributions[0]?.pluginId).toBe(EPAY_PLUGIN_ID)

    const epayPage = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === EPAY_PLUGIN_ID && p.id === "index")!
    expect(epayPage.route).toBe("epay")
    expect(epayPage.capability).toBe("epay")

    const epayNav = ui
      .getSnapshot()
      .navigation.find((n) => n.pluginId === EPAY_PLUGIN_ID && n.id === "epay")!
    expect(epayNav).toMatchObject({
      id: "epay",
      page: "index",
      group: "fees",
      capability: "epay",
    })

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))

    await act(async () => {
      session.setCredential({
        schoolId: "epay-school",
        credential: "ticket-epay",
        username: "20260101",
      })
      await providerRuntime.initialize()
    })

    // provider/ready auto-check triggers warning toast for unpaid fee
    await vi.waitFor(() => {
      expect(toastMocks.warning).toHaveBeenCalledWith("你有 1 笔费用待缴纳，合计 ¥1200.00")
    })

    await dom.render(
      <>
        <header>
          <ContributionOutlet entry={headerActions!} slots={slots} i18n={i18n} />
        </header>
        <main>
          <ContributionOutlet entry={epayPage} slots={slots} i18n={i18n} />
        </main>
      </>
    )
    const header = dom.container.findAll((node) => node.tagName === "HEADER")[0]!
    const body = dom.container.findAll((node) => node.tagName === "MAIN")[0]!
    const isRefresh = (node: MiniDomNode) => node.attributes.get("aria-label") === "刷新"
    expect(header.findAll(isRefresh)).toEqual([])
    await act(async () => router.push({ route: "epay" }))
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("2026 学年住宿费")
      expect(dom.container.textContent).toContain("1 笔未缴")
      expect(dom.container.textContent).toContain("¥1200.00")
      expect(dom.container.textContent).toContain("2025 学年学费")
      expect(dom.container.textContent).toContain("已支付 · ¥4800")
    })

    const headerButtons = header.findAll(isRefresh)
    expect(headerButtons).toHaveLength(1)
    const [headerRefresh] = headerButtons
    expect(headerRefresh?.attributes.get("data-variant")).toBe("ghost")
    expect(headerRefresh?.attributes.get("data-size")).toBe("icon-sm")
    expect(headerRefresh?.attributes.get("class")?.split(" ")).toContain("md:hidden")
    const bodyButtons = body.findAll(isRefresh)
    expect(bodyButtons).toHaveLength(1)
    const [bodyRefresh] = bodyButtons
    expect(bodyRefresh?.attributes.get("class")?.split(" ")).toEqual(
      expect.arrayContaining(["hidden", "md:inline-flex"])
    )

    const refreshPropsKey = Object.keys(headerRefresh!).find((key) =>
      key.startsWith("__reactProps$")
    )!
    const refreshClick: unknown = Reflect.get(
      Reflect.get(headerRefresh!, refreshPropsKey),
      "onClick"
    )
    expect(typeof refreshClick).toBe("function")
    const callsBeforeRefresh = fetchPayments.mock.calls.length
    await act(async () => {
      if (typeof refreshClick === "function") refreshClick()
    })
    expect(fetchPayments).toHaveBeenCalledTimes(callsBeforeRefresh + 1)

    await act(async () => router.push({ pluginId: EPAY_PLUGIN_ID }))
    expect(header.findAll(isRefresh)).toHaveLength(1)
    await act(async () => router.push({ route: "meter" }))
    expect(header.findAll(isRefresh)).toEqual([])

    // The provider is already ready, so a later sign-in must trigger the auto-check by itself.
    await act(async () => {
      session.setCredential({
        schoolId: "epay-school",
        credential: "ticket-epay-b",
        username: "20260202",
      })
    })
    await vi.waitFor(() => {
      expect(toastMocks.warning).toHaveBeenCalledTimes(2)
    })

    // Re-notifying the same account (fresh credential) must stay inside the 3-hour cooldown.
    await act(async () => {
      session.setCredential({
        schoolId: "epay-school",
        credential: "ticket-epay-b-relogin",
        username: "20260202",
      })
    })
    expect(toastMocks.warning).toHaveBeenCalledTimes(2)

    // Render reminder settings contribution for epay-school (visible) then plain-school (hidden)
    await dom.render(
      <ContributionOutlet entry={reminderContributions[0]!} slots={slots} i18n={i18n} />
    )
    expect(dom.container.textContent).toContain("缴费提醒")
    expect(dom.container.textContent).toContain("未缴自动提醒")

    await act(async () => {
      providerRuntime.selectSchool("plain-school")
      await providerRuntime.initialize()
    })
    expect(dom.container.textContent).toBe("")

    // Stop plugin cleans up page, nav, and slot contribution
    await act(async () => {
      runtime.stop(EPAY_PLUGIN_ID)
    })
    expect(ui.getSnapshot().pages.some((p) => p.pluginId === EPAY_PLUGIN_ID)).toBe(false)
    expect(slots.select("settings.notifications.appReminders")).toEqual([])
    expect(slots.select("shell.header.actions")).toEqual([])

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
