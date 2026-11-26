import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_TTL_MS,
  LONG_TTL_MS,
  notificationRegistryRuntimePlugin,
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
  queryRuntimePlugin,
  sessionRuntimePlugin,
} from "@orahako/academic-runtime"
import {
  defineSchoolProvider,
  ProviderError,
  ProviderErrorCode,
  type AuthStatus,
  type SchoolProvider,
} from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { StatelessHttpService } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import { navigationRuntimePlugin, routerRuntimePlugin } from "@orahako/runtime-router"
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
  type PluginRouterService,
} from "@orahako/sdk"
import { Card, CardContent, TooltipProvider } from "@orahako/ui-primitives"
import {
  AUTH_UI_PLUGIN_ID,
  authUiPlugin,
  createLoginRateLimiter,
  formatRateLimitMessage,
  formatRetryDuration,
  RATE_LIMIT_INTERVAL_MS,
  RATE_LIMIT_WINDOW_MS,
  rememberedCredentialsStore,
  REMEMBERED_PASSWORD_ARTIFACT,
  REMEMBERED_USERNAME_ARTIFACT,
} from "../src"
import type { AccountActionsInject } from "../src/components"
import type { LoginPageInject } from "../src/login-page"

const capacitorFlag = vi.hoisted(() => ({ native: false }))

vi.mock("@capacitor/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capacitor/core")>()
  return {
    ...actual,
    Capacitor: {
      ...actual.Capacitor,
      isNativePlatform: () => capacitorFlag.native,
    },
  }
})

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
  closest(): MiniDomNode | null {
    return null
  }
  blur(): void {}
  focus(): void {}

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
}

function mountMiniDom() {
  const prevWindow = globalThis.window
  const prevDocument = globalThis.document
  const prevHtmlElement = (globalThis as Record<string, unknown>).HTMLElement
  const prevAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT

  const fakeWin = {
    event: undefined,
    HTMLIFrameElement: class {},
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    location: { pathname: "/", search: "", reload: vi.fn() },
    matchMedia: () => ({
      matches: false,
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
  ;(globalThis as Record<string, unknown>).HTMLElement = MiniDomNode
  ;(globalThis as Record<string, unknown>).window = fakeWin
  ;(globalThis as Record<string, unknown>).document = docWithFactories

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
      ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = prevAct
      ;(globalThis as Record<string, unknown>).HTMLElement = prevHtmlElement
      ;(globalThis as Record<string, unknown>).window = prevWindow
      ;(globalThis as Record<string, unknown>).document = prevDocument
    },
  }
}

let activeUnmount: (() => Promise<void>) | undefined
afterEach(async () => {
  capacitorFlag.native = false
  vi.useRealTimers()
  if (activeUnmount) {
    const fn = activeUnmount
    activeUnmount = undefined
    await fn()
  }
})

function createMemoryStorage(): PluginKeyValueStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value)
    },
    removeItem: async (key) => {
      map.delete(key)
    },
  }
}

