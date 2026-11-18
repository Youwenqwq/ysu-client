import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import {
  defineSchoolProvider,
  type MfaService,
  type QueryService,
  type QuerySnapshot,
  type SessionService,
  type SessionSnapshot,
} from "@orahako/academic-sdk"
import { providerRegistryRuntimePlugin, providerRuntimePlugin } from "@orahako/academic-runtime"
import { PluginRuntime } from "@orahako/kernel"
import { PluginI18nRegistry } from "@orahako/runtime-i18n"
import { settingsRegistryPlugin } from "@orahako/runtime-settings"
import { ContributionOutlet, PluginSlotRegistry } from "@orahako/runtime-slots"
import { NamespacedStorageService } from "@orahako/runtime-storage"
import {
  createObservableSource,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  trackPluginRegistration,
  type HttpRequest,
  type HttpResponse,
  type NetworkActivityCategory,
  type NetworkActivitySnapshot,
  type ObservableSource,
  type PluginHttpActivityService,
  type PluginHttpService,
  type PluginKeyValueStorage,
  type PluginNativeService,
  type ScopedPluginService,
} from "@orahako/sdk"
import pkgJson from "../package.json"
import {
  definition,
  isValidHttpBaseUrl,
  manifest,
  normalizeEndpointBaseUrl,
  resolveYsuEndpointUrls,
  YSU_CONFIG,
  YSU_ENDPOINTS_CATEGORY_ID,
  YSU_PROVIDER_PLUGIN_ID,
  ysuEndpointStore,
  ysuProviderPlugin,
} from "../src"
import { TestCookieJar, textResponse } from "./test-helper"

function createMapBackend(backing = new Map<string, string>()): {
  readonly map: Map<string, string>
  readonly backend: PluginKeyValueStorage
} {
  return {
    map: backing,
    backend: {
      getItem: async (key) => backing.get(key) ?? null,
      setItem: async (key, value) => {
        backing.set(key, value)
      },
      removeItem: async (key) => {
        backing.delete(key)
      },
    },
  }
}

