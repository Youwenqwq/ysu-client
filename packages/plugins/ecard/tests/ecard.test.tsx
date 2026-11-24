import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_TTL_MS,
  ONE_HOUR_TTL_MS,
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
} from "@orahako/academic-runtime"
import {
  defineSchoolProvider,
  ProviderError,
  ProviderErrorCode,
  type EcardSessionStatus,
  type SchoolProvider,
} from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { overviewPlugin } from "@orahako/plugin-overview"
import { StatelessHttpService } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
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
  type PluginI18nRegistryService,
  type PluginKeyValueStorage,
} from "@orahako/sdk"
import * as ecardEntry from "../src"
import { ECARD_PLUGIN_ID, ecardPlugin } from "../src"
import { ECARD_BALANCE_WIDGET_ID } from "../src/widget"

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
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()
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

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  addEventListener(type: string, fn: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(fn)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, fn: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(fn)
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

function mountMiniDom(isMobile = false) {
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const prevAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT

  const fakeWin = {
    event: undefined,
    innerWidth: isMobile ? 375 : 1280,
    HTMLIFrameElement: class {},
    location: { pathname: "/", search: "", href: "/", reload: vi.fn() },
    matchMedia: () => ({
      matches: isMobile,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  }
  const doc = new MiniDomNode(9, "#document")
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

  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).window = fakeWin
  ;(globalThis as Record<string, unknown>).document = docWithFactories

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
      ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = prevAct
      ;(globalThis as Record<string, unknown>).window = prevWindow
      ;(globalThis as Record<string, unknown>).document = prevDocument
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

describe("@orahako/plugin-ecard", () => {
  it("enforces strict export discipline on src/index.ts", () => {
    expect(Object.keys(ecardEntry).sort()).toEqual(["ECARD_PLUGIN_ID", "default", "ecardPlugin"])
    expect(ecardEntry.default).toBe(ecardPlugin)
    expect(ecardPlugin.manifest.id).toBe("orahako.ecard")
    expect(ecardPlugin.manifest.kind).toBe("feature")
  })

  it("renders the balance and mobile refresh, navigates from the overview widget, and cleans up on stop", async () => {
    const dom = mountMiniDom(false)
    activeUnmount = dom.unmount

    const cardBalance: EcardSessionStatus = {
      ready: true,
      balance: {
        balance: 128.6,
        cardNum: "EC20260088",
        availableDate: "2028-06-30",
        cardStatusName: "正常",
        months: ["2026-11"],
      },
    }
    const fetchBalance = vi.fn<() => Promise<EcardSessionStatus>>().mockResolvedValue(cardBalance)

    const cardSchool: SchoolProvider = defineSchoolProvider({
      id: "card-school",
      name: "校园卡大学",
      slices: {
        ecard: {
          fetchBalance,
        },
      },
      async initialize() {},
      async reset() {},
      async logout() {},
      async relogin() {
        return true
      },
    })

    const noCardSchool: SchoolProvider = defineSchoolProvider({
      id: "no-card-school",
      name: "无卡大学",
      slices: {},
      async initialize() {},
      async reset() {},
      async logout() {},
      async relogin() {
        return true
      },
    })

    const testProvidersPlugin = definePlugin({
      manifest: {
        id: "test.providers",
        name: "Test Providers",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "provider",
        entry: "index.js",
        inject: ["providers"],
      },
      inject: ["providers"] as const,
      apply(ctx) {
        ctx.providers.registerProvider("card-school", () => cardSchool)
        ctx.providers.registerProvider("no-card-school", () => noCardSchool)
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
      settingsRegistryPlugin,
      i18nRegistryPlugin,
      routerRuntimePlugin,
      navigationRuntimePlugin,
      providerRegistryRuntimePlugin,
      sessionRuntimePlugin,
      providerRuntimePlugin,
      queryRuntimePlugin,
      testProvidersPlugin,
      overviewPlugin,
      ecardPlugin,
    ]) {
      if (plugin.manifest.id === queryRuntimePlugin.manifest.id) {
        runtime.register(plugin, "builtin", { policies: {} })
      } else if (
        plugin.manifest.id === sessionRuntimePlugin.manifest.id ||
        plugin.manifest.id === providerRuntimePlugin.manifest.id
      ) {
        runtime.register(plugin, "builtin", { defaultSchoolId: "card-school" })
      } else {
        runtime.register(plugin, "builtin")
      }
      runtime.start(plugin.manifest.id)
    }

    const rootQuery = runtime.context.get("query")!
    expect(rootQuery.policy("ecard")).toEqual({ ttl: ONE_HOUR_TTL_MS, persist: false })

    const ui = runtime.context.get("ui")!
    const slots = runtime.context.get("slots") as PluginSlotRegistry
    const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
    const overview = runtime.context.get("overview")!
    const session = runtime.context.get("session")!
    const providerRuntime = runtime.context.get("provider")!
    const router = runtime.context.get("router")!
    slots.declare({ name: "shell.header.actions", kind: "list" })
    const [headerActions] = slots.select("shell.header.actions")
    expect(headerActions?.pluginId).toBe(ECARD_PLUGIN_ID)

    const ecardPage = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === ECARD_PLUGIN_ID && p.id === "index")!
    expect(ecardPage).toBeDefined()
    expect(ecardPage.route).toBe("ecard")
    expect(ecardPage.capability).toBe("ecard")

    const ecardNav = ui
      .getSnapshot()
      .navigation.find((n) => n.pluginId === ECARD_PLUGIN_ID && n.id === "ecard")!
    expect(ecardNav).toMatchObject({
      id: "ecard",
      page: "index",
      group: "fees",
      capability: "ecard",
    })

    const widgetContribution = overview
      .getSnapshot()
      .find((w) => w.pluginId === ECARD_PLUGIN_ID && w.id === ECARD_BALANCE_WIDGET_ID)!
    expect(widgetContribution).toMatchObject({
      id: "ecard-balance",
      region: "summary",
      slice: "ecard",
      defaultVisible: true,
    })

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))

    // Unauthenticated / no account state on EcardPage
    await dom.render(<ContributionOutlet entry={ecardPage} slots={slots} i18n={i18n} />)
    expect(dom.container.textContent).toContain("未获取到学号")

    // Authenticate and initialize provider
    await act(async () => {
      session.setCredential({
        schoolId: "card-school",
        credential: "ticket-ecard",
        username: "20250001",
      })
      await providerRuntime.initialize()
    })

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("¥128.60")
      expect(dom.container.textContent).toContain("EC20260088")
      expect(dom.container.textContent).toContain("2028-06-30")
      expect(dom.container.textContent).toContain("正常")
    })
    expect(fetchBalance).toHaveBeenCalledTimes(1)

    // Switch locale to English
    await act(async () => {
      i18n.setLocale("en")
    })
    expect(dom.container.textContent).toContain("Current Balance")
    expect(dom.container.textContent).toContain("CNY")
    await act(async () => {
      i18n.setLocale("zh")
    })

    // Render EcardSummaryWidget and verify click navigation to route=ecard
    await dom.render(<ContributionOutlet entry={widgetContribution} slots={slots} i18n={i18n} />)
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("一卡通余额")
      expect(dom.container.textContent).toContain("¥128.60")
    })

    const anchor = dom.container.findAll((node) => node.tagName === "A")[0]!
    expect(anchor.getAttribute("href")).toContain("route=ecard")
    const reactPropsKey = Object.keys(anchor).find((k) => k.startsWith("__reactProps$"))!
    const rawProps: unknown = Reflect.get(anchor, reactPropsKey)
    const onClick: unknown =
      typeof rawProps === "object" && rawProps !== null ? Reflect.get(rawProps, "onClick") : null
    expect(typeof onClick).toBe("function")
    await act(async () => {
      if (typeof onClick === "function") {
        onClick({
          defaultPrevented: false,
          button: 0,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          preventDefault: vi.fn(),
        })
      }
    })
    expect(router.current.getSnapshot().route).toBe("ecard")

    await dom.render(
      <>
        <header>
          <ContributionOutlet entry={headerActions!} slots={slots} i18n={i18n} />
        </header>
        <main>
          <ContributionOutlet entry={ecardPage} slots={slots} i18n={i18n} />
        </main>
      </>
    )
    const isRefresh = (node: MiniDomNode) => node.getAttribute("aria-label") === "刷新"
    const header = dom.container.findAll((node) => node.tagName === "HEADER")[0]!
    const body = dom.container.findAll((node) => node.tagName === "MAIN")[0]!
    const headerButtons = header.findAll(isRefresh)
    expect(headerButtons).toHaveLength(1)
    const [headerRefresh] = headerButtons
    expect(headerRefresh?.getAttribute("data-variant")).toBe("ghost")
    expect(headerRefresh?.getAttribute("data-size")).toBe("icon-sm")
    expect(headerRefresh?.getAttribute("class")?.split(" ")).toContain("md:hidden")
    const bodyButtons = body.findAll(isRefresh)
    expect(bodyButtons).toHaveLength(1)
    const [bodyRefresh] = bodyButtons
    expect(bodyRefresh?.parentNode?.getAttribute("class")?.split(" ")).toEqual(
      expect.arrayContaining(["hidden", "md:flex"])
    )

    const refreshPropsKey = Object.keys(headerRefresh!).find((key) =>
      key.startsWith("__reactProps$")
    )!
    const refreshClick: unknown = Reflect.get(
      Reflect.get(headerRefresh!, refreshPropsKey),
      "onClick"
    )
    expect(typeof refreshClick).toBe("function")
    const pendingRefresh = Promise.withResolvers<EcardSessionStatus>()
    fetchBalance.mockReturnValueOnce(pendingRefresh.promise)
    const callsBeforeRefresh = fetchBalance.mock.calls.length
    await act(async () => {
      if (typeof refreshClick === "function") refreshClick()
    })
    expect(fetchBalance).toHaveBeenCalledTimes(callsBeforeRefresh + 1)
    expect(headerRefresh?.getAttribute("disabled")).not.toBeNull()
    expect(
      headerRefresh?.findAll(
        (node) => node.getAttribute("class")?.split(" ").includes("animate-spin") === true
      )
    ).toHaveLength(1)
    await act(async () => pendingRefresh.resolve(cardBalance))
    expect(headerRefresh?.getAttribute("disabled")).toBeNull()

    await act(async () => router.push({ pluginId: ECARD_PLUGIN_ID }))
    expect(header.findAll(isRefresh)).toHaveLength(1)
    await act(async () => router.push({ pluginId: ECARD_PLUGIN_ID, pageId: "other" }))
    expect(header.findAll(isRefresh)).toEqual([])
    await act(async () => router.push({ route: "epay" }))
    expect(header.findAll(isRefresh)).toEqual([])

    // Switch to provider without ecard slice -> unsupported provider message on page
    await dom.render(<ContributionOutlet entry={ecardPage} slots={slots} i18n={i18n} />)
    await act(async () => {
      session.setCredential({
        schoolId: "no-card-school",
        credential: "ticket-2",
        username: "20250002",
      })
      providerRuntime.selectSchool("no-card-school")
      await providerRuntime.initialize()
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("当前学校暂不支持一卡通查询")
    })

    // Switch back to card-school with AUTH_SESSION_EXPIRED error
    fetchBalance.mockRejectedValue(
      new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, "expired")
    )
    await act(async () => {
      session.setCredential({
        schoolId: "card-school",
        credential: "ticket-expired",
        username: "20250003",
      })
      providerRuntime.selectSchool("card-school")
      await providerRuntime.initialize()
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("未登录教务，无法查询一卡通")
    })

    // Stopping ecardPlugin removes page, navigation, and overview widget cleanly
    await act(async () => {
      runtime.stop(ECARD_PLUGIN_ID)
    })
    expect(ui.getSnapshot().pages.some((p) => p.pluginId === ECARD_PLUGIN_ID)).toBe(false)
    expect(ui.getSnapshot().navigation.some((n) => n.pluginId === ECARD_PLUGIN_ID)).toBe(false)
    expect(overview.getSnapshot().some((w) => w.pluginId === ECARD_PLUGIN_ID)).toBe(false)
    expect(slots.select("shell.header.actions")).toEqual([])
    expect(rootQuery.policy("ecard")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    expect(
      slots.select("overview.widget", `${ECARD_PLUGIN_ID}:${ECARD_BALANCE_WIDGET_ID}`)
    ).toEqual([])

    activeUnmount = undefined
    await dom.unmount()
    runtime.dispose()
  })
})