function setupAuthRuntime(options?: {
  initialHref?: string
  checkAuthStatus?: () => Promise<AuthStatus>
  warmup?: () => Promise<void>
  reloginResult?: boolean
  relogin?: () => Promise<boolean>
  canRemember?: boolean
}) {
  const localBackend = createMemoryStorage()
  const secureBackend = createMemoryStorage()
  const runtime = new PluginRuntime()
  runtime.context.set(
    "storage",
    new NamespacedStorageService({
      local: localBackend,
      secure: secureBackend,
    })
  )
  runtime.context.set("http", new StatelessHttpService())

  const checkAuthStatus = options?.checkAuthStatus ?? (async () => ({ authenticated: true }))
  const warmup = options?.warmup ?? vi.fn(async () => {})
  const logoutSpy = vi.fn(async () => {})
  const loginStep1Spy = vi.fn(async (input: { username: string; password: string }) => ({
    authenticated: input.password === "good-pass",
    needsMfa: input.password === "mfa-pass",
    username: input.username,
    credential: input.password === "good-pass" ? "issued-ticket" : undefined,
  }))

  const mockSchoolProvider: SchoolProvider = defineSchoolProvider({
    id: "demo",
    name: "示例大学",
    timeZone: "Asia/Shanghai",
    warmup,
    async initialize() {},
    async reset() {},
    async logout() {
      await logoutSpy()
      runtime.context.get("session")?.clearCredential("demo")
    },
    async dispose() {},
    async relogin() {
      if (options?.relogin) return options.relogin()
      return options?.reloginResult ?? true
    },
    slices: {
      auth: {
        async prepareLogin() {},
        async resetLoginSession() {},
        async login() {},
        loginStep1: loginStep1Spy,
        checkAuthStatus,
        isAuthenticated: () =>
          Boolean(runtime.context.get("session")?.getSnapshot().isAuthenticated),
        getCaptchaUrl: () => "data:image/png;base64,AAAA",
        checkCaptchaNeeded: async (u) => u === "need-captcha",
        requestMfaCode: async (input) => ({
          method: input.method,
          methodCode: "MC-INLINE-1",
          mobileHint: "138****0000",
          username: input.username,
        }),
        submitMfaCode: async () => "mfa-ticket",
      },
      studentProfile: {
        getStudentInfo: async () => ({
          name: "李青橙",
          studentId: "20260001",
          department: "信息科学与工程学院",
          major: "计算机科学与技术",
        }),
      },
    },
  })

  const otherLogoutSpy = vi.fn(async () => {})
  const otherSchoolProvider: SchoolProvider = defineSchoolProvider({
    id: "other",
    name: "第二大学",
    timeZone: "Asia/Shanghai",
    async initialize() {},
    async reset() {},
    async logout() {
      await otherLogoutSpy()
      runtime.context.get("session")?.clearCredential("other")
    },
    async dispose() {},
    async relogin() {
      return false
    },
    slices: {},
  })

  const schoolPlugin = definePlugin({
    manifest: {
      id: "demo.provider",
      name: "Demo Provider",
      version: "1.0.0",
      apiVersion: PLUGIN_API_VERSION,
      kind: "provider",
      entry: "index.js",
      inject: ["providers"],
    },
    inject: ["providers"] as const,
    apply(ctx) {
      ctx.providers.registerProvider("demo", () => mockSchoolProvider)
      ctx.providers.registerProvider("other", () => otherSchoolProvider)
    },
  })

  const pagesPlugin = definePlugin({
    manifest: {
      id: "demo.pages",
      name: "Demo Pages",
      version: "1.0.0",
      apiVersion: PLUGIN_API_VERSION,
      kind: "feature",
      providerIndependent: true,
      entry: "index.js",
      inject: ["ui"],
    },
    inject: ["ui"] as const,
    apply(ctx) {
      ctx.ui.registerPage(
        { id: "overview", route: "overview", requiresProvider: true, primary: true },
        () => <div>OverviewContent</div>
      )
      ctx.ui.registerPage({ id: "settings", route: "settings", requiresProvider: false }, () => (
        <div>SettingsContent</div>
      ))
      ctx.ui.registerPage(
        { id: "student-info", route: "student-info", requiresProvider: true },
        () => <div>StudentInfoPage</div>
      )
    },
  })

  const plugins = [
    slotRegistryPlugin,
    uiRegistryPlugin,
    i18nRegistryPlugin,
    routerRuntimePlugin,
    navigationRuntimePlugin,
    providerRegistryRuntimePlugin,
    sessionRuntimePlugin,
    providerRuntimePlugin,
    queryRuntimePlugin,
    notificationRegistryRuntimePlugin,
    schoolPlugin,
    pagesPlugin,
  ]

  for (const p of plugins) {
    if (p.manifest.id === routerRuntimePlugin.manifest.id) {
      runtime.register(p, "builtin", { initialHref: options?.initialHref ?? "/?route=overview" })
    } else if (p.manifest.id === queryRuntimePlugin.manifest.id) {
      runtime.register(p, "builtin", { policies: {} })
    } else if (
      p.manifest.id === sessionRuntimePlugin.manifest.id ||
      p.manifest.id === providerRuntimePlugin.manifest.id
    ) {
      runtime.register(p, "builtin", { defaultSchoolId: "demo" })
    } else {
      runtime.register(p, "builtin")
    }
    runtime.start(p.manifest.id)
  }

  runtime.register(authUiPlugin, "builtin", {
    capacitorRetryDelayMs: 5,
    canRemember: options?.canRemember ?? true,
  })
  runtime.start(AUTH_UI_PLUGIN_ID)
  expect(runtime.context.get("query")!.policy("student-info")).toEqual({
    ttl: LONG_TTL_MS,
    persist: true,
  })

  return {
    runtime,
    localBackend,
    secureBackend,
    warmup,
    logoutSpy,
    loginStep1Spy,
    mockSchoolProvider,
  }
}