function createTestRuntimeEnvironment(options?: {
  readonly initialSchoolId?: string | null
  readonly fetchUrls?: string[]
  readonly localMap?: Map<string, string>
}) {
  const fetchUrls = options?.fetchUrls ?? []
  const local = createMapBackend(options?.localMap)
  const secure = createMapBackend()

  const labelers = new Set<(url: string) => string | undefined>()
  const classifiers = new Set<(url: string) => NetworkActivityCategory | undefined>()
  const activitySnapshot: NetworkActivitySnapshot = {
    active: [],
    history: [],
    session: null,
    revision: 0,
  }
  const activitySource = createObservableSource(activitySnapshot)

  const scopedHttp: ScopedPluginService<PluginHttpService> & PluginHttpService = {
    send: async (req: HttpRequest): Promise<HttpResponse> => {
      fetchUrls.push(req.url)
      return textResponse(req.url, "", 200)
    },
    activity: {
      state: activitySource,
      getSnapshot: activitySource.getSnapshot,
      subscribe: activitySource.subscribe,
      registerLabeler: (fn: (url: string) => string | undefined) => {
        labelers.add(fn)
        return () => labelers.delete(fn)
      },
      registerClassifier: (fn: (url: string) => NetworkActivityCategory | undefined) => {
        classifiers.add(fn)
        return () => classifiers.delete(fn)
      },
      beginRequest: () => () => {},
    },
    [PLUGIN_SERVICE_SCOPE](ctx) {
      const scopedActivity: PluginHttpActivityService = {
        state: activitySource,
        getSnapshot: activitySource.getSnapshot,
        subscribe: activitySource.subscribe,
        registerLabeler: (fn: (url: string) => string | undefined) =>
          trackPluginRegistration(ctx, () => {
            labelers.add(fn)
            return () => labelers.delete(fn)
          }),
        registerClassifier: (fn: (url: string) => NetworkActivityCategory | undefined) =>
          trackPluginRegistration(ctx, () => {
            classifiers.add(fn)
            return () => classifiers.delete(fn)
          }),
        beginRequest: () => () => {},
      }
      return {
        send: scopedHttp.send,
        activity: scopedActivity,
      }
    },
  }

  const sessionState = createObservableSource<SessionSnapshot>({
    activeSchoolId: options?.initialSchoolId ?? "ysu",
    credential: null,
    username: null,
    isAuthenticated: false,
    sessionExpired: false,
    hasHydrated: true,
    artifacts: {},
  })

  const session: SessionService = {
    state: sessionState,
    getSnapshot: sessionState.getSnapshot,
    subscribe: sessionState.subscribe,
    setCredential: (input) => {
      sessionState.set((prev) => ({
        ...prev,
        activeSchoolId: input.schoolId,
        credential: input.credential,
        username: input.username ?? null,
        isAuthenticated: true,
        sessionExpired: false,
      }))
    },
    activateSchool: (schoolId) => {
      sessionState.set((prev) => ({ ...prev, activeSchoolId: schoolId }))
    },
    clearCredential: () => {
      sessionState.set((prev) => ({
        ...prev,
        credential: null,
        username: null,
        isAuthenticated: false,
        sessionExpired: false,
        artifacts: {},
      }))
    },
    setSessionExpired: (expired) => {
      sessionState.set((prev) => ({ ...prev, sessionExpired: expired }))
    },
    setArtifact: (key, value) => {
      sessionState.set((prev) => {
        const nextArtifacts = { ...prev.artifacts }
        if (value === null) delete nextArtifacts[key]
        else nextArtifacts[key] = value
        return { ...prev, artifacts: nextArtifacts }
      })
    },
    getArtifact: (key) => sessionState.getSnapshot().artifacts[key] ?? null,
    createCookieJar: () => new TestCookieJar(),
    fetchWithJar: async (_jar, req) => {
      fetchUrls.push(req.url)
      if (req.url.includes("/authserver/index.do") || req.url.includes("/authserver/login")) {
        return textResponse(req.url, "", 302, {
          location: "https://cer.example.edu.cn/personalInfo/index.html",
        })
      }
      if (req.url.includes("xsjbxx.do") || req.url.includes("cxxsjbxx.do")) {
        return textResponse(
          req.url,
          JSON.stringify({
            code: "0",
            datas: { cxxsjbxx: { rows: [{ XM: "测试学生", XH: "20239999" }] } },
          }),
          200,
          { "content-type": "application/json" }
        )
      }
      return textResponse(req.url, "", 200)
    },
  }

  const queryActivity = createObservableSource({ refreshingCount: 0, staleCount: 0 })
  const query: QueryService = {
    source<T>(): ObservableSource<QuerySnapshot<T>> {
      return createObservableSource<QuerySnapshot<T>>({
        status: "idle",
        data: undefined,
        error: null,
        isLoading: false,
        isRefreshing: false,
        isStale: false,
        updatedAt: null,
        refresh: async () => undefined,
      })
    },
    activity: queryActivity,
    policy: () => ({ ttl: 0, persist: false }),
    registerPolicy: () => () => {},
    invalidate: () => {},
    key: () => [],
    cacheKey: () => "",
    readPersistent: () => null,
    writePersistent: () => {},
    clearPersistent: () => {},
  }

  const native: PluginNativeService = {
    isNative: false,
    capabilities: {
      list: () => [],
      has: () => false,
      acquire: async () => async () => {},
      invoke: async () => {
        throw new Error("unavailable")
      },
    },
    saveImage: async () => ({ uri: "" }),
    requestNotificationPermission: async () => false,
    requestExactAlarmPermission: async () => false,
    requestBatteryOptimizationExemption: async () => false,
  }

  const mfa: MfaService = {
    show: async () => {
      throw new Error("unused")
    },
  }

  const i18nRegistry = new PluginI18nRegistry()
  const slotRegistry = new PluginSlotRegistry()

  const kernel = new PluginRuntime()
  kernel.context.set(
    "storage",
    new NamespacedStorageService({ local: local.backend, secure: secure.backend })
  )
  kernel.context.set("i18n", i18nRegistry)
  kernel.context.set("slots", slotRegistry)
  kernel.context.set("http", scopedHttp)
  kernel.context.set("session", session)
  kernel.context.set("query", query)
  kernel.context.set("native", native)
  kernel.context.set("mfa", mfa)

  kernel.register(settingsRegistryPlugin, "builtin")
  kernel.register(providerRegistryRuntimePlugin, "builtin")
  kernel.register(providerRuntimePlugin, "builtin", { defaultSchoolId: "ysu" })
  kernel.register(ysuProviderPlugin, "builtin")

  return {
    kernel,
    i18nRegistry,
    slotRegistry,
    local,
    secure,
    fetchUrls,
    labelUrl(url: string): string | undefined {
      for (const fn of labelers) {
        const res = fn(url)
        if (res !== undefined) return res
      }
      return undefined
    },
    classifyUrl(url: string): NetworkActivityCategory | undefined {
      for (const fn of classifiers) {
        const res = fn(url)
        if (res !== undefined) return res
      }
      return undefined
    },
    labelers,
    classifiers,
  }
}

