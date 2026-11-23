import { toast } from "sonner"
import {
  getSlice,
  hasSlice,
  requireSlice,
  type AuthSlice,
  type MfaService,
  type ProviderRuntimeSnapshot,
  type SchoolProvider,
  type StudentInfo,
} from "@orahako/academic-sdk"
import {
  createObservableSource,
  definePlugin,
  isCapacitor,
  PLUGIN_API_VERSION,
  type Context,
  type PluginConfig,
  type PluginPageContribution,
  type RouteLocation,
} from "@orahako/sdk"
import {
  AccountActions,
  QueryActivityIndicators,
  RefreshIndicator,
  SessionExpiredBanner,
  StaleIndicator,
  StudentProfileHeader,
} from "./components"
import { authUiDictionary } from "./dictionary"
import { LoginPage, type AuthSchoolChoice, type LoginPageInject } from "./login-page"
import "./slots"
import {
  createLoginRateLimiter,
  formatRateLimitMessage,
  formatRetryDuration,
  loginRateLimitStore,
  RATE_LIMIT_INTERVAL_MS,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
  rememberedCredentialsStore,
  type LoginRateLimitState,
  type RateLimitResult,
  type RememberedCredentialEntry,
  type RememberedCredentialsState,
  type ScopedLoginRateLimiter,
} from "./stores"

export const AUTH_UI_PLUGIN_ID = "orahako.auth-ui"
const DEFAULT_CAPACITOR_RETRY_DELAY_MS = 800

export interface AuthUiPluginConfig extends PluginConfig {
  readonly schools?: readonly AuthSchoolChoice[]
  readonly defaultLanding?: string
  readonly capacitorRetryDelayMs?: number
  readonly canRemember?: boolean
}

export {
  AccountActions,
  authUiDictionary,
  createLoginRateLimiter,
  formatRateLimitMessage,
  formatRetryDuration,
  LoginPage,
  loginRateLimitStore,
  QueryActivityIndicators,
  RATE_LIMIT_INTERVAL_MS,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_MS,
  RefreshIndicator,
  rememberedCredentialsStore,
  SessionExpiredBanner,
  StaleIndicator,
  StudentProfileHeader,
  type AuthSchoolChoice,
  type LoginRateLimitState,
  type RateLimitResult,
  type RememberedCredentialEntry,
  type RememberedCredentialsState,
  type ScopedLoginRateLimiter,
}

function isAuthExpiredError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  if ("code" in error && typeof error.code === "string") {
    if (error.code === "AUTH_REQUIRED" || error.code === "AUTH_SESSION_EXPIRED") {
      return true
    }
  }
  if ("status" in error && error.status === 401) {
    return true
  }
  return false
}

function invokeWarmup(provider: SchoolProvider | null, auth: AuthSlice): void {
  let authWarmupRef: unknown
  if ("warmup" in auth && typeof auth.warmup === "function") {
    authWarmupRef = auth.warmup
    void Promise.resolve(auth.warmup()).catch(() => {})
  }
  if (provider && typeof provider.warmup === "function" && provider.warmup !== authWarmupRef) {
    void provider.warmup().catch(() => {})
  }
}

function isLoginRoute(location: RouteLocation): boolean {
  if (location.route === "login") return true
  return location.pluginId === AUTH_UI_PLUGIN_ID && location.pageId === "login"
}