describe("@orahako/plugin-ui-auth stores & rate limiter", () => {
  it("enforces 60s interval and 3-per-15m window limits in scoped local storage", async () => {
    const local = createMemoryStorage()
    const secure = createMemoryStorage()
    const limiter = createLoginRateLimiter({ local, secure })

    const base = 1_700_000_000_000
    expect(limiter.checkRateLimit(base)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      reason: null,
    })

    limiter.recordLoginAttempt(base)
    const intervalBlocked = limiter.checkRateLimit(base + 15_000)
    expect(intervalBlocked).toEqual({
      allowed: false,
      retryAfterMs: RATE_LIMIT_INTERVAL_MS - 15_000,
      reason: "interval",
    })
    expect(
      formatRateLimitMessage(
        intervalBlocked,
        (key, params) => `${key}:${JSON.stringify(params)}`,
        "win",
        "int"
      )
    ).toBe('int:{"seconds":45}')

    // Second and third attempts spaced > 1 min apart -> hits 3-per-15m window limit
    limiter.recordLoginAttempt(base + 70_000)
    limiter.recordLoginAttempt(base + 140_000)

    const windowBlocked = limiter.checkRateLimit(base + 200_000)
    expect(windowBlocked).toEqual({
      allowed: false,
      retryAfterMs: RATE_LIMIT_WINDOW_MS - 200_000,
      reason: "window",
    })
    expect(formatRetryDuration(windowBlocked.retryAfterMs)).toEqual({
      minutes: 11,
      seconds: 40,
    })

    // After 15 minutes from first attempt, window re-opens
    expect(limiter.checkRateLimit(base + RATE_LIMIT_WINDOW_MS + 1)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      reason: null,
    })

    await vi.waitFor(async () => {
      expect(await local.getItem("login-rate-limit")).not.toBeNull()
    })
    limiter.dispose()
  })

  it("persists remembered credentials per school in scoped secure storage", async () => {
    const local = createMemoryStorage()
    const secure = createMemoryStorage()
    const store = rememberedCredentialsStore.create({ local, secure })

    store.actions.save("demo", { username: "20260001", password: "secret" })
    expect(store.source.getSnapshot().bySchool.demo).toEqual({
      username: "20260001",
      password: "secret",
    })

    await vi.waitFor(async () => {
      const raw = await secure.getItem("remembered-credentials")
      expect(raw).toContain("20260001")
    })
    expect(await local.getItem("remembered-credentials")).toBeNull()

    store.actions.remove("demo")
    expect(store.source.getSnapshot().bySchool.demo).toBeUndefined()
    store.dispose()
  })
})