async function startAllBuiltins(kernel: PluginRuntime): Promise<void> {
  for (const id of [
    settingsRegistryPlugin.manifest.id,
    providerRegistryRuntimePlugin.manifest.id,
    providerRuntimePlugin.manifest.id,
    YSU_PROVIDER_PLUGIN_ID,
  ]) {
    await kernel.startAndWait(id)
  }
}

describe("ysu.provider manifest, plugin lifecycle, endpoint store & settings category", () => {
  it("exports API v3 manifest and registers/cleans up provider, i18n, activity hooks, and settings category", async () => {
    expect(definition).toBe(ysuProviderPlugin)
    expect(manifest).toEqual({
      id: "ysu.provider",
      name: "燕山大学教务",
      version: "1.0.0",
      apiVersion: PLUGIN_API_VERSION,
      kind: "provider",
      required: true,
      entry: "index.js",
      description: "燕山大学 CAS / 教务 / 移动端 / 缴费平台 Provider",
      inject: [
        "i18n",
        "settings",
        "storage",
        "providers",
        "http",
        "session",
        "query",
        "native",
        "mfa",
      ],
    })
    expect(manifest.apiVersion).toBe(3)

    const env = createTestRuntimeEnvironment()
    await startAllBuiltins(env.kernel)

    const providers = env.kernel.context.get("providers")!
    const providerRuntime = env.kernel.context.get("provider")!
    const settings = env.kernel.context.get("settings")!

    expect(providers.hasProvider("ysu")).toBe(true)
    providerRuntime.selectSchool("ysu")
    expect(providerRuntime.getSnapshot().schoolId).toBe("ysu")
    expect(providerRuntime.getSnapshot().provider?.id).toBe("ysu")

    const categories = settings.getSnapshot()
    const ysuCategory = categories.find((c) => c.id === YSU_ENDPOINTS_CATEGORY_ID)
    expect(ysuCategory).toMatchObject({
      id: YSU_ENDPOINTS_CATEGORY_ID,
      pluginId: YSU_PROVIDER_PLUGIN_ID,
      titleKey: "categoryTitle",
      descriptionKey: "categoryDescription",
    })

    expect(
      env.i18nRegistry.translate(YSU_PROVIDER_PLUGIN_ID, "networkActivity.ysu.grades", "zh")
    ).toBe("成绩查询")
    expect(
      env.i18nRegistry.translate(YSU_PROVIDER_PLUGIN_ID, "networkActivity.ysu.grades", "en")
    ).toBe("Grades")

    expect(env.labelUrl("https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do")).toBe(
      "networkActivity.ysu.grades"
    )
    expect(env.classifyUrl("https://cer.ysu.edu.cn/authserver/login")).toBe("auth")

    // Stopping ysu.provider revokes provider, settings category, translations, and activity hooks
    await env.kernel.stop(YSU_PROVIDER_PLUGIN_ID)
    expect(providers.hasProvider("ysu")).toBe(false)
    expect(
      env.i18nRegistry.translate(YSU_PROVIDER_PLUGIN_ID, "networkActivity.ysu.grades", "zh")
    ).toBe("networkActivity.ysu.grades")
    expect(providerRuntime.getSnapshot().status).toBe("unavailable")
    expect(settings.getSnapshot().map((c) => c.id)).not.toContain(YSU_ENDPOINTS_CATEGORY_ID)
    expect(env.labelers.size).toBe(0)
    expect(env.classifiers.size).toBe(0)

    env.kernel.dispose()
  })

  it("normalizes and persists custom CAS/JWXT endpoints and applies overrides across protocol, diagnostics, and nativePolling", async () => {
    expect(
      normalizeEndpointBaseUrl("  https://cas.mirror.edu.cn/// ", YSU_CONFIG.cas.cerBaseUrl)
    ).toBe("https://cas.mirror.edu.cn")
    expect(normalizeEndpointBaseUrl("   ", YSU_CONFIG.cas.cerBaseUrl)).toBe(
      YSU_CONFIG.cas.cerBaseUrl
    )
    expect(isValidHttpBaseUrl("")).toBe(true)
    expect(isValidHttpBaseUrl("https://cas.mirror.edu.cn")).toBe(true)
    expect(isValidHttpBaseUrl("ftp://cas.mirror.edu.cn")).toBe(false)
    expect(isValidHttpBaseUrl("not a url")).toBe(false)

    expect(
      resolveYsuEndpointUrls({
        customCerBaseUrl: " https://cas.mirror.edu.cn/ ",
        customJwxtBaseUrl: "",
      })
    ).toEqual({
      cerBaseUrl: "https://cas.mirror.edu.cn",
      jwxtBaseUrl: YSU_CONFIG.jwxt.jwxtBaseUrl,
    })

    const env = createTestRuntimeEnvironment()
    await startAllBuiltins(env.kernel)

    const settings = env.kernel.context.get("settings")!
    const providerRuntime = env.kernel.context.get("provider")!
    const category = settings.getSnapshot().find((c) => c.id === YSU_ENDPOINTS_CATEGORY_ID)!
    expect(category).toBeDefined()

    // Pre-populate custom endpoints via a scoped store backed by the same storage
    const store = ysuEndpointStore.create({
      local: {
        getItem: (k) => env.local.backend.getItem(`orahako-plugin:${YSU_PROVIDER_PLUGIN_ID}:${k}`),
        setItem: (k, v) =>
          env.local.backend.setItem(`orahako-plugin:${YSU_PROVIDER_PLUGIN_ID}:${k}`, v),
        removeItem: (k) =>
          env.local.backend.removeItem(`orahako-plugin:${YSU_PROVIDER_PLUGIN_ID}:${k}`),
      },
      secure: env.secure.backend,
    })
    store.actions.setEndpoints({
      customCerBaseUrl: "https://cas.custom.example.org/",
      customJwxtBaseUrl: "https://jwxt.custom.example.org///",
    })
    await Promise.resolve()
    expect(env.local.map.has(`orahako-plugin:${YSU_PROVIDER_PLUGIN_ID}:endpoints`)).toBe(true)
    store.dispose()

    // Restart plugin so its internal store hydrates the persisted custom endpoints
    await env.kernel.stop(YSU_PROVIDER_PLUGIN_ID)
    await env.kernel.startAndWait(YSU_PROVIDER_PLUGIN_ID)
    await new Promise((resolve) => setTimeout(resolve, 10))

    const activeProvider = await providerRuntime.initialize()
    env.fetchUrls.length = 0

    // 1. nativePolling.getServerConfig() reflects overridden URLs
    const pollingCfg = activeProvider.slices.nativePolling!.getServerConfig()
    expect(pollingCfg).toMatchObject({
      cerBaseUrl: "https://cas.custom.example.org",
      jwxtBaseUrl: "https://jwxt.custom.example.org",
    })

    // 2. diagnostics.checkAuth() hits custom CAS base URL
    await activeProvider.diagnostics!.checkAuth()
    expect(
      env.fetchUrls.some((u) => u.startsWith("https://cas.custom.example.org/authserver/index.do"))
    ).toBe(true)

    // 3. Custom host activity labeling & classification work dynamically
    expect(
      env.labelUrl("https://jwxt.custom.example.org/jwapp/sys/cjcx/modules/cjcx/xscjcx.do")
    ).toBe("networkActivity.ysu.grades")
    expect(env.classifyUrl("https://cas.custom.example.org/authserver/login")).toBe("auth")

    env.kernel.dispose()
  })

  it("renders YsuEndpointSettingsPanel via ContributionOutlet in zh/en and resets active YSU provider on endpoint change", async () => {
    const env = createTestRuntimeEnvironment()
    await startAllBuiltins(env.kernel)

    const settings = env.kernel.context.get("settings")!
    const providers = env.kernel.context.get("providers")!
    const providerRuntime = env.kernel.context.get("provider")!

    const category = settings.getSnapshot().find((c) => c.id === YSU_ENDPOINTS_CATEGORY_ID)!

    // Render in Chinese
    const zhHtml = renderToStaticMarkup(
      <ContributionOutlet entry={category} slots={env.slotRegistry} i18n={env.i18nRegistry} />
    )
    expect(zhHtml).toContain("服务器地址覆盖")
    expect(zhHtml).toContain("统一身份认证（CAS）")
    expect(zhHtml).toContain("教务系统（JWXT）")
    expect(zhHtml).toContain(YSU_CONFIG.cas.cerBaseUrl)
    expect(zhHtml).toContain(YSU_CONFIG.jwxt.jwxtBaseUrl)

    // Render in English
    env.i18nRegistry.setLocale("en")
    const enHtml = renderToStaticMarkup(
      <ContributionOutlet entry={category} slots={env.slotRegistry} i18n={env.i18nRegistry} />
    )
    expect(enHtml).toContain("Endpoint Overrides")
    expect(enHtml).toContain("CAS Authentication Server")
    expect(enHtml).toContain("Save &amp; Reconnect")

    // Initialize YSU provider to "ready", then invoke category's injected onEndpointsChanged()
    await providerRuntime.initialize()
    expect(providerRuntime.getSnapshot().status).toBe("ready")
    const genBefore = providerRuntime.getSnapshot().generation

    const resetSpy = vi.spyOn(providerRuntime, "reset")
    const initSpy = vi.spyOn(providerRuntime, "initialize")

    const injected = category.inject?.(env.kernel.context) as {
      readonly defaultCerBaseUrl: string
      readonly defaultJwxtBaseUrl: string
      readonly onEndpointsChanged: () => Promise<void>
    }
    expect(injected.defaultCerBaseUrl).toBe(YSU_CONFIG.cas.cerBaseUrl)
    expect(injected.defaultJwxtBaseUrl).toBe(YSU_CONFIG.jwxt.jwxtBaseUrl)

    await injected.onEndpointsChanged()
    expect(resetSpy).toHaveBeenCalledTimes(1)
    expect(initSpy).toHaveBeenCalledTimes(1)
    expect(providerRuntime.getSnapshot().generation).toBeGreaterThan(genBefore)
    expect(providerRuntime.getSnapshot().status).toBe("ready")

    // When another school ("zmu") is active, onEndpointsChanged() must NOT reset it
    const zmuReset = vi.fn(async () => {})
    providers.registerProvider("zmu", () =>
      defineSchoolProvider({
        id: "zmu",
        name: "ZMU",
        slices: {},
        initialize: async () => {},
        reset: zmuReset,
        logout: async () => {},
        relogin: async () => false,
      })
    )
    providerRuntime.selectSchool("zmu")
    await providerRuntime.initialize()

    resetSpy.mockClear()
    await injected.onEndpointsChanged()
    expect(resetSpy).not.toHaveBeenCalled()
    expect(zmuReset).not.toHaveBeenCalled()

    env.kernel.dispose()
  })
})

