import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PluginHost } from "@orahako/kernel"
import {
  defineDictionary,
  definePlugin,
  PLUGIN_API_VERSION,
  validatePluginManifest,
  type CompositionSource,
  type PluginNativeCapabilityService,
  type PluginNativeService,
} from "@orahako/sdk"
import { httpRuntimePlugin } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { nativeRuntimePlugin } from "@orahako/runtime-native"
import { navigationRuntimePlugin, PluginRouter, routerRuntimePlugin } from "@orahako/runtime-router"
import { settingsRegistryPlugin } from "@orahako/runtime-settings"
import { OrahakoApp, slotRegistryPlugin } from "@orahako/runtime-slots"
import { storageRuntimePlugin } from "@orahako/runtime-storage"
import { uiRegistryPlugin } from "@orahako/runtime-ui"
import { themeDefaultPlugin } from "@orahako/theme-default"
import { useBackLayer } from "@orahako/ui-primitives"
import { PROFILE_PLUGIN_ID, uiProfilePlugin } from "@orahako/ui-profile"
import { SETTINGS_PLUGIN_ID, uiSettingsPlugin } from "@orahako/ui-settings"
import {
  appearanceStore,
  attachDeepLinkListener,
  attachNativeWebViewLifecycle,
  BackgroundMediaController,
  buildCardStyleCss,
  canUsePageViewTransition,
  computeCardBgOpacity,
  manifest,
  NATIVE_WEBVIEW_CAPABILITY,
  PAGE_TRANSITION_STYLE,
  parseDeepLink,
  resolvePageOutletTransitionMode,
  SHELL_PLUGIN_ID,
  uiShellPlugin,
} from "../src"

class MiniNode {
  readonly nodeType: number
  readonly nodeName: string
  readonly tagName?: string
  readonly namespaceURI = "http://www.w3.org/1999/xhtml"
  readonly childNodes: MiniNode[] = []
  parentNode: MiniNode | null = null
  ownerDocument: MiniNode | null = null
  defaultView: unknown = undefined
  nodeValue?: string
  readonly styleProps = new Map<string, string>()
  readonly classes = new Set<string>()
  readonly style: Record<string, unknown>
  readonly classList: {
    add: (...tokens: string[]) => void
    remove: (...tokens: string[]) => void
    toggle: (token: string, force?: boolean) => boolean
    contains: (token: string) => boolean
  }
  readonly attributes = new Map<string, string>()
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()
  private rawText = ""