export const authUiPlugin = definePlugin({
  manifest: {
    id: AUTH_UI_PLUGIN_ID,
    name: "认证与账户界面",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "feature",
    providerIndependent: true,
    required: true,
    entry: "index.js",
    description: "学校登录页、会话过期横幅、后台鉴权校验、查询状态指示与账户控制",
    inject: [
      "ui",
      "slots",
      "router",
      "navigation",
      "i18n",
      "storage",
      "providers",
      "provider",
      "session",
      "query",
    ],
    configSchema: {
      type: "object",
      properties: {
        defaultLanding: { type: "string", minLength: 1 },
        capacitorRetryDelayMs: { type: "number", minimum: 0 },
        canRemember: { type: "boolean" },
        schools: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "name"],
            properties: {
              id: { type: "string", minLength: 1 },
              name: { type: "string", minLength: 1 },
              nameEn: { type: "string", minLength: 1 },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  inject: [
    "ui",
    "slots",
    "router",
    "navigation",
    "i18n",
    "storage",
    "providers",
    "provider",
    "session",
    "query",
  ] as const,
  apply(ctx, config: AuthUiPluginConfig = {}) {
    const { ui, slots, router, navigation, i18n, storage, providers, provider, session, query } =
      ctx
    i18n.register(authUiDictionary)
    const t = i18n.translator(authUiDictionary)
    const rateLimiter = createLoginRateLimiter(storage)
    const rememberStore = rememberedCredentialsStore.create(storage)
    const providersRevision = createObservableSource(0)
    const retryDelayMs = config.capacitorRetryDelayMs ?? DEFAULT_CAPACITOR_RETRY_DELAY_MS

    let disposed = false
    let checkedReadyGeneration = -1

    const detachProviders = providers.subscribe(() => {
      if (disposed) return
      providersRevision.set(providersRevision.getSnapshot() + 1)
      ensureProviderInitialized()
    })

    const listSchools = (): readonly AuthSchoolChoice[] => {
      const configured = config.schools ?? []
      const byId = new Map<string, AuthSchoolChoice>()
      for (const item of configured) {
        byId.set(item.id, item)
      }
      const activeProvider = provider.getSnapshot().provider
      for (const id of providers.listProviders()) {
        if (!byId.has(id)) {
          byId.set(id, {
            id,
            name: activeProvider?.id === id ? activeProvider.name : id,
          })
        }
      }
      return Array.from(byId.values())
    }

    const selectSchoolSafe = (schoolId: string): SchoolProvider | null => {
      if (!schoolId) return null
      if (!providers.hasProvider(schoolId)) {
        session.activateSchool(schoolId)
        return null
      }
      try {
        const selected = provider.selectSchool(schoolId)
        void provider.initialize().catch(() => {})
        return selected
      } catch {
        return null
      }
    }

    const resolveActivePage = (location: RouteLocation): PluginPageContribution | undefined => {
      const pages = ui.getSnapshot().pages
      if (location.pluginId) {
        const pageId = location.pageId ?? "index"
        return pages.find((p) => p.pluginId === location.pluginId && p.id === pageId)
      }
      if (location.route) {
        const direct = pages.find((p) => p.route === location.route)
        if (direct) return direct
        const target = navigation.resolve(location.route)
        if (target) {
          return pages.find((p) => p.pluginId === target.pluginId && p.id === target.pageId)
        }
        return undefined
      }
      const primary = navigation.primary()
      if (primary) {
        return pages.find((p) => p.pluginId === primary.pluginId && p.id === primary.pageId)
      }
      return undefined
    }

    const reconcileLoginGate = (): void => {
      if (disposed) return
      const sessionSnap = session.getSnapshot()
      if (!sessionSnap.hasHydrated || sessionSnap.isAuthenticated) return

      const currentLocation = router.current.getSnapshot()
      if (isLoginRoute(currentLocation)) return

      const activePage = resolveActivePage(currentLocation)
      const requiresProvider = activePage ? activePage.requiresProvider !== false : true
      if (requiresProvider) {
        router.replace({ route: "login" })
      }
    }

    const ensureProviderInitialized = (): void => {
      if (disposed) return
      const sessionSnap = session.getSnapshot()
      if (!sessionSnap.hasHydrated) return
      const providerSnap = provider.getSnapshot()
      if (providerSnap.status === "ready") return
      const targetSchool = sessionSnap.activeSchoolId ?? providerSnap.schoolId
      if (targetSchool && !providers.hasProvider(targetSchool)) return
      if (!targetSchool && providers.listProviders().length === 0) return
      void provider.initialize().catch(() => {})
    }

    const handleProviderReady = (snapshot: ProviderRuntimeSnapshot): void => {
      if (disposed || snapshot.status !== "ready" || !snapshot.provider) return
      if (!session.getSnapshot().isAuthenticated) return
      if (checkedReadyGeneration === snapshot.generation) return
      checkedReadyGeneration = snapshot.generation

      query.invalidate()

      const auth = getSlice(snapshot.provider, "auth")
      if (!auth) return
      const generation = snapshot.generation
      const targetProvider = snapshot.provider

      const isStillCurrent = (): boolean =>
        !disposed &&
        provider.getSnapshot().generation === generation &&
        provider.getSnapshot().provider === targetProvider &&
        session.getSnapshot().isAuthenticated

      void (async () => {
        let status = await auth.checkAuthStatus()
        if (!status.authenticated && isCapacitor()) {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, retryDelayMs)
          })
          if (!isStillCurrent()) return
          status = await auth.checkAuthStatus()
        }
        if (!isStillCurrent()) return

        if (status.authenticated) {
          session.setSessionExpired(false)
          invokeWarmup(targetProvider, auth)
        } else {
          session.setSessionExpired(true)
          toast.error(t("session.expired"))
        }
      })().catch((err: unknown) => {
        if (!isStillCurrent()) return
        if (isAuthExpiredError(err)) {
          session.setSessionExpired(true)
          toast.error(t("session.expired"))
        }
      })
    }

    const performRelogin = async (): Promise<void> => {
      const limit = rateLimiter.checkRateLimit()
      if (!limit.allowed) {
        toast.error(
          formatRateLimitMessage(
            limit,
            t,
            "session.reloginRateLimitWindow",
            "session.reloginRateLimitInterval"
          )
        )
        return
      }
      rateLimiter.recordLoginAttempt()

      try {
        const success = await provider.relogin()
        if (success) {
          toast.success(t("login.loginSuccess"))
          return
        }
      } catch {
        // Fall through to clean logout & redirect when quick relogin cannot recover session.
      }
      await provider.logout()
      router.replace({ route: "login" })
    }

    const performLogout = async (): Promise<void> => {
      await provider.logout()
      toast.success(t("session.logoutSuccess"))
      router.replace({ route: "login" })
    }

    const performSwitchSchool = (nextSchoolId?: string): void => {
      if (nextSchoolId) {
        selectSchoolSafe(nextSchoolId)
        if (!session.getSnapshot().isAuthenticated) {
          router.push({ route: "login" })
        }
        return
      }
      router.push({ route: "login" })
    }

    ctx.on("provider/ready", (snapshot) => {
      handleProviderReady(snapshot)
    })

    ctx.on("provider/changed", (snapshot) => {
      if (disposed || snapshot.status !== "error" || !snapshot.error) return
      if (!session.getSnapshot().isAuthenticated) return
      if (isAuthExpiredError(snapshot.error)) {
        session.setSessionExpired(true)
        toast.error(t("session.expired"))
      }
    })

    const unsubSession = session.state.subscribe(() => {
      if (disposed) return
      if (!session.getSnapshot().isAuthenticated) {
        checkedReadyGeneration = -1
      }
      ensureProviderInitialized()
      reconcileLoginGate()
      const currentProvider = provider.getSnapshot()
      if (currentProvider.status === "ready" && session.getSnapshot().isAuthenticated) {
        handleProviderReady(currentProvider)
      }
    })

    const unsubRouter = router.current.subscribe(() => {
      reconcileLoginGate()
    })

    const unsubUi = ui.state.subscribe(() => {
      reconcileLoginGate()
    })

    const studentProfileSource = query.source<StudentInfo, "studentProfile">({
      feature: "student-info",
      slice: "studentProfile",
      enabled: () =>
        !disposed &&
        session.getSnapshot().isAuthenticated &&
        hasSlice(provider.getSnapshot().provider, "studentProfile"),
      fetcher: (activeProvider) => requireSlice(activeProvider, "studentProfile").getStudentInfo(),
    })

    ui.registerPage(
      {
        id: "login",
        route: "login",
        title: "登录",
        titleKey: "pageTitle",
        requiresProvider: false,
        fullscreen: true,
        root: true,
        dictionary: authUiDictionary,
        store: rememberStore,
        inject: (fullCtx: Context): LoginPageInject => ({
          hooks: {
            session: session.state,
            provider: provider.state,
            providersRevision,
            rememberHydrated: rememberStore.hydrated,
          },
          canRemember: config.canRemember ?? isCapacitor(),
          listSchools,
          selectSchool: selectSchoolSafe,
          setCredential: (input) => {
            checkedReadyGeneration = -1
            session.setCredential(input)
            ensureProviderInitialized()
          },
          redirectAfterLogin: () => {
            const targetHref = navigation.landing(config.defaultLanding ?? "overview")
            router.replace(targetHref)
          },
          checkRateLimit: () => rateLimiter.checkRateLimit(),
          recordLoginAttempt: () => rateLimiter.recordLoginAttempt(),
          showMfa: (request) => {
            const mfaService: MfaService | undefined = fullCtx.get("mfa")
            return mfaService?.show(request)
          },
        }),
      },
      LoginPage
    )

    slots.inject("shell.banner", () =>
      slots.register(
        {
          id: "session-expired-banner",
          slot: "shell.banner",
          order: 10,
          dictionary: authUiDictionary,
          inject: () => ({
            hooks: {
              session: session.state,
            },
            relogin: performRelogin,
          }),
        },
        SessionExpiredBanner
      )
    )

    slots.inject("shell.activity", () =>
      slots.register(
        {
          id: "query-activity",
          slot: "shell.activity",
          order: 20,
          dictionary: authUiDictionary,
          inject: () => ({
            hooks: {
              activity: query.activity,
            },
          }),
        },
        QueryActivityIndicators
      )
    )

    slots.inject("profile.header", () =>
      slots.register(
        {
          id: "student-profile-header",
          slot: "profile.header",
          priority: 10,
          dictionary: authUiDictionary,
          inject: () => ({
            hooks: {
              session: session.state,
              provider: provider.state,
              navigationRevision: navigation.state,
              student: studentProfileSource,
            },
            canOpenStudentInfo: () => navigation.resolve("student-info") !== undefined,
            openStudentInfo: () => {
              router.push({ route: "student-info" })
            },
            openLogin: () => {
              router.push({ route: "login" })
            },
          }),
        },
        StudentProfileHeader
      )
    )

    slots.inject("profile.accountActions", () =>
      slots.register(
        {
          id: "profile-account-actions",
          slot: "profile.accountActions",
          order: 10,
          dictionary: authUiDictionary,
          inject: () => ({
            hooks: {
              session: session.state,
              providersRevision,
            },
            showLogoutConfirm: true,
            listSchools,
            relogin: performRelogin,
            switchSchool: performSwitchSchool,
            logout: performLogout,
            openLogin: () => {
              router.push({ route: "login" })
            },
          }),
        },
        AccountActions
      )
    )

    slots.inject("settings.account", () =>
      slots.register(
        {
          id: "settings-account-actions",
          slot: "settings.account",
          order: 10,
          dictionary: authUiDictionary,
          inject: () => ({
            hooks: {
              session: session.state,
              providersRevision,
            },
            showLogoutConfirm: true,
            listSchools,
            relogin: performRelogin,
            switchSchool: performSwitchSchool,
            logout: performLogout,
            openLogin: () => {
              router.push({ route: "login" })
            },
          }),
        },
        AccountActions
      )
    )

    ctx.effect(() => () => {
      disposed = true
      detachProviders()
      unsubSession()
      unsubRouter()
      unsubUi()
      rateLimiter.dispose()
      rememberStore.dispose()
    })

    // Initial reconciliation if session/provider are already ready at plugin mount time.
    ensureProviderInitialized()
    reconcileLoginGate()
    const currentSnapshot = provider.getSnapshot()
    if (currentSnapshot.status === "ready") {
      handleProviderReady(currentSnapshot)
    }
  },
})

export default authUiPlugin