interface NodeDirentLike {
  readonly name: string
  isDirectory(): boolean
  isFile(): boolean
}

interface NodeBuiltinTools {
  readdirSync(path: string, options: { withFileTypes: true }): NodeDirentLike[]
  readFileSync(path: string, encoding: "utf8"): string
  join(...paths: string[]): string
  dirname(path: string): string
  extname(path: string): string
  fileURLToPath(url: string): string
}

function loadNodeBuiltinTools(): NodeBuiltinTools {
  const proc = Reflect.get(globalThis, "process")
  if (typeof proc !== "object" || proc === null) {
    throw new Error("Node process is unavailable")
  }
  const getBuiltin = Reflect.get(proc, "getBuiltinModule")
  if (typeof getBuiltin !== "function") {
    throw new Error("process.getBuiltinModule is unavailable")
  }
  const fsMod: unknown = Reflect.apply(getBuiltin, proc, ["node:fs"])
  const pathMod: unknown = Reflect.apply(getBuiltin, proc, ["node:path"])
  const urlMod: unknown = Reflect.apply(getBuiltin, proc, ["node:url"])
  if (
    typeof fsMod !== "object" ||
    fsMod === null ||
    typeof pathMod !== "object" ||
    pathMod === null ||
    typeof urlMod !== "object" ||
    urlMod === null
  ) {
    throw new Error("Node builtin modules unavailable")
  }
  const readdirSync = Reflect.get(fsMod, "readdirSync")
  const readFileSync = Reflect.get(fsMod, "readFileSync")
  const join = Reflect.get(pathMod, "join")
  const dirname = Reflect.get(pathMod, "dirname")
  const extname = Reflect.get(pathMod, "extname")
  const fileURLToPath = Reflect.get(urlMod, "fileURLToPath")
  if (
    typeof readdirSync !== "function" ||
    typeof readFileSync !== "function" ||
    typeof join !== "function" ||
    typeof dirname !== "function" ||
    typeof extname !== "function" ||
    typeof fileURLToPath !== "function"
  ) {
    throw new Error("Node builtin methods unavailable")
  }
  return {
    readdirSync: (p, o) => Reflect.apply(readdirSync, fsMod, [p, o]) as NodeDirentLike[],
    readFileSync: (p, e) => String(Reflect.apply(readFileSync, fsMod, [p, e])),
    join: (...p) => String(Reflect.apply(join, pathMod, p)),
    dirname: (p) => String(Reflect.apply(dirname, pathMod, [p])),
    extname: (p) => String(Reflect.apply(extname, pathMod, [p])),
    fileURLToPath: (u) => String(Reflect.apply(fileURLToPath, urlMod, [u])),
  }
}