  constructor(nodeType: number, nodeName: string) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    if (nodeType === 1) this.tagName = nodeName
    this.style = {
      setProperty: (k: string, v: string) => {
        this.styleProps.set(k, v)
      },
      removeProperty: (k: string) => {
        this.styleProps.delete(k)
      },
      getPropertyValue: (k: string) => this.styleProps.get(k) ?? "",
    }
    this.classList = {
      add: (...tokens: string[]) => {
        for (const t of tokens) this.classes.add(t)
      },
      remove: (...tokens: string[]) => {
        for (const t of tokens) this.classes.delete(t)
      },
      toggle: (token: string, force?: boolean) => {
        const next = force ?? !this.classes.has(token)
        if (next) this.classes.add(token)
        else this.classes.delete(token)
        return next
      },
      contains: (token: string) => this.classes.has(token),
    }
  }

  get firstChild(): MiniNode | null {
    return this.childNodes[0] ?? null
  }

  get nextSibling(): MiniNode | null {
    if (!this.parentNode) return null
    const idx = this.parentNode.childNodes.indexOf(this)
    return idx >= 0 ? (this.parentNode.childNodes[idx + 1] ?? null) : null
  }

  appendChild(child: MiniNode): MiniNode {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  insertBefore(child: MiniNode, before: MiniNode | null): MiniNode {
    if (!before) return this.appendChild(child)
    if (child.parentNode) child.parentNode.removeChild(child)
    const idx = this.childNodes.indexOf(before)
    child.parentNode = this
    if (idx >= 0) this.childNodes.splice(idx, 0, child)
    else this.childNodes.push(child)
    return child
  }

  removeChild(child: MiniNode): MiniNode {
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

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
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

  getBoundingClientRect(): { width: number; height: number } {
    return { width: 288, height: 64 }
  }

  closest(): null {
    return null
  }

  querySelector(): null {
    return null
  }

  querySelectorAll(): MiniNode[] {
    return []
  }

  findByAttr(attrName: string, attrValue?: string): MiniNode | undefined {
    if (
      this.attributes.has(attrName) &&
      (attrValue === undefined || this.attributes.get(attrName) === attrValue)
    ) {
      return this
    }
    for (const child of this.childNodes) {
      const found = child.findByAttr(attrName, attrValue)
      if (found) return found
    }
    return undefined
  }

  set textContent(val: string) {
    this.childNodes.length = 0
    this.rawText = String(val)
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

function mountShellDom() {
  const prevWin = globalThis.window
  const prevDoc = globalThis.document
  const prevAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT
  const prevForm = (globalThis as Record<string, unknown>).HTMLFormElement
  const prevInput = (globalThis as Record<string, unknown>).HTMLInputElement

  const doc = new MiniNode(9, "#document")
  const docElement = new MiniNode(1, "HTML")
  const body = new MiniNode(1, "BODY")
  doc.appendChild(docElement)
  docElement.appendChild(body)

  class FakeHTMLFormElement {}
  class FakeHTMLInputElement {
    private val = ""
    get value(): string {
      return this.val
    }
    set value(next: string) {
      this.val = next
    }
  }

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    HTMLFormElement: FakeHTMLFormElement,
    HTMLInputElement: FakeHTMLInputElement,
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    screen: { width: 1280, height: 800 },
    getComputedStyle: () => ({
      direction: "ltr",
      getPropertyValue: () => "",
    }),
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  doc.defaultView = fakeWin

  const docObj = Object.assign(doc, {
    documentElement: docElement,
    body,
    cookie: "",
    activeElement: null,
    querySelector: () => null,
    createElement(tag: string) {
      const el = new MiniNode(1, tag.toUpperCase())
      el.ownerDocument = docObj
      return el
    },
    createElementNS(_ns: string, tag: string) {
      return docObj.createElement(tag)
    },
    createTextNode(text: string) {
      const node = new MiniNode(3, "#text")
      node.nodeValue = String(text)
      node.ownerDocument = docObj
      return node
    },
    createComment(text: string) {
      const node = new MiniNode(8, "#comment")
      node.nodeValue = String(text)
      node.ownerDocument = docObj
      return node
    },
  })

  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as Record<string, unknown>).HTMLFormElement = FakeHTMLFormElement
  ;(globalThis as Record<string, unknown>).HTMLInputElement = FakeHTMLInputElement
  ;(globalThis as Record<string, unknown>).window = fakeWin
  ;(globalThis as Record<string, unknown>).document = docObj

  const container = docObj.createElement("div")
  body.appendChild(container)
  const root = createRoot(container as never)

  return {
    container,
    docElement,
    async render(node: React.ReactNode) {
      await act(async () => {
        root.render(node)
      })
    },
    async unmount() {
      await act(async () => {
        root.unmount()
      })
      ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = prevAct
      ;(globalThis as Record<string, unknown>).HTMLFormElement = prevForm
      ;(globalThis as Record<string, unknown>).HTMLInputElement = prevInput
      ;(globalThis as Record<string, unknown>).window = prevWin
      ;(globalThis as Record<string, unknown>).document = prevDoc
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

function DummyIcon() {
  return null
}

function BackLayerProbe() {
  const [open, setOpen] = useState(true)
  useBackLayer(() => setOpen(false), open)
  return <span>{open ? "BACK_LAYER_OPEN" : "BACK_LAYER_CLOSED"}</span>
}

describe("@orahako/ui-shell unit helpers", () => {
  it("validates manifest, appearance store, card CSS variables, and background media controller", async () => {
    const validated = validatePluginManifest(manifest)
    expect(validated.id).toBe(SHELL_PLUGIN_ID)
    expect(validated.kind).toBe("shell")
    expect(validated.required).toBe(true)
    expect(validated.inject).toEqual([
      "ui",
      "slots",
      "router",
      "navigation",
      "i18n",
      "storage",
      "native",
      "packageRuntime",
    ])

    const store = appearanceStore.create()
    store.actions.setCardStyle("glass")
    store.actions.setCardOpacity(80)
    store.actions.setBackgroundStyle("blur-overlay")
    store.actions.setBackgroundOverlayOpacity(60)
    store.actions.setBackgroundBlurAmount(24)
    store.actions.setColorMode("dark")
    store.actions.setSidebarWidth(500) // clamped to MAX_SIDEBAR_WIDTH (384)

    expect(store.source.getSnapshot()).toMatchObject({
      cardStyle: "glass",
      cardOpacity: 80,
      backgroundStyle: "blur-overlay",
      backgroundOverlayOpacity: 60,
      backgroundBlurAmount: 24,
      colorMode: "dark",
      sidebarWidth: 384,
    })

    expect(store.source.getSnapshot()).not.toHaveProperty("defaultLandingPage")
    expect(computeCardBgOpacity(false, "glass", 80)).toBe("1")
    expect(computeCardBgOpacity(true, "solid", 80)).toBe("1")
    expect(computeCardBgOpacity(true, "translucent", 80)).toBe("0.8")
    expect(computeCardBgOpacity(true, "glass", 80)).toBe("0.7")
    expect(buildCardStyleCss("glass", 90)).toContain("backdrop-filter: blur(12px)")
    expect(buildCardStyleCss("translucent", 75)).toContain("75%")
    expect(buildCardStyleCss("solid", 100)).toBe("")
    store.dispose()

    const media = new BackgroundMediaController({ isNative: () => false })
    const sampleDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
    const token = await media.save(sampleDataUrl)
    expect(token).toBe("background-image.jpg")
    const savedUrl = media.urlSource.getSnapshot()
    expect(savedUrl).toBeTruthy()

    // Re-syncing the same token (e.g. when unrelated appearance sliders change) must be a no-op.
    const urlChangeSpy = vi.fn()
    const unsubMedia = media.urlSource.subscribe(urlChangeSpy)
    await media.syncToken(token)
    await media.syncToken(token)
    expect(urlChangeSpy).not.toHaveBeenCalled()
    expect(media.urlSource.getSnapshot()).toBe(savedUrl)

    // Saving a replacement image forces an update even though the storage token stays the same.
    const secondDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    await media.save(secondDataUrl)
    expect(urlChangeSpy).toHaveBeenCalledTimes(1)
    expect(media.urlSource.getSnapshot()).not.toBe(savedUrl)
    unsubMedia()

    await media.remove()
    expect(media.urlSource.getSnapshot()).toBeNull()
    media.dispose()
  })

  it("handles parseDeepLink, warm/cold Capacitor deep-link routing, and native.webview@1 initSafeArea + check", async () => {
    const navigation = {
      resolve: (id: string) =>
        id === "schedule"
          ? { pluginId: "orahako.schedule", pageId: "index", source: "page" as const }
          : undefined,
      sources: () => ({ pages: [], navigation: [], fallbackHref: "/?route=me" }),
    }

    expect(parseDeepLink("orahako://schedule", navigation, "orahako")).toBe(
      "/?plugin=orahako.schedule&page=index"
    )
    expect(parseDeepLink("other://schedule", navigation, "orahako")).toBeNull()

    const router = new PluginRouter({
      initialHref: "/?plugin=orahako.profile&page=me",
      window: null,
      hardwareBack: null,
    })
    let warmUrlHandler: ((ev: { readonly url: string }) => void) | undefined
    const removeSpy = vi.fn(async () => {})

    const disposeDeepLink = attachDeepLinkListener({
      isNative: () => true,
      scheme: "orahako",
      navigation,
      router,
      appAdapter: {
        async addListener(_name, fn) {
          warmUrlHandler = fn
          return { remove: removeSpy }
        },
        async getLaunchUrl() {
          return { url: "orahako://schedule" }
        },
      },
    })

    await vi.waitFor(() =>
      expect(router.current.getSnapshot().href).toBe("/?plugin=orahako.schedule&page=index")
    )

    // Duplicate warm URL to current destination is ignored cleanly
    const pushSpy = vi.spyOn(router, "push")
    warmUrlHandler?.({ url: "orahako://schedule" })
    expect(pushSpy).not.toHaveBeenCalled()

    disposeDeepLink()
    expect(removeSpy).toHaveBeenCalledOnce()
    router.dispose()

    // Test native.webview@1 initSafeArea (mount + resize) and check(locale)
    const invokedCalls: Array<{ id: string; method: string; payload?: Record<string, unknown> }> =
      []
    let resizeHandler: (() => void) | undefined
    const mockCapabilities: PluginNativeCapabilityService = {
      list: () => [{ id: "native.webview", version: 1, methods: ["initSafeArea", "check"] }],
      has: (id) => id === NATIVE_WEBVIEW_CAPABILITY,
      acquire: async () => async () => {},
      invoke: async <T,>(id: string, method: string, payload?: Record<string, unknown>) => {
        invokedCalls.push({ id, method, ...(payload !== undefined ? { payload } : {}) })
        return {} as T
      },
    }
    const mockNative: PluginNativeService = {
      isNative: true,
      capabilities: mockCapabilities,
      saveImage: async () => ({ uri: "" }),
      requestNotificationPermission: async () => true,
      requestExactAlarmPermission: async () => true,
      requestBatteryOptimizationExemption: async () => true,
    }

    const disposeWebView = attachNativeWebViewLifecycle({
      native: mockNative,
      getLocale: () => "zh",
      targetWindow: {
        addEventListener(_type, fn) {
          resizeHandler = fn
        },
        removeEventListener() {
          resizeHandler = undefined
        },
      },
    })

    expect(invokedCalls).toEqual([
      { id: "native.webview@1", method: "initSafeArea" },
      { id: "native.webview@1", method: "check", payload: { locale: "zh" } },
    ])
    resizeHandler?.()
    expect(invokedCalls).toHaveLength(3)
    expect(invokedCalls[2]).toEqual({ id: "native.webview@1", method: "initSafeArea" })

    disposeWebView()
    expect(resizeHandler).toBeUndefined()
  })
})

describe("Non-Academic Community Composition Integration (<OrahakoApp />)", () => {
  it("boots runtime-* + ui-shell + ui-settings + ui-profile + theme-default + community plugins with ZERO academic services", async () => {
    const dom = mountShellDom()
    activeUnmount = dom.unmount

    const communityDict = defineDictionary({
      zh: {
        board: "社区广场",
        chat: "讨论组",
        catTitle: "社区偏好",
        catDesc: "管理社区通知与版式",
        catPanel: "社区面板已挂载",
      },
      en: {
        board: "Community Board",
        chat: "Discussion",
        catTitle: "Community Preferences",
        catDesc: "Manage community layout",
        catPanel: "CommunityPanelMounted",
      },
    })

    // Community feature plugin with:
    // - shell.gate chain wrapper
    // - shell.banner, shell.activity, shell.header.actions, shell.overlay contributions
    // - app navigation + plugin-scoped mobile tab navigation (`scope: "plugin"`)
    // - fullscreen subpage
    // - settings category bridged into `settings.category.panel`
    // - custom Sakura theme
    const communityPlugin = definePlugin({
      manifest: {
        id: "community.forum",
        name: "Community Forum",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        providerIndependent: true,
      },
      inject: ["ui", "slots", "settings"],
      apply(ctx) {
        ctx.ui.registerTheme({
          id: "sakura",
          name: "樱花粉",
          css: ":root { --primary: oklch(0.7 0.2 350); }",
        })

        ctx.ui.registerPage(
          {
            id: "board",
            route: "board",
            titleKey: "board",
            requiresProvider: false,
            primary: true,
            dictionary: communityDict,
          },
          (props) => <div>FORUM_BOARD:{props.t("board")}</div>
        )

        ctx.ui.registerPage(
          {
            id: "chat",
            titleKey: "chat",
            requiresProvider: false,
            parent: "board",
            fullscreen: true,
            dictionary: communityDict,
          },
          (props) => (
            <div>
              FORUM_CHAT:{props.t("chat")}:<BackLayerProbe />
            </div>
          )
        )

        ctx.ui.registerNavigation({
          id: "forum",
          titleKey: "board",
          page: "board",
          icon: DummyIcon,
          group: "main",
          order: 10,
          primary: true,
        })

        // Scoped plugin navigation replaces mobile bottom tabs while community.forum is active!
        ctx.ui.registerNavigation({
          id: "forum-tab-board",
          scope: "plugin",
          titleKey: "board",
          page: "board",
          icon: DummyIcon,
          order: 1,
        })
        ctx.ui.registerNavigation({
          id: "forum-tab-chat",
          scope: "plugin",
          titleKey: "chat",
          page: "chat",
          icon: DummyIcon,
          order: 2,
        })

        ctx.slots.inject("shell.gate", (sCtx) =>
          sCtx.slots.register({ id: "community-gate", slot: "shell.gate", order: 10 }, (props) => (
            <div data-community-gate="pass">{props.children}</div>
          ))
        )

        ctx.slots.inject("shell.banner", (sCtx) =>
          sCtx.slots.register({ id: "community-banner", slot: "shell.banner" }, () => (
            <div>COMMUNITY_BANNER</div>
          ))
        )

        ctx.slots.inject("shell.activity", (sCtx) =>
          sCtx.slots.register({ id: "community-activity", slot: "shell.activity" }, () => (
            <span>ACTIVITY_DOT</span>
          ))
        )

        ctx.slots.inject("shell.header.actions", (sCtx) =>
          sCtx.slots.register(
            { id: "community-header-action", slot: "shell.header.actions" },
            () => <span>HEADER_ACTION</span>
          )
        )

        ctx.slots.inject("shell.overlay", (sCtx) =>
          sCtx.slots.register({ id: "community-overlay", slot: "shell.overlay" }, () => (
            <div>COMMUNITY_OVERLAY</div>
          ))
        )

        ctx.settings.registerCategory(
          {
            id: "community-prefs",
            titleKey: "catTitle",
            descriptionKey: "catDesc",
            icon: DummyIcon,
            dictionary: communityDict,
          },
          (props) => <div>{props.t("catPanel")}</div>
        )
      },
    })

    const source: CompositionSource = {
      appVersion: "0.16.0",
      appBuild: "community-1",
      composition: {
        id: "community.app",
        version: 1,
        defaults: {
          shell: "orahako.shell:default",
          landing: "board",
        },
        plugins: [
          { id: "orahako.runtime.storage", protected: true },
          { id: "orahako.runtime.slots", protected: true },
          { id: "orahako.runtime.ui", protected: true },
          { id: "orahako.runtime.i18n", protected: true },
          { id: "orahako.runtime.router", protected: true, config: { initialHref: "/" } },
          { id: "orahako.runtime.navigation", protected: true },
          { id: "orahako.runtime.settings", protected: true },
          { id: "orahako.runtime.http", protected: true },
          { id: "orahako.runtime.native", protected: true },
          {
            id: SHELL_PLUGIN_ID,
            protected: true,
            config: { appName: "社区盒", appNameEn: "CommunityBox" },
          },
          { id: SETTINGS_PLUGIN_ID, protected: true },
          {
            id: PROFILE_PLUGIN_ID,
            protected: true,
            config: { appName: "社区盒", appNameEn: "CommunityBox" },
          },
          { id: "orahako.theme.default", protected: true },
          { id: "community.forum" },
        ],
      },
      plugins: [
        storageRuntimePlugin,
        slotRegistryPlugin,
        uiRegistryPlugin,
        i18nRegistryPlugin,
        routerRuntimePlugin,
        navigationRuntimePlugin,
        settingsRegistryPlugin,
        httpRuntimePlugin,
        nativeRuntimePlugin,
        uiShellPlugin,
        uiSettingsPlugin,
        uiProfilePlugin,
        themeDefaultPlugin,
        communityPlugin,
      ],
    }

    const host = new PluginHost(source, { platformModules: {} })
    await host.bootstrap()

    // Verify ZERO academic services exist on Cordis context AND zero load errors occurred!
    expect(host.loadErrors.size).toBe(0)
    expect(host.runtime.context.get("providers")).toBeUndefined()
    expect(host.runtime.context.get("provider")).toBeUndefined()
    expect(host.runtime.context.get("session")).toBeUndefined()
    expect(host.runtime.context.get("query")).toBeUndefined()

    const router = host.runtime.context.get("router") as PluginRouter

    // A stored startup preference wins over the composition default landing.
    host.preferences.setStartupPage("settings")
    await dom.render(<OrahakoApp host={host} />)
    expect(router.current.getSnapshot().href).toBe("/?plugin=orahako.settings&page=settings")

    // Clearing the preference falls back to defaults.landing (`board`).
    await act(async () => {
      host.preferences.setStartupPage(undefined)
      router.push("/")
    })
    expect(router.current.getSnapshot().href).toBe("/?plugin=community.forum&page=board")

    // 1. With no startup preference, root launch falls back to `board`, wrapped in
    // `shell.gate`, with sidebar footer & plugin-scoped mobile bottom nav!
    expect(dom.container.toHtml()).toContain('data-community-gate="pass"')
    expect(dom.container.textContent).toContain("社区盒")
    expect(dom.container.textContent).toContain("FORUM_BOARD:社区广场")
    expect(dom.container.textContent).toContain("COMMUNITY_BANNER")
    expect(dom.container.findByAttr("data-shell-banners")?.getAttribute("class")).toContain(
      "empty:hidden"
    )
    // The responsive header mounts each slot contribution exactly once across breakpoints.
    expect(dom.container.toHtml().match(/ACTIVITY_DOT/g)).toHaveLength(1)
    expect(dom.container.toHtml().match(/HEADER_ACTION/g)).toHaveLength(1)
    const shellHeader = dom.container.findByAttr("data-shell-header")
    expect(shellHeader).toBeDefined()
    expect(shellHeader?.getAttribute("class")).toContain("md:pt-4 md:pb-4")
    expect(shellHeader?.getAttribute("class")).not.toContain("md:pt-0")
    // Profile's `me` nav item sets `sidebar: false` so desktop sidebar doesn't duplicate SidebarProfileFooter.
    const sidebarContent = dom.container.findByAttr("data-slot", "sidebar-content")
    expect(sidebarContent?.textContent).not.toContain("我的")
    expect(dom.container.findByAttr("data-sidebar-profile-footer")).toBeDefined()
    expect(dom.container.textContent).toContain("COMMUNITY_OVERLAY")
    // Plugin-scoped mobile bottom nav shows both `社区广场` and `讨论组` tabs while `community.forum` is active!
    expect(dom.container.textContent).toContain("讨论组")

    // Theme selection is a single host preference rendered by OrahakoApp, not a shell-local channel.
    await act(async () => {
      host.preferences.setActiveTheme("community.forum:sakura")
    })
    expect(dom.container.toHtml()).toContain('data-plugin-theme="community.forum:sakura"')
    expect(dom.container.toHtml()).toContain("--primary: oklch(0.7 0.2 350)")
    expect(dom.container.toHtml()).not.toContain("data-shell-theme=")
    await act(async () => {
      host.preferences.setActiveTheme("")
    })
    expect(dom.container.toHtml()).not.toContain("data-plugin-theme")

    // 2. Navigate to fullscreen subpage `chat` -> hides mobile bottom nav & shows back button!
    await act(async () => {
      router.push({ pluginId: "community.forum", pageId: "chat" })
    })
    expect(dom.container.textContent).toContain("FORUM_CHAT:讨论组")
    expect(dom.container.findByAttr("data-shell-back")).toBeDefined()
    expect(dom.container.findByAttr("data-shell-bottom-nav")).toBeUndefined()
    expect(dom.container.textContent).toContain("BACK_LAYER_OPEN")

    await act(async () => {
      router.back()
    })
    expect(dom.container.textContent).toContain("BACK_LAYER_CLOSED")
    expect(router.current.getSnapshot().pageId).toBe("chat")

    await act(async () => {
      router.back()
    })
    expect(router.current.getSnapshot().pageId).toBe("board")
    expect(dom.container.findByAttr("data-shell-bottom-nav")).toBeDefined()

    // 3. Settings links to a standalone theme page with live, scoped previews.
    await act(async () => {
      router.push("/?route=settings")
    })
    expect(router.current.getSnapshot().href).toBe("/?plugin=orahako.settings&page=settings")
    expect(dom.container.textContent).toContain("深浅模式")
    expect(dom.container.textContent).toContain("默认主题")
    expect(dom.container.textContent).toContain("背景图")
    expect(dom.container.textContent).toContain("自定义头像")
    expect(dom.container.textContent).toContain("社区偏好")
    expect(dom.container.findByAttr("data-settings-theme-link")?.getAttribute("href")).toBe(
      "/?route=theme"
    )
    expect(dom.container.findByAttr("data-settings-custom-theme")).toBeUndefined()

    await act(async () => {
      router.push({ route: "theme" })
    })
    expect(dom.container.findByAttr("data-page", "theme")).toBeDefined()
    expect(dom.container.textContent).toContain("默认主题")
    expect(dom.container.textContent).toContain("樱花粉")
    expect(dom.container.toHtml().match(/<iframe data-theme-preview="\d+"/g)).toHaveLength(2)
    expect(dom.container.toHtml()).toContain("sandbox")
    expect(dom.container.toHtml()).toContain(":root { --primary: oklch(0.7 0.2 350); }")

    // 4. Navigate to bridged category detail page -> renders `Community Preferences` panel via `settings.category.panel`!
    await act(async () => {
      router.push("/?plugin=orahako.settings&page=category&category=community-prefs")
    })
    expect(dom.container.textContent).toContain("社区面板已挂载")

    // 5. Navigate to Background page -> renders upload & style controls from ui-shell!
    await act(async () => {
      router.push({ route: "background" })
    })
    expect(router.current.getSnapshot().href).toBe("/?plugin=orahako.shell&page=background")
    expect(dom.container.textContent).toContain("背景图设置")
    expect(dom.container.textContent).toContain("毛玻璃遮罩")

    await act(async () => {
      router.push({ route: "me" })
    })
    expect(dom.container.findByAttr("data-shell-theme-toggle")).toBeDefined()

    // 6. Switch locale to English -> full app re-renders in English!
    await act(async () => {
      host.i18n?.setLocale("en")
    })
    expect(renderToStaticMarkup(<OrahakoApp host={host} />)).toContain("Preferences")

    activeUnmount = undefined
    await dom.unmount()
    host.dispose()
  })

  it("uses View Transitions API when available and keeps glass fallback free of Backdrop Roots", async () => {
    // 1. Style and helper invariants
    expect(PAGE_TRANSITION_STYLE).toContain('data-shell-view-transition="page"')
    expect(PAGE_TRANSITION_STYLE).toContain("::view-transition-new(root)")
    expect(PAGE_TRANSITION_STYLE).not.toMatch(/\bfilter\s*:/)

    expect(
      resolvePageOutletTransitionMode({
        fullscreen: false,
        useViewTransition: true,
        hasBackground: true,
        isGlassCards: true,
      })
    ).toBe("slide")
    expect(
      resolvePageOutletTransitionMode({
        fullscreen: false,
        useViewTransition: false,
        hasBackground: true,
        isGlassCards: true,
      })
    ).toBe("slide")
    expect(
      resolvePageOutletTransitionMode({
        fullscreen: false,
        useViewTransition: false,
        hasBackground: false,
        isGlassCards: true,
      })
    ).toBe("enter")
    expect(
      resolvePageOutletTransitionMode({
        fullscreen: true,
        useViewTransition: true,
        hasBackground: false,
        isGlassCards: false,
      })
    ).toBe("none")

    expect(
      canUsePageViewTransition(
        { visibilityState: "visible", startViewTransition: vi.fn() as never },
        { matchMedia: () => ({ matches: false }) }
      )
    ).toBe(true)
    expect(
      canUsePageViewTransition(
        { visibilityState: "hidden", startViewTransition: vi.fn() as never },
        { matchMedia: () => ({ matches: false }) }
      )
    ).toBe(false)
    expect(
      canUsePageViewTransition(
        { visibilityState: "visible", startViewTransition: vi.fn() as never },
        { matchMedia: () => ({ matches: true }) }
      )
    ).toBe(false)

    // 2. Mounted shell View Transition lifecycle
    const dom = mountShellDom()
    activeUnmount = dom.unmount

    const pendingCallbacks: Array<() => void | Promise<void>> = []
    const finishResolvers: Array<() => void> = []
    const skipSpies: Array<ReturnType<typeof vi.fn>> = []

    const docWithVt = globalThis.document as unknown as {
      visibilityState?: string
      startViewTransition?: (cb: () => void | Promise<void>) => {
        finished: Promise<void>
        skipTransition: () => void
      }
    }
    docWithVt.visibilityState = "visible"
    docWithVt.startViewTransition = vi.fn((cb: () => void | Promise<void>) => {
      pendingCallbacks.push(cb)
      const skip = vi.fn()
      skipSpies.push(skip)
      const finished = new Promise<void>((resolve) => {
        finishResolvers.push(resolve)
      })
      return { finished, skipTransition: skip }
    })

    const pagesPlugin = definePlugin({
      manifest: {
        id: "demo.vt",
        name: "VT Demo",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["ui", "navigation"],
      },
      inject: ["ui", "navigation"] as const,
      apply(ctx) {
        ctx.ui.registerPage(
          { id: "alpha", route: "alpha", title: "Alpha", root: true, requiresProvider: false },
          () => <div>PAGE_ALPHA</div>
        )
        ctx.ui.registerPage(
          { id: "beta", route: "beta", title: "Beta", requiresProvider: false },
          () => <div>PAGE_BETA</div>
        )
        ctx.ui.registerPage(
          { id: "gamma", route: "gamma", title: "Gamma", requiresProvider: false },
          () => <div>PAGE_GAMMA</div>
        )
      },
    })

    const host = new PluginHost(
      {
        appVersion: "1.0.0",
        appBuild: "test-vt",
        composition: {
          version: 1,
          id: "test.vt",
          defaults: {
            shell: `${SHELL_PLUGIN_ID}:default`,
            landing: "alpha",
          },
          plugins: [
            { id: "orahako.runtime.storage", protected: true },
            { id: "orahako.runtime.slots", protected: true },
            { id: "orahako.runtime.ui", protected: true },
            { id: "orahako.runtime.i18n", protected: true },
            { id: "orahako.runtime.router", protected: true },
            { id: "orahako.runtime.navigation", protected: true },
            { id: "orahako.runtime.native", protected: true },
            { id: SHELL_PLUGIN_ID, protected: true },
            { id: "orahako.theme.default", protected: true },
            { id: "demo.vt" },
          ],
        },
        plugins: [
          storageRuntimePlugin,
          slotRegistryPlugin,
          uiRegistryPlugin,
          i18nRegistryPlugin,
          routerRuntimePlugin,
          navigationRuntimePlugin,
          nativeRuntimePlugin,
          uiShellPlugin,
          themeDefaultPlugin,
          pagesPlugin,
        ],
      },
      { platformModules: {} }
    )
    await host.bootstrap()
    const router = host.runtime.context.get("router") as PluginRouter

    await dom.render(<OrahakoApp host={host} />)
    expect(dom.container.textContent).toContain("PAGE_ALPHA")
    expect(docWithVt.startViewTransition).not.toHaveBeenCalled()
    expect(
      dom.container.findByAttr("data-shell-page-outlet")?.getAttribute("data-shell-transition")
    ).toBe("slide")

    // Navigate Alpha -> Beta: outlet hides during old-state capture so the old
    // page clears immediately (no cross-fade ghosting) and slide waits for reveal.
    await act(async () => {
      router.push({ pluginId: "demo.vt", pageId: "beta" })
    })
    expect(docWithVt.startViewTransition).toHaveBeenCalledTimes(1)
    expect(dom.docElement.getAttribute("data-shell-view-transition")).toBe("page")
    const capturingOutlet = dom.container.findByAttr("data-shell-page-outlet")
    expect(capturingOutlet?.hasAttribute("data-shell-capturing")).toBe(true)
    expect(capturingOutlet?.getAttribute("data-shell-transition")).toBeNull()

    // Browser invokes updateCallback -> outlet reveals Beta with upward slide and resolves Promise.
    let callbackResolved = false
    await act(async () => {
      const result = pendingCallbacks.shift()?.()
      if (result) {
        void result.then(() => {
          callbackResolved = true
        })
      }
    })
    const revealedOutlet = dom.container.findByAttr("data-shell-page-outlet")
    expect(dom.container.textContent).toContain("PAGE_BETA")
    expect(revealedOutlet?.hasAttribute("data-shell-capturing")).toBe(false)
    expect(revealedOutlet?.getAttribute("data-shell-transition")).toBe("slide")
    expect(callbackResolved).toBe(true)

    // Rapid navigation Beta -> Gamma before Alpha->Beta finishes skips the active transition.
    await act(async () => {
      router.push({ pluginId: "demo.vt", pageId: "gamma" })
    })
    expect(skipSpies[0]).toHaveBeenCalledTimes(1)
    expect(docWithVt.startViewTransition).toHaveBeenCalledTimes(2)

    let gammaCallbackPromise: void | Promise<void> = undefined
    await act(async () => {
      gammaCallbackPromise = pendingCallbacks.shift()?.()
    })
    await gammaCallbackPromise
    expect(dom.container.textContent).toContain("PAGE_GAMMA")

    // Finishing the older skipped transition must NOT remove the newer transition's root attribute.
    await act(async () => {
      finishResolvers[0]?.()
      await Promise.resolve()
    })
    expect(dom.docElement.getAttribute("data-shell-view-transition")).toBe("page")

    // Finishing the active transition cleans up the root attribute.
    await act(async () => {
      finishResolvers[1]?.()
      await Promise.resolve()
    })
    expect(dom.docElement.getAttribute("data-shell-view-transition")).toBeNull()

    activeUnmount = undefined
    await dom.unmount()
    await host.dispose()
  })
})
