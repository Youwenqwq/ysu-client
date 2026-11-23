import { describe, expect, it, vi } from "vitest"
import { PluginRuntime } from "@orahako/kernel"
import { definePlugin, PLUGIN_API_VERSION } from "@orahako/sdk"
import { uiRegistryPlugin, UI_RUNTIME_PLUGIN_ID } from "@orahako/runtime-ui"
import {
  isPrimaryNavigationLocation,
  landingPreferenceHref,
  NAVIGATION_RUNTIME_PLUGIN_ID,
  navigationForScope,
  navigationRuntimePlugin,
  NavigationRuntimeService,
  PluginRouter,
  resolveActivePluginNavigation,
  resolveMobileNavigation,
  resolvePrimaryTarget,
  resolveSemanticTarget,
  ROUTER_RUNTIME_PLUGIN_ID,
  routerRuntimePlugin,
  semanticTargetHref,
  type BrowserWindowLike,
  type HardwareBackAdapter,
  type SemanticNavSources,
} from "../src"

function Icon() {
  return null
}

function Page() {
  return null
}

function createFakeBrowserWindow(initialHref = "/") {
  let currentPath = "/"
  let currentSearch = ""
  let currentState: unknown = undefined
  const listeners = new Set<(event: PopStateEvent) => void>()
  const stack: Array<{ href: string; state: unknown }> = [{ href: initialHref, state: undefined }]
  let idx = 0

  const syncFromHref = (href: string) => {
    const parsed = new URL(href, "https://local.invalid")
    currentPath = parsed.pathname
    currentSearch = parsed.search
  }
  syncFromHref(initialHref)

  const win: BrowserWindowLike = {
    location: {
      get pathname() {
        return currentPath
      },
      get search() {
        return currentSearch
      },
    },
    history: {
      get state() {
        return currentState
      },
      pushState(data, _unused, url) {
        const nextHref = String(url ?? "/")
        stack.splice(idx + 1)
        stack.push({ href: nextHref, state: data })
        idx = stack.length - 1
        currentState = data
        syncFromHref(nextHref)
      },
      replaceState(data, _unused, url) {
        const nextHref = String(url ?? "/")
        stack[idx] = { href: nextHref, state: data }
        currentState = data
        syncFromHref(nextHref)
      },
      back() {
        if (idx > 0) {
          idx -= 1
          const item = stack[idx]!
          currentState = item.state
          syncFromHref(item.href)
          for (const listener of listeners) {
            listener({ state: item.state } as PopStateEvent)
          }
        }
      },
    },
    addEventListener(_type, listener) {
      listeners.add(listener)
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener)
    },
  }

  return {
    window: win,
    listenerCount: () => listeners.size,
    triggerPopState: (href: string, state?: unknown) => {
      currentState = state
      syncFromHref(href)
      for (const listener of listeners) {
        listener({ state } as PopStateEvent)
      }
    },
  }
}