describe("package architecture & hygiene gates", () => {
  it("enforces closed package.json exports, zero forbidden imports, zero as-unknown, and pure derived-props TSX", () => {
    expect(Object.keys(pkgJson.exports).sort()).toEqual([".", "./package.json"])

    const tools = loadNodeBuiltinTools()
    const packageRoot = tools.join(tools.dirname(tools.fileURLToPath(import.meta.url)), "..")

    const collectFiles = (dir: string): string[] => {
      const results: string[] = []
      for (const entry of tools.readdirSync(dir, { withFileTypes: true })) {
        const full = tools.join(dir, entry.name)
        if (entry.isDirectory()) {
          results.push(...collectFiles(full))
        } else if (entry.isFile()) {
          const ext = tools.extname(entry.name)
          if (ext === ".ts" || ext === ".tsx") {
            results.push(full)
          }
        }
      }
      return results
    }

    const srcFiles = collectFiles(tools.join(packageRoot, "src"))
    const testFiles = collectFiles(tools.join(packageRoot, "tests"))
    expect(srcFiles.length).toBeGreaterThan(0)
    expect(testFiles.length).toBeGreaterThan(0)

    const allowedRuntimePackages = new Set([
      "@orahako/sdk",
      "@orahako/academic-sdk",
      "@orahako/ui-primitives",
      "@cordisjs/core",
      "react",
      "lucide-react",
      "sonner",
    ])

    const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g
    const asUnknownToken = ["as", "unknown"].join("\\s+")
    const asUnknownPattern = new RegExp(`\\b${asUnknownToken}\\b`)
    const legacySdk = ["@orahako", "plugin-sdk"].join("/")
    const legacyUi = ["@orahako", "plugin-ui"].join("/")

    for (const file of [...srcFiles, ...testFiles]) {
      const source = tools.readFileSync(file, "utf8")
      expect(asUnknownPattern.test(source), `Unexpected cast in ${file}`).toBe(false)
      expect(source).not.toContain(legacySdk)
      expect(source).not.toContain(legacyUi)

      let match: RegExpExecArray | null
      importPattern.lastIndex = 0
      while ((match = importPattern.exec(source)) !== null) {
        const spec = match[1]!
        expect(spec.startsWith("@/"), `Forbidden @/ import in ${file}: ${spec}`).toBe(false)
        expect(
          spec === "next" || spec.startsWith("next/"),
          `Forbidden next import in ${file}: ${spec}`
        ).toBe(false)

        if (srcFiles.includes(file) && !spec.startsWith("./") && !spec.startsWith("../")) {
          expect(
            allowedRuntimePackages.has(spec),
            `Disallowed runtime import in ${file}: ${spec}`
          ).toBe(true)
        }
      }

      if (file.endsWith(".tsx") && srcFiles.includes(file)) {
        expect(source).not.toContain("useSyncExternalStore")
        expect(source).not.toContain("createContext")
        expect(source).not.toContain("useContext")
      }
    }
  })
})
