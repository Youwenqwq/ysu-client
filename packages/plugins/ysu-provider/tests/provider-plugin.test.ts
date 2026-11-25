import { describe, expect, it } from "vitest"
import {
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
  manifest,
  YSU_CONFIG,
  YSU_PROVIDER_PLUGIN_ID,
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

  const kernel = new PluginRuntime()
  kernel.context.set(
    "storage",
    new NamespacedStorageService({ local: local.backend, secure: secure.backend })
  )
  kernel.context.set("i18n", i18nRegistry)
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

describe("ysu.provider manifest & plugin lifecycle", () => {
  it("exports API v1 manifest and registers/cleans up provider, i18n, and activity hooks without a settings category", async () => {
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
      inject: ["i18n", "storage", "providers", "http", "session", "query", "native", "mfa"],
    })
    expect(manifest.apiVersion).toBe(1)

    const env = createTestRuntimeEnvironment()
    await startAllBuiltins(env.kernel)

    const providers = env.kernel.context.get("providers")!
    const providerRuntime = env.kernel.context.get("provider")!
    const settings = env.kernel.context.get("settings")!

    expect(providers.hasProvider("ysu")).toBe(true)
    providerRuntime.selectSchool("ysu")
    expect(providerRuntime.getSnapshot().schoolId).toBe("ysu")
    expect(providerRuntime.getSnapshot().provider?.id).toBe("ysu")
    expect(
      settings.getSnapshot().some((category) => category.pluginId === YSU_PROVIDER_PLUGIN_ID)
    ).toBe(false)

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
    expect(
      env.labelUrl("https://jwxt.custom.example.org/jwapp/sys/cjcx/modules/cjcx/xscjcx.do")
    ).toBeUndefined()

    await env.kernel.stop(YSU_PROVIDER_PLUGIN_ID)
    expect(providers.hasProvider("ysu")).toBe(false)
    expect(
      env.i18nRegistry.translate(YSU_PROVIDER_PLUGIN_ID, "networkActivity.ysu.grades", "zh")
    ).toBe("networkActivity.ysu.grades")
    expect(providerRuntime.getSnapshot().status).toBe("unavailable")
    expect(
      settings.getSnapshot().some((category) => category.pluginId === YSU_PROVIDER_PLUGIN_ID)
    ).toBe(false)
    expect(env.labelers.size).toBe(0)
    expect(env.classifiers.size).toBe(0)

    env.kernel.dispose()
  })

  it("pins provider endpoints to YSU_CONFIG and ignores legacy custom endpoint storage", async () => {
    const localMap = new Map<string, string>([
      [
        `orahako-plugin:${YSU_PROVIDER_PLUGIN_ID}:endpoints`,
        JSON.stringify({
          customCerBaseUrl: "https://cas.custom.example.org",
          customJwxtBaseUrl: "https://jwxt.custom.example.org",
        }),
      ],
    ])
    const env = createTestRuntimeEnvironment({ localMap })
    await startAllBuiltins(env.kernel)

    const providerRuntime = env.kernel.context.get("provider")!
    const provider = providerRuntime.selectSchool("ysu")

    expect(provider.slices.timetable!.scheduleRules).toEqual({
      timeZone: "Asia/Shanghai",
      lunchAfter: 4,
      dinnerAfter: 8,
    })
    expect(provider.slices.nativePolling!.getServerConfig()).toMatchObject({
      cerBaseUrl: YSU_CONFIG.cas.cerBaseUrl,
      jwxtBaseUrl: YSU_CONFIG.jwxt.jwxtBaseUrl,
    })
    expect(
      env.labelUrl("https://jwxt.custom.example.org/jwapp/sys/cjcx/modules/cjcx/xscjcx.do")
    ).toBeUndefined()

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

    const allowedRuntimePackages: Record<string, true> = {
      "@orahako/sdk": true,
      "@orahako/academic-sdk": true,
      "@orahako/ui-primitives": true,
      "@cordisjs/core": true,
      "react": true,
      "lucide-react": true,
      "sonner": true,
    }

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
            Object.hasOwn(allowedRuntimePackages, spec),
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