describe("PluginRouter & routerRuntimePlugin", () => {
  it("navigates in memory history (Node fallback) and parses RouteLocation", () => {
    const router = new PluginRouter({ window: null, initialHref: "/?route=overview" })
    const visited: string[] = []
    router.current.subscribe(() => {
      visited.push(router.current.getSnapshot().href)
    })

    expect(router.current.getSnapshot()).toMatchObject({
      pathname: "/",
      search: "?route=overview",
      route: "overview",
      params: {},
    })

    router.push({ pluginId: "orahako.schedule", pageId: "editor", params: { week: 3 } })
    expect(router.current.getSnapshot()).toMatchObject({
      href: "/?plugin=orahako.schedule&page=editor&week=3",
      pluginId: "orahako.schedule",
      pageId: "editor",
      params: { week: "3" },
    })

    router.replace("grades")
    expect(router.current.getSnapshot()).toMatchObject({
      href: "/?route=grades",
      route: "grades",
    })

    router.back()
    expect(router.current.getSnapshot().route).toBe("overview")

    // At root, back() without history is a safe no-op
    router.back()
    expect(router.current.getSnapshot().route).toBe("overview")
    expect(visited).toEqual([
      "/?plugin=orahako.schedule&page=editor&week=3",
      "/?route=grades",
      "/?route=overview",
    ])
    router.dispose()
  })

  it("drives Browser History API with basePath and syncs popstate events", () => {
    const browser = createFakeBrowserWindow("/app/?route=overview")
    const router = new PluginRouter({
      basePath: "/app/",
      window: browser.window,
    })

    expect(router.current.getSnapshot()).toMatchObject({
      pathname: "/app/",
      route: "overview",
    })
    expect(router.href("schedule")).toBe("/app/?route=schedule")
    // Already-prefixed href is not double-prefixed
    expect(router.href("/app/?route=grades")).toBe("/app/?route=grades")

    router.push("schedule")
    expect(browser.window.location.pathname).toBe("/app/")
    expect(browser.window.location.search).toBe("?route=schedule")

    browser.triggerPopState("/app/?plugin=orahako.exams&page=index", { orahakoIndex: 0 })
    expect(router.current.getSnapshot()).toMatchObject({
      pluginId: "orahako.exams",
      pageId: "index",
    })

    expect(browser.listenerCount()).toBe(1)
    router.dispose()
    expect(browser.listenerCount()).toBe(0)
  })

  it("evaluates LIFO back guards (sync & async) and revokes guards on plugin scope stop", async () => {
    const runtime = new PluginRuntime()
    runtime.register(routerRuntimePlugin, "builtin", { initialHref: "/?route=home" })
    runtime.start(ROUTER_RUNTIME_PLUGIN_ID)

    const router = runtime.context.get("router") as PluginRouter
    router.push("detail")
    expect(router.current.getSnapshot().route).toBe("detail")

    const order: string[] = []
    const disposeOuter = router.registerBackGuard(() => {
      order.push("outer")
      return true
    })

    const innerVeto = true
    const guardPlugin = definePlugin({
      manifest: {
        id: "example.modal-guard",
        name: "Modal Guard",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["router"],
      apply(ctx) {
        ctx.router.registerBackGuard(() => {
          order.push("inner")
          return !innerVeto
        })
      },
    })

    runtime.register(guardPlugin, "builtin")
    runtime.start(guardPlugin.manifest.id)

    // LIFO: inner runs first and vetoes (returns false), halting outer and history back
    router.back()
    expect(order).toEqual(["inner"])
    expect(router.current.getSnapshot().route).toBe("detail")

    // Stopping plugin revokes inner guard automatically
    runtime.stop(guardPlugin.manifest.id)

    // Add an async guard
    let allowAsync = false
    const disposeAsync = router.registerBackGuard(async () => {
      order.push("async")
      await Promise.resolve()
      return allowAsync
    })

    router.back()
    await vi.waitFor(() => expect(order).toEqual(["inner", "async"]))
    expect(router.current.getSnapshot().route).toBe("detail")

    allowAsync = true
    router.back()
    await vi.waitFor(() => expect(router.current.getSnapshot().route).toBe("home"))
    expect(order).toEqual(["inner", "async", "async", "outer"])

    disposeAsync()
    disposeOuter()
    runtime.dispose()
  })

  it("runs overlay guards before page guards regardless of registration order", () => {
    const router = new PluginRouter({ window: null, initialHref: "/?route=home" })
    router.push("detail")
    const order: string[] = []
    router.registerBackGuard(() => {
      order.push("page")
      return true
    })
    const removeOverlay = router.registerBackGuard(() => {
      order.push("overlay")
      return false
    }, 100)

    router.back()
    expect(order).toEqual(["overlay"])
    expect(router.current.getSnapshot().route).toBe("detail")

    removeOverlay()
    router.back()
    expect(order).toEqual(["overlay", "page"])
    expect(router.current.getSnapshot().route).toBe("home")
    router.dispose()
  })

  it("uses the page fallback before exiting when hardware history is exhausted", async () => {
    const exitSpy = vi.fn(async () => {})
    const router = new PluginRouter({
      window: null,
      initialHref: "/?route=student-info",
      hardwareBack: null,
    })
    const removeFallback = router.registerBackFallback(() => ({ route: "overview" }))

    await expect(router.dispatchHardwareBack(true, exitSpy)).resolves.toBe(true)
    expect(router.current.getSnapshot().route).toBe("overview")
    expect(exitSpy).not.toHaveBeenCalled()

    const removeShellFallback = router.registerBackFallback(() => ({ route: "settings" }))
    await router.dispatchHardwareBack(false, exitSpy)
    expect(router.current.getSnapshot().route).toBe("settings")
    removeShellFallback()
    await router.dispatchHardwareBack(false, exitSpy)
    expect(router.current.getSnapshot().route).toBe("overview")

    removeFallback()
    await expect(router.dispatchHardwareBack(true, exitSpy)).resolves.toBe(false)
    expect(exitSpy).toHaveBeenCalledOnce()
    router.dispose()
  })

  it("integrates hardware back button adapter and calls exitApp at root", async () => {
    let hardwareCallback: ((event: { canGoBack: boolean }) => void) | undefined
    const removeSpy = vi.fn(async () => {})
    const exitSpy = vi.fn(async () => {})

    const hardwareBack: HardwareBackAdapter = {
      async addListener(_name, cb) {
        hardwareCallback = cb
        return { remove: removeSpy }
      },
      exitApp: exitSpy,
    }

    const router = new PluginRouter({ window: null, initialHref: "/?route=home", hardwareBack })
    await vi.waitFor(() => expect(hardwareCallback).toBeTypeOf("function"))

    router.push("settings")
    let modalOpen = true
    const removeModalGuard = router.registerBackGuard(() => {
      if (modalOpen) {
        modalOpen = false
        return false
      }
      return true
    })

    // 1st hardware back closes modal without leaving settings
    hardwareCallback!({ canGoBack: false })
    await vi.waitFor(() => expect(modalOpen).toBe(false))
    expect(router.current.getSnapshot().route).toBe("settings")
    expect(exitSpy).not.toHaveBeenCalled()

    // 2nd hardware back pops history to home
    hardwareCallback!({ canGoBack: false })
    await vi.waitFor(() => expect(router.current.getSnapshot().route).toBe("home"))
    expect(exitSpy).not.toHaveBeenCalled()

    // 3rd hardware back at root calls exitApp
    removeModalGuard()
    hardwareCallback!({ canGoBack: false })
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledOnce())

    router.dispose()
    expect(removeSpy).toHaveBeenCalledOnce()
  })
})

