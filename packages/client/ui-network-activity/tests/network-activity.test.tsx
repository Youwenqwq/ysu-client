import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PluginRuntime } from "@orahako/kernel"
import { httpRuntimePlugin } from "@orahako/runtime-http"
import { i18nRegistryPlugin, type PluginI18nRegistry } from "@orahako/runtime-i18n"
import { routerRuntimePlugin } from "@orahako/runtime-router"
import { settingsRegistryPlugin } from "@orahako/runtime-settings"
import {
  ContributionOutlet,
  slotRegistryPlugin,
  type PluginSlotRegistry,
} from "@orahako/runtime-slots"
import { createScopedStorage, storageRuntimePlugin } from "@orahako/runtime-storage"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type PluginHttpService,
  type PluginRouterService,
} from "@orahako/sdk"
import {
  activitySettingsStore,
  formatDuration,
  isActivityDensity,
  networkActivityPlugin,
} from "../src/index"

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
  readonly style: Record<string, string> = {}
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
    const idx = this.parentNode.childNodes.indexOf(this)
    return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null
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
    const idx = this.childNodes.indexOf(before)
    child.parentNode = this
    if (idx >= 0) this.childNodes.splice(idx, 0, child)
    else this.childNodes.push(child)
    return child
  }

  removeChild(child: MiniDomNode): MiniDomNode {
    const idx = this.childNodes.indexOf(child)
    if (idx >= 0) {
      this.childNodes.splice(idx, 1)
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

  set textContent(value: string) {
    this.childNodes.length = 0
    this.rawText = String(value)
  }

  get textContent(): string {
    if (this.nodeType === 3) return this.nodeValue ?? ""
    if (this.nodeType === 8) return ""
    if (this.childNodes.length === 0) return this.rawText
    return this.childNodes.map((c) => c.textContent).join("")
  }

  toHtml(): string {
    if (this.nodeType === 3) return this.nodeValue ?? ""
    if (this.nodeType === 8) return ""
    const inner =
      this.childNodes.length > 0 ? this.childNodes.map((c) => c.toHtml()).join("") : this.rawText
    if (this.nodeType !== 1) return inner
    const tag = this.nodeName.toLowerCase()
    const attrs = Array.from(this.attributes.entries())
      .map(([k, v]) => ` ${k}="${v}"`)
      .join("")
    return `<${tag}${attrs}>${inner}</${tag}>`
  }
}

function mountDom() {
  const globals = globalThis as Record<string, unknown>
  const prevWin = globals.window
  const prevDoc = globals.document
  const prevAct = globals.IS_REACT_ACT_ENVIRONMENT

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    location: { reload: vi.fn() },
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

  globals.IS_REACT_ACT_ENVIRONMENT = true
  globals.window = fakeWin
  globals.document = docWithFactories

  const container = docWithFactories.createElement("div")
  const root = createRoot(container as never)

  return {
    container,
    async render(node: React.ReactNode) {
      await act(async () => {
        root.render(node)
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      globals.window = prevWin
      globals.document = prevDoc
      globals.IS_REACT_ACT_ENVIRONMENT = prevAct
    },
  }
}

describe("@orahako/ui-network-activity", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("persists activity settings store in scoped local storage and formats durations", async () => {
    expect(isActivityDensity("compact")).toBe(true)
    expect(isActivityDensity("detailed")).toBe(true)
    expect(isActivityDensity("debug")).toBe(true)
    expect(isActivityDensity("invalid")).toBe(false)

    expect(formatDuration(12)).toBe("12ms")
    expect(formatDuration(1540)).toBe("1.5s")
    expect(formatDuration(12_400)).toBe("12s")

    const memory = new Map<string, string>()
    const storage = createScopedStorage("orahako.network-activity", {
      local: {
        getItem: async (key) => memory.get(key) ?? null,
        setItem: async (key, val) => {
          memory.set(key, val)
        },
        removeItem: async (key) => {
          memory.delete(key)
        },
      },
    })

    const first = activitySettingsStore.create(storage)
    first.actions.setDensity("debug")
    first.actions.setShowTiming(true)
    first.actions.setShowMascots(true)
    first.actions.setLongMascots(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    first.dispose()

    const second = activitySettingsStore.create(storage)
    await vi.waitFor(() => expect(second.hydrated.getSnapshot()).toBe(true))
    expect(second.source.getSnapshot()).toEqual({
      density: "debug",
      showTiming: true,
      showMascots: true,
      longMascots: true,
    })
    second.dispose()
  })

  it("registers strip, mascots, and settings category and renders pure derived-props views", async () => {
    vi.useFakeTimers()
    const runtime = new PluginRuntime()
    let http!: PluginHttpService
    let router!: PluginRouterService

    const observerPlugin = definePlugin({
      manifest: {
        id: "test.observer",
        name: "Observer",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["http", "router", "i18n"],
      },
      inject: ["http", "router", "i18n"] as const,
      apply(ctx) {
        http = ctx.http
        router = ctx.router
        ctx.i18n.register({
          zh: { custom: { fetchGrades: "拉取成绩单" } },
          en: { custom: { fetchGrades: "Fetching grades" } },
        })
        ctx.http.activity.registerLabeler((url) =>
          url.includes("/grades") ? "custom.fetchGrades" : undefined
        )
        ctx.http.activity.registerClassifier((url) =>
          url.includes("/grades") ? "academic" : undefined
        )
      },
    })

    try {
      runtime.register(slotRegistryPlugin, "builtin")
      runtime.register(settingsRegistryPlugin, "builtin")
      runtime.register(i18nRegistryPlugin, "builtin")
      runtime.register(storageRuntimePlugin, "builtin")
      runtime.register(httpRuntimePlugin, "builtin")
      runtime.register(routerRuntimePlugin, "builtin", { initialHref: "/?route=overview" })
      runtime.register(networkActivityPlugin, "builtin")
      runtime.register(observerPlugin, "builtin")

      for (const id of [
        slotRegistryPlugin.manifest.id,
        settingsRegistryPlugin.manifest.id,
        i18nRegistryPlugin.manifest.id,
        storageRuntimePlugin.manifest.id,
        httpRuntimePlugin.manifest.id,
        routerRuntimePlugin.manifest.id,
        networkActivityPlugin.manifest.id,
        observerPlugin.manifest.id,
      ]) {
        await runtime.startAndWait(id)
      }

      const slots = runtime.context.get("slots") as PluginSlotRegistry
      const i18n = runtime.context.get("i18n") as PluginI18nRegistry
      const settings = runtime.context.get("settings")!

      // Declare shell slots after plugin started -> slots.inject activates!
      const disposeActivitySlot = slots.declare({ name: "shell.activity", kind: "list" })
      const disposeOverlaySlot = slots.declare({ name: "shell.overlay", kind: "list" })

      const stripEntry = slots.select("shell.activity")[0]
      const mascotEntry = slots.select("shell.overlay")[0]
      const categoryEntry = settings.getSnapshot().find((c) => c.id === "network-activity")
      expect(stripEntry).toBeDefined()
      expect(mascotEntry).toBeDefined()
      expect(categoryEntry).toBeDefined()

      // Settings category renders bilingual labels cleanly
      const settingsHtmlZh = renderToStaticMarkup(
        <ContributionOutlet entry={categoryEntry!} slots={slots} i18n={i18n} />
      )
      expect(settingsHtmlZh).toContain("显示模式")
      expect(settingsHtmlZh).toContain("显示嘿咻")

      i18n.setLocale("en")
      const settingsHtmlEn = renderToStaticMarkup(
        <ContributionOutlet entry={categoryEntry!} slots={slots} i18n={i18n} />
      )
      expect(settingsHtmlEn).toContain("Display mode")
      expect(settingsHtmlEn).toContain("Show Heixiu")
      i18n.setLocale("zh")

      // Active request renders external label in compact strip
      const finishReq = http.activity.beginRequest("https://jwxt.ysu.edu.cn/grades", "GET")
      const finishReq2 = http.activity.beginRequest("https://cer.ysu.edu.cn/login", "POST")
      const compactHtml = renderToStaticMarkup(
        <ContributionOutlet entry={stripEntry!} slots={slots} i18n={i18n} />
      )
      expect(compactHtml).toContain("拉取成绩单")
      expect(compactHtml).toContain("+1")

      // Interactive mount for mascots debounce + login route hiding + density modes
      const dom = mountDom()
      await dom.render(<ContributionOutlet entry={mascotEntry!} slots={slots} i18n={i18n} />)
      expect(dom.container.toHtml()).toBe("<div></div>")

      await act(async () => {
        vi.advanceTimersByTime(250)
      })
      expect(dom.container.toHtml()).toContain("data-network-mascots")

      // Navigating to login hides mascots immediately
      await act(async () => {
        router.push({ route: "login" })
      })
      expect(dom.container.toHtml()).not.toContain("data-network-mascots")

      // Switch store to detailed and debug modes via shared store instance
      const sharedStore = categoryEntry!.store as ReturnType<typeof activitySettingsStore.create>
      await act(async () => {
        sharedStore.actions.setDensity("detailed")
      })
      const detailedHtml = renderToStaticMarkup(
        <ContributionOutlet entry={stripEntry!} slots={slots} i18n={i18n} />
      )
      expect(detailedHtml).toContain("加载中")
      expect(detailedHtml).toContain("拉取成绩单")

      await act(async () => {
        finishReq("ok")
        finishReq2("error")
        sharedStore.actions.setDensity("debug")
      })
      await dom.render(<ContributionOutlet entry={stripEntry!} slots={slots} i18n={i18n} />)
      let finishReq3!: (outcome?: "ok" | "error" | "aborted") => void
      await act(async () => {
        finishReq3 = http.activity.beginRequest("https://jwxt.ysu.edu.cn/grades", "GET")
      })
      expect(dom.container.textContent).toContain("加载流")
      expect(dom.container.textContent).toContain("失败")
      await act(async () => {
        finishReq3("ok")
      })

      await dom.unmount()
      disposeActivitySlot()
      disposeOverlaySlot()
      expect(slots.select("shell.activity")).toHaveLength(0)
      expect(slots.select("shell.overlay")).toHaveLength(0)
    } finally {
      runtime.dispose()
    }
  })
})