describe("@orahako/plugin-ui-auth startup observer, login gate & slot contributions", () => {
  it("redirects unauthenticated users away from provider-requiring pages to login, while allowing requiresProvider: false pages", async () => {
    const env1 = setupAuthRuntime({ initialHref: "/?route=overview" })
    const router1 = env1.runtime.context.get("router") as PluginRouterService

    await vi.waitFor(() => {
      expect(router1.current.getSnapshot().route).toBe("login")
    })
    const query1 = env1.runtime.context.get("query")!
    env1.runtime.stop(AUTH_UI_PLUGIN_ID)
    expect(query1.policy("student-info")).toEqual({ ttl: DEFAULT_TTL_MS, persist: false })
    env1.runtime.dispose()

    const env2 = setupAuthRuntime({ initialHref: "/?route=settings" })
    const router2 = env2.runtime.context.get("router") as PluginRouterService
    await vi.waitFor(() => {
      expect(env2.runtime.context.get("session")?.getSnapshot().hasHydrated).toBe(true)
    })
    expect(router2.current.getSnapshot().route).toBe("settings")
    env2.runtime.dispose()
  })

  it("writes quick-relogin artifacts after setCredential clears them", async () => {
    const env = setupAuthRuntime({ initialHref: "/?route=settings" })
    const session = env.runtime.context.get("session")!
    const ui = env.runtime.context.get("ui")!
    const slots = env.runtime.context.get("slots") as PluginSlotRegistry
    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))

    const loginPage = ui
      .getSnapshot()
      .pages.find((page) => page.pluginId === AUTH_UI_PLUGIN_ID && page.id === "login")!
    const login = loginPage.inject!(env.runtime.context) as LoginPageInject
    const rememberedPassword = "remembered-secret-1"
    const nextRememberedPassword = "remembered-secret-2"

    session.setArtifact(REMEMBERED_USERNAME_ARTIFACT, "stale-user", "demo")
    session.setArtifact(REMEMBERED_PASSWORD_ARTIFACT, "stale-secret", "demo")
    session.setArtifact("jwxtSession", "stale-session", "demo")

    login.setCredential(
      { schoolId: "demo", credential: "tgc-remembered", username: "20260001" },
      { username: "20260001", password: rememberedPassword }
    )
    let artifacts = session.getSnapshot().artifacts
    expect(artifacts[REMEMBERED_USERNAME_ARTIFACT]).toBe("20260001")
    expect(artifacts[REMEMBERED_PASSWORD_ARTIFACT]).toBe(rememberedPassword)
    expect(artifacts.jwxtSession).toBeUndefined()
    await vi.waitFor(() => {
      expect(
        [...env.secureBackend.map.values()].some((value) => value.includes(rememberedPassword))
      ).toBe(true)
    })

    login.setCredential(
      { schoolId: "demo", credential: "tgc-second-account", username: "20260002" },
      { username: "20260002", password: nextRememberedPassword }
    )
    artifacts = session.getSnapshot().artifacts
    expect(artifacts[REMEMBERED_USERNAME_ARTIFACT]).toBe("20260002")
    expect(artifacts[REMEMBERED_PASSWORD_ARTIFACT]).toBe(nextRememberedPassword)
    await vi.waitFor(() => {
      expect(
        [...env.secureBackend.map.values()].some((value) => value.includes(nextRememberedPassword))
      ).toBe(true)
      expect(
        [...env.secureBackend.map.values()].some((value) => value.includes(rememberedPassword))
      ).toBe(false)
    })

    login.setCredential(
      { schoolId: "demo", credential: "tgc-opted-out", username: "20260002" },
      null
    )
    artifacts = session.getSnapshot().artifacts
    expect(artifacts[REMEMBERED_USERNAME_ARTIFACT]).toBeUndefined()
    expect(artifacts[REMEMBERED_PASSWORD_ARTIFACT]).toBeUndefined()
    await vi.waitFor(() => {
      expect(
        [...env.secureBackend.map.values()].some((value) => value.includes(nextRememberedPassword))
      ).toBe(false)
    })

    login.setCredential(
      { schoolId: "demo", credential: "tgc-logout", username: "20260003" },
      { username: "20260003", password: nextRememberedPassword }
    )
    await vi.waitFor(() => {
      expect(
        [...env.secureBackend.map.values()].some((value) => value.includes(nextRememberedPassword))
      ).toBe(true)
    })

    slots.declare({ name: "settings.account", kind: "list" })
    const [accountEntry] = slots.select("settings.account")
    const account = accountEntry!.inject!(env.runtime.context) as AccountActionsInject
    await account.logout()

    artifacts = session.getSnapshot().artifacts
    expect(artifacts[REMEMBERED_USERNAME_ARTIFACT]).toBeUndefined()
    expect(artifacts[REMEMBERED_PASSWORD_ARTIFACT]).toBeUndefined()
    await vi.waitFor(() => {
      expect(
        [...env.secureBackend.map.values()].some((value) => value.includes(nextRememberedPassword))
      ).toBe(false)
    })
    env.runtime.dispose()
  })

  it.each([true, false])(
    "does not log out the replacement provider when quick relogin finishes after a hot switch (success=%s)",
    async (success) => {
      const started = Promise.withResolvers<void>()
      const gate = Promise.withResolvers<boolean>()
      const env = setupAuthRuntime({
        initialHref: "/?route=settings",
        relogin: () => {
          started.resolve()
          return gate.promise
        },
      })
      const slots = env.runtime.context.get("slots") as PluginSlotRegistry
      const session = env.runtime.context.get("session")!
      const providerRuntime = env.runtime.context.get("provider")!

      slots.declare({ name: "settings.account", kind: "list" })
      await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
      session.setCredential({
        schoolId: "demo",
        credential: "valid-tgc",
        username: "20260001",
      })
      const [entry] = slots.select("settings.account")
      const account = entry!.inject!(env.runtime.context) as AccountActionsInject

      const reloginPromise = account.relogin()
      await started.promise
      providerRuntime.selectSchool("other")
      await vi.waitFor(() => expect(providerRuntime.getSnapshot().provider?.id).toBe("other"))

      gate.resolve(success)
      await reloginPromise

      expect(env.logoutSpy).not.toHaveBeenCalled()
      expect(providerRuntime.getSnapshot().provider?.id).toBe("other")

      env.runtime.dispose()
    }
  )

  it("invalidates query and calls warmup when checkAuthStatus succeeds on provider/ready", async () => {
    const warmup = vi.fn(async () => {})
    const checkAuthStatus = vi.fn(async () => ({ authenticated: true }))
    const env = setupAuthRuntime({ checkAuthStatus, warmup })

    const session = env.runtime.context.get("session")!
    const onInvalidate = vi.fn()
    env.runtime.context.on("query/invalidate", onInvalidate)

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({
      schoolId: "demo",
      credential: "valid-tgc",
      username: "20260001",
    })

    await vi.waitFor(() => {
      expect(checkAuthStatus).toHaveBeenCalledTimes(1)
      expect(warmup).toHaveBeenCalledTimes(1)
    })
    expect(onInvalidate).toHaveBeenCalled()
    expect(session.getSnapshot().isAuthenticated).toBe(true)
    expect(session.getSnapshot().sessionExpired).toBe(false)
    env.runtime.dispose()
  })

  it("retries checkAuthStatus on Capacitor and marks sessionExpired WITHOUT logging out or redirecting when expired", async () => {
    capacitorFlag.native = true
    const checkAuthStatus = vi.fn(async () => ({ authenticated: false }))
    const env = setupAuthRuntime({ initialHref: "/?route=settings", checkAuthStatus })

    const session = env.runtime.context.get("session")!
    const router = env.runtime.context.get("router") as PluginRouterService
    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))

    session.setCredential({
      schoolId: "demo",
      credential: "stale-tgc",
      username: "20260001",
    })
    router.replace({ route: "overview" })

    await vi.waitFor(() => {
      expect(checkAuthStatus).toHaveBeenCalledTimes(2)
      expect(session.getSnapshot().sessionExpired).toBe(true)
    })

    // CRITICAL: isAuthenticated stays true, logout is NOT called, route stays on overview!
    expect(session.getSnapshot().isAuthenticated).toBe(true)
    expect(env.logoutSpy).not.toHaveBeenCalled()
    expect(router.current.getSnapshot().route).toBe("overview")

    env.runtime.dispose()
  })

  it("marks sessionExpired on AUTH_SESSION_EXPIRED error from checkAuthStatus while ignoring transient network errors", async () => {
    const envExpired = setupAuthRuntime({
      initialHref: "/?route=settings",
      checkAuthStatus: async () => {
        throw new ProviderError(
          ProviderErrorCode.AUTH_SESSION_EXPIRED,
          "CAS expired",
          undefined,
          401
        )
      },
    })
    const session1 = envExpired.runtime.context.get("session")!
    await vi.waitFor(() => expect(session1.getSnapshot().hasHydrated).toBe(true))
    session1.setCredential({ schoolId: "demo", credential: "tgc-1", username: "20260001" })

    await vi.waitFor(() => {
      expect(session1.getSnapshot().sessionExpired).toBe(true)
    })
    expect(session1.getSnapshot().isAuthenticated).toBe(true)
    expect(envExpired.logoutSpy).not.toHaveBeenCalled()
    envExpired.runtime.dispose()

    const checkNetworkErr = vi.fn(async (): Promise<AuthStatus> => {
      throw new ProviderError(ProviderErrorCode.NETWORK_ERROR, "offline")
    })
    const envOffline = setupAuthRuntime({
      initialHref: "/?route=settings",
      checkAuthStatus: checkNetworkErr,
    })
    const session2 = envOffline.runtime.context.get("session")!
    await vi.waitFor(() => expect(session2.getSnapshot().hasHydrated).toBe(true))
    session2.setCredential({ schoolId: "demo", credential: "tgc-2", username: "20260001" })

    await vi.waitFor(() => {
      expect(checkNetworkErr).toHaveBeenCalledTimes(1)
    })
    expect(session2.getSnapshot().isAuthenticated).toBe(true)
    expect(session2.getSnapshot().sessionExpired).toBe(false)
    envOffline.runtime.dispose()
  })

  it("marks sessionExpired for a structurally identical ProviderError copy from a ZIP bundle", async () => {
    class BundledProviderError extends Error {
      readonly code: string
      readonly status?: number

      constructor(code: string, message: string, status?: number) {
        super(message)
        this.name = "ProviderError"
        this.code = code
        this.status = status
      }
    }

    const foreignError = new BundledProviderError("AUTH_SESSION_EXPIRED", "bundled CAS expired")
    expect(foreignError).not.toBeInstanceOf(ProviderError)

    const env = setupAuthRuntime({
      initialHref: "/?route=settings",
      checkAuthStatus: async () => {
        throw foreignError
      },
    })
    const session = env.runtime.context.get("session")!
    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))
    session.setCredential({ schoolId: "demo", credential: "tgc-foreign", username: "20260001" })

    await vi.waitFor(() => {
      expect(session.getSnapshot().sessionExpired).toBe(true)
    })
    expect(session.getSnapshot().isAuthenticated).toBe(true)
    expect(env.logoutSpy).not.toHaveBeenCalled()
    env.runtime.dispose()
  })

  it.for(["profile.accountActions", "settings.account"] as const)(
    "renders %s as direct rows in the host card for guests and authenticated users",
    async (slot, { onTestFinished }) => {
      const dom = mountMiniDom()
      const { runtime } = setupAuthRuntime({ initialHref: "/?route=settings" })
      onTestFinished(() => runtime.dispose())
      onTestFinished(dom.unmount)
      const slots = runtime.context.get("slots") as PluginSlotRegistry
      const i18n = runtime.context.get("i18n") as PluginI18nRegistryService
      const session = runtime.context.get("session")!
      slots.declare({ name: slot, kind: "list" })
      await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))

      const [entry] = slots.select(slot)
      expect(entry).toBeDefined()
      await dom.render(
        <Card className="py-0">
          <CardContent className="flex flex-col divide-y divide-border py-1">
            <ContributionOutlet entry={entry!} slots={slots} i18n={i18n} />
          </CardContent>
        </Card>
      )

      function expectAccountRows(labels: string[]) {
        const card = dom.container.firstChild!
        const content = card.firstChild!
        expect(card.attributes.get("data-slot")).toBe("card")
        expect(content.attributes.get("data-slot")).toBe("card-content")
        const rows = content.childNodes.filter((node) => node.nodeType === 1)
        expect(rows.map((row) => [row.tagName, row.textContent])).toEqual(
          labels.map((label) => ["BUTTON", label])
        )
      }

      expectAccountRows(["去登录"])

      await act(async () => {
        session.setCredential({ schoolId: "demo", credential: "valid-tgc", username: "20260001" })
      })

      expectAccountRows(["重新登录", "退出登录"])
    }
  )

  it("renders shell.banner, shell.activity, profile.header, and login page as pure derived-props components", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const env = setupAuthRuntime({ initialHref: "/?route=settings" })
    const slots = env.runtime.context.get("slots") as PluginSlotRegistry
    const ui = env.runtime.context.get("ui")!
    const i18n = env.runtime.context.get("i18n") as PluginI18nRegistryService
    const session = env.runtime.context.get("session")!

    slots.declare({ name: "shell.banner", kind: "list" })
    slots.declare({ name: "shell.activity", kind: "list" })
    slots.declare({ name: "profile.header", kind: "single" })

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))

    // Login page renders cleanly
    const loginPage = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === AUTH_UI_PLUGIN_ID && p.id === "login")!
    expect(loginPage.requiresProvider).toBe(false)
    const loginHtml = renderToStaticMarkup(
      <ContributionOutlet entry={loginPage} slots={slots} i18n={i18n} />
    )
    expect(loginHtml).toContain("酸橙盒")
    expect(loginHtml).not.toContain("切换学校")
    expect(loginHtml).toContain("记住密码")
    expect(loginHtml).toContain("orahako-login-password")
    expect(loginHtml).toContain(`type="${"pass"}word"`)
    expect(loginHtml).toContain(`autoComplete="current-${"pass"}word"`)

    // Authenticate and mark sessionExpired -> banner & student profile render reactively
    session.setCredential({
      schoolId: "demo",
      credential: "valid-tgc",
      username: "20260001",
    })
    await vi.waitFor(() => {
      expect(env.runtime.context.get("provider")?.getSnapshot().status).toBe("ready")
    })
    session.setSessionExpired(true)

    const bannerEntry = slots.select("shell.banner")[0]!
    const headerEntry = slots.select("profile.header")[0]!

    await dom.render(
      <TooltipProvider>
        <div>
          <ContributionOutlet entry={bannerEntry} slots={slots} i18n={i18n} />
          <ContributionOutlet entry={headerEntry} slots={slots} i18n={i18n} />
        </div>
      </TooltipProvider>
    )

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("登录已过期，请重新登录")
      expect(dom.container.textContent).toContain("李青橙")
      expect(dom.container.textContent).toContain("20260001")
    })
    activeUnmount = undefined
    await dom.unmount()
    env.runtime.dispose()
  })

  it("transitions LoginPage inline into step 2 MFA verification and completes login without a modal", async () => {
    const dom = mountMiniDom()
    activeUnmount = dom.unmount

    const env = setupAuthRuntime({ initialHref: "/?route=login" })
    const slots = env.runtime.context.get("slots") as PluginSlotRegistry
    const ui = env.runtime.context.get("ui")!
    const i18n = env.runtime.context.get("i18n") as PluginI18nRegistryService
    const session = env.runtime.context.get("session")!
    const router = env.runtime.context.get("router") as PluginRouterService

    await vi.waitFor(() => expect(session.getSnapshot().hasHydrated).toBe(true))

    const loginPage = ui
      .getSnapshot()
      .pages.find((p) => p.pluginId === AUTH_UI_PLUGIN_ID && p.id === "login")!
    await dom.render(<ContributionOutlet entry={loginPage} slots={slots} i18n={i18n} />)

    const findNodes = (
      root: MiniDomNode,
      predicate: (node: MiniDomNode) => boolean
    ): MiniDomNode[] => {
      const results: MiniDomNode[] = []
      const visit = (node: MiniDomNode) => {
        if (predicate(node)) results.push(node)
        for (const child of node.childNodes) visit(child)
      }
      visit(root)
      return results
    }
    const getReactProps = (node: MiniDomNode): Record<string, unknown> => {
      for (const key of Object.keys(node)) {
        if (key.startsWith("__reactProps$")) {
          const val: unknown = Reflect.get(node, key)
          if (typeof val === "object" && val !== null) return val as Record<string, unknown>
        }
      }
      return {}
    }

    const usernameInput = findNodes(
      dom.container,
      (n) => getReactProps(n).id === "orahako-login-username"
    )[0]!
    const passwordInput = findNodes(
      dom.container,
      (n) => getReactProps(n).id === "orahako-login-password"
    )[0]!
    const credentialsForm = findNodes(dom.container, (n) => n.tagName === "FORM")[0]!

    await act(async () => {
      const onUserChange = getReactProps(usernameInput).onChange as
        | ((e: { target: { value: string } }) => void)
        | undefined
      const onPassChange = getReactProps(passwordInput).onChange as
        | ((e: { target: { value: string } }) => void)
        | undefined
      onUserChange?.({ target: { value: "20260001" } })
      onPassChange?.({ target: { value: "mfa-pass" } })
    })

    await act(async () => {
      const onSubmit = getReactProps(credentialsForm).onSubmit as
        | ((e: { preventDefault(): void }) => void)
        | undefined
      onSubmit?.({ preventDefault() {} })
    })

    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("二次验证")
    })

    // Back button returns to step 1 while preserving credentials
    const backBtn = findNodes(
      dom.container,
      (n) => n.tagName === "BUTTON" && n.textContent.includes("返回修改账号")
    )[0]!
    await act(async () => {
      const onClick = getReactProps(backBtn).onClick as (() => void) | undefined
      onClick?.()
    })
    expect(dom.container.textContent).toContain("登录账号")

    // Re-enter MFA step via form submit (advance clock past 60s rate-limit interval)
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 65_000)
    const formAgain = findNodes(dom.container, (n) => n.tagName === "FORM")[0]!
    await act(async () => {
      const onSubmit = getReactProps(formAgain).onSubmit as
        | ((e: { preventDefault(): void }) => void)
        | undefined
      onSubmit?.({ preventDefault() {} })
    })
    nowSpy.mockRestore()
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("二次验证")
    })

    // Request MFA code inline
    const requestBtn = findNodes(
      dom.container,
      (n) => n.tagName === "BUTTON" && n.textContent.includes("获取验证码")
    )[0]!
    await act(async () => {
      const onClick = getReactProps(requestBtn).onClick as (() => void) | undefined
      onClick?.()
    })
    await vi.waitFor(() => {
      expect(dom.container.textContent).toContain("138****0000")
    })

    // Enter verification code and submit
    const codeInput = findNodes(
      dom.container,
      (n) => getReactProps(n).id === "orahako-login-mfa-code"
    )[0]!
    const mfaForm = findNodes(dom.container, (n) => n.tagName === "FORM")[0]!

    await act(async () => {
      const onChange = getReactProps(codeInput).onChange as
        | ((e: { target: { value: string } }) => void)
        | undefined
      onChange?.({ target: { value: "654321" } })
    })

    await act(async () => {
      const onSubmit = getReactProps(mfaForm).onSubmit as
        | ((e: { preventDefault(): void }) => void)
        | undefined
      onSubmit?.({ preventDefault() {} })
    })

    await vi.waitFor(() => {
      expect(session.getSnapshot().isAuthenticated).toBe(true)
      expect(session.getSnapshot().credential).toBe("mfa-ticket")
      expect(dom.container.textContent).toContain("登录成功")
    })

    await vi.waitFor(
      () => {
        expect(router.current.getSnapshot().pageId).toBe("overview")
      },
      { timeout: 2500 }
    )

    activeUnmount = undefined
    await dom.unmount()
    env.runtime.dispose()
  })
})