describe("NavigationRuntimeService & pure semantic resolvers", () => {
  const sampleSources: SemanticNavSources = {
    pages: [
      { pluginId: "org.orahako.overview", id: "index" },
      {
        pluginId: "org.orahako.schedule",
        id: "index",
        route: "schedule",
        primary: true,
        capability: "timetable",
      },
      { pluginId: "org.orahako.grades", id: "index", route: "grades", capability: "grades" },
      {
        pluginId: "org.orahako.tools",
        id: "calc",
        route: "gpa-calc",
        capability: "grades",
        requiresProvider: false,
      },
    ],
    navigation: [
      {
        pluginId: "org.orahako.overview",
        id: "overview",
        page: "index",
        title: "总览",
        order: 0,
        primary: true,
      },
      {
        pluginId: "org.orahako.schedule",
        id: "schedule",
        page: "index",
        title: "日程",
        order: 10,
      },
      {
        pluginId: "org.orahako.grades",
        id: "grades",
        page: "index",
        title: "成绩",
        order: 20,
      },
    ],
    fallbackHref: "/?route=login",
  }

  it("resolves semantic routes, primary/root pages, landing hrefs, and scoped mobile tabs", () => {
    expect(resolveSemanticTarget("schedule", sampleSources)).toEqual({
      pluginId: "org.orahako.schedule",
      pageId: "index",
    })
    expect(resolveSemanticTarget("overview", sampleSources)).toEqual({
      pluginId: "org.orahako.overview",
      pageId: "index",
    })
    expect(resolvePrimaryTarget(sampleSources)).toEqual({
      pluginId: "org.orahako.overview",
      pageId: "index",
    })
    expect(semanticTargetHref({ pluginId: "org.orahako.schedule", pageId: "index" })).toBe(
      "/?plugin=org.orahako.schedule&page=index"
    )
    expect(landingPreferenceHref("schedule", sampleSources)).toBe(
      "/?plugin=org.orahako.schedule&page=index"
    )
    expect(
      landingPreferenceHref("missing", { pages: [], navigation: [], fallbackHref: "/?x=1" })
    ).toBe("/?x=1")

    // Scoped plugin navigation & parent inheritance with plain Record params AND URLSearchParams
    const pluginNav: SemanticNavSources["navigation"] = [
      {
        pluginId: "org.example.app",
        id: "map",
        page: "index",
        params: { tab: "map" },
        scope: "plugin",
        order: 0,
      },
      {
        pluginId: "org.example.app",
        id: "ride",
        page: "index",
        params: { tab: "ride" },
        scope: "plugin",
        order: 10,
      },
    ]
    const pluginPages: SemanticNavSources["pages"] = [
      { pluginId: "org.example.app", id: "index" },
      { pluginId: "org.example.app", id: "detail", parent: "index" },
      { pluginId: "org.example.app", id: "cycleA", parent: "cycleB" },
      { pluginId: "org.example.app", id: "cycleB", parent: "cycleA" },
    ]

    expect(resolveMobileNavigation(pluginNav, "org.example.app").items.map((x) => x.id)).toEqual([
      "map",
      "ride",
    ])
    expect(
      resolveActivePluginNavigation(pluginNav, pluginPages, {
        pluginId: "org.example.app",
        pageId: "detail",
        params: { tab: "ride" },
      })
    ).toBe("ride")
    expect(
      resolveActivePluginNavigation(pluginNav, pluginPages, {
        pluginId: "org.example.app",
        pageId: "index",
        params: new URLSearchParams({ tab: "map" }),
      })
    ).toBe("map")
    expect(
      resolveActivePluginNavigation(pluginNav, pluginPages, {
        pluginId: "org.example.app",
        pageId: "cycleA",
      })
    ).toBeUndefined()
    expect(
      isPrimaryNavigationLocation(pluginNav, {
        pluginId: "org.example.app",
        pageId: "index",
        params: { tab: "ride" },
      })
    ).toBe(true)
    expect(navigationForScope(sampleSources.navigation, "app").map((x) => x.id)).toEqual([
      "overview",
      "schedule",
      "grades",
    ])
  })

  it("reactively increments state and applies/revokes domain NavigationFilters via Cordis scopes", () => {
    const runtime = new PluginRuntime()
    runtime.register(uiRegistryPlugin, "builtin")
    runtime.register(navigationRuntimePlugin, "builtin", { fallbackHref: "/?route=login" })
    runtime.start(UI_RUNTIME_PLUGIN_ID)
    runtime.start(NAVIGATION_RUNTIME_PLUGIN_ID)

    const navigation = runtime.context.get("navigation") as NavigationRuntimeService
    const revisions: number[] = []
    navigation.state.subscribe(() => {
      revisions.push(navigation.state.getSnapshot())
    })

    const featurePlugin = definePlugin({
      manifest: {
        id: "org.orahako.schedule",
        name: "Schedule",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["ui"],
      apply(ctx) {
        ctx.ui.registerPage(
          { id: "index", route: "schedule", capability: "timetable", primary: true },
          Page
        )
        ctx.ui.registerNavigation({
          id: "schedule",
          page: "index",
          title: "Schedule",
          icon: Icon,
          group: "academic",
          primary: true,
        })
      },
    })

    const independentToolPlugin = definePlugin({
      manifest: {
        id: "org.orahako.calc",
        name: "GPA Calc",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["ui"],
      apply(ctx) {
        ctx.ui.registerPage(
          {
            id: "index",
            route: "calc",
            capability: "grades",
            requiresProvider: false,
          },
          Page
        )
      },
    })

    const policyPlugin = definePlugin({
      manifest: {
        id: "org.orahako.policy",
        name: "Policy",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "runtime",
        entry: "index.js",
      },
      inject: ["navigation"],
      apply(ctx) {
        ctx.navigation.registerFilter((entry) => {
          if (entry.requiresProvider === false) return true
          return entry.capability !== "timetable"
        })
      },
    })

    runtime.register(featurePlugin, "builtin")
    runtime.register(independentToolPlugin, "builtin")
    runtime.register(policyPlugin, "builtin")
    runtime.start(featurePlugin.manifest.id)
    runtime.start(independentToolPlugin.manifest.id)

    expect(navigation.resolve("schedule")).toEqual({
      pluginId: "org.orahako.schedule",
      pageId: "index",
      source: "page",
    })
    expect(navigation.landing("schedule")).toBe("/?plugin=org.orahako.schedule&page=index")

    // Start policy plugin: filters out timetable capability, keeps requiresProvider: false
    runtime.start(policyPlugin.manifest.id)
    expect(navigation.resolve("schedule")).toBeUndefined()
    expect(navigation.resolve("calc")).toEqual({
      pluginId: "org.orahako.calc",
      pageId: "index",
      source: "page",
    })
    expect(navigation.landing("schedule")).toBe("/?route=login")

    // Stop policy plugin: filter automatically revoked and schedule resolves again!
    runtime.stop(policyPlugin.manifest.id)
    expect(navigation.resolve("schedule")).toEqual({
      pluginId: "org.orahako.schedule",
      pageId: "index",
      source: "page",
    })
    expect(revisions.length).toBeGreaterThanOrEqual(4)
    runtime.dispose()
  })
})
