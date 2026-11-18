import { vi } from "vitest"
import type {
  CookieJar,
  MfaResult,
  QuerySnapshot,
  SessionService,
  SessionSnapshot,
} from "@orahako/academic-sdk"
import {
  createObservableSource,
  type CookieEntry,
  type HttpRequest,
  type HttpResponse,
  type NetworkActivitySnapshot,
  type ObservableSource,
  type PluginLocale,
} from "@orahako/sdk"
import { createYSUContext, type YSUContext } from "../src/context"
import type { YsuEndpointState } from "../src/endpoints"
import { YSU_CONFIG, type YSUConfig } from "../src/ysu-config"

export interface MutableSessionState {
  activeSchoolId: string | null
  username: string | null
  credential: string | null
  isAuthenticated: boolean
  sessionExpired: boolean
  artifacts: Record<string, string>
}

export type JarFetch = (jar: CookieJar, request: HttpRequest) => Promise<HttpResponse>

function domainOf(url: string): string {
  return new URL(url).hostname
}

/** Minimal in-memory jar with the subset of cookie semantics the protocols use. */
export class TestCookieJar implements CookieJar {
  private entries: CookieEntry[] = []

  async setCookie(cookie: string, url: string): Promise<void> {
    const [pair, ...attributes] = cookie.split(";").map((part) => part.trim())
    const separator = pair?.indexOf("=") ?? -1
    if (!pair || separator <= 0) return
    const name = pair.slice(0, separator)
    const value = pair.slice(separator + 1)
    let domain = domainOf(url)
    let path = "/"
    for (const attribute of attributes) {
      const [rawKey, rawValue = ""] = attribute.split("=")
      const key = rawKey?.toLowerCase()
      if (key === "domain") domain = rawValue.replace(/^\./, "")
      if (key === "path" && rawValue) path = rawValue
    }
    this.entries = [
      ...this.entries.filter(
        (entry) => !(entry.name === name && entry.domain === domain && entry.path === path)
      ),
      { name, value, domain, path, secure: url.startsWith("https:"), expires: null },
    ]
  }

  async getCookieString(url: string): Promise<string> {
    const host = domainOf(url)
    const path = new URL(url).pathname
    return this.entries
      .filter((entry) => host.endsWith(entry.domain) && path.startsWith(entry.path))
      .map((entry) => `${entry.name}=${entry.value}`)
      .join("; ")
  }

  async getAllCookies(): Promise<readonly CookieEntry[]> {
    return [...this.entries]
  }

  async removeCookie(domain: string, path: string, key: string): Promise<void> {
    this.entries = this.entries.filter(
      (entry) => !(entry.domain === domain && entry.path === path && entry.name === key)
    )
  }

  toJSON(): string {
    return JSON.stringify({ cookies: this.entries })
  }
}

export function emptyResponse(url = "https://example.invalid"): HttpResponse {
  return {
    status: 200,
    headers: {},
    url,
    text: async () => "",
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

export function textResponse(
  url: string,
  body = "",
  status = 200,
  headers: Record<string, string | string[]> = {}
): HttpResponse {
  return {
    status,
    headers,
    url,
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  }
}

export interface TestContextOptions {
  readonly state?: MutableSessionState
  readonly initialState?: Partial<MutableSessionState>
  readonly fetchWithJar?: JarFetch
  readonly httpSend?: (request: HttpRequest) => Promise<HttpResponse>
  readonly mfaShow?: () => Promise<MfaResult>
  readonly config?: YSUConfig
  readonly getEndpoints?: () => Partial<YsuEndpointState> | undefined
  readonly isNative?: boolean
}

export interface TestContext {
  readonly ctx: YSUContext
  readonly state: MutableSessionState
  readonly jars: TestCookieJar[]
  readonly localStore: Map<string, string>
  readonly secureStore: Map<string, string>
}

export function createTestContext(options: TestContextOptions = {}): TestContext {
  const config = options.config ?? YSU_CONFIG
  const state: MutableSessionState = options.state ?? {
    activeSchoolId: options.initialState?.activeSchoolId ?? config.id,
    username: options.initialState?.username ?? null,
    credential: options.initialState?.credential ?? null,
    isAuthenticated: options.initialState?.isAuthenticated ?? false,
    sessionExpired: options.initialState?.sessionExpired ?? false,
    artifacts: { ...(options.initialState?.artifacts ?? {}) },
  }

  const jars: TestCookieJar[] = []
  const localStore = new Map<string, string>()
  const secureStore = new Map<string, string>()
  const fetchWithJar = options.fetchWithJar ?? (async () => emptyResponse())
  const httpSend = options.httpSend ?? (async () => emptyResponse())

  const toSnapshot = (): SessionSnapshot => ({
    activeSchoolId: state.activeSchoolId,
    credential: state.credential,
    username: state.username,
    isAuthenticated: state.isAuthenticated,
    sessionExpired: state.sessionExpired,
    hasHydrated: true,
    artifacts: { ...state.artifacts },
  })

  const sessionSource = createObservableSource<SessionSnapshot>(toSnapshot())
  const syncSession = (): void => {
    sessionSource.set(toSnapshot())
  }

  const session: SessionService = {
    state: {
      getSnapshot: () => toSnapshot(),
      subscribe: sessionSource.subscribe,
    },
    getSnapshot: () => toSnapshot(),
    subscribe: sessionSource.subscribe,
    setCredential(input) {
      state.activeSchoolId = input.schoolId
      state.credential = input.credential
      state.username = input.username ?? null
      state.isAuthenticated = true
      state.sessionExpired = false
      state.artifacts = {}
      syncSession()
    },
    activateSchool(schoolId) {
      state.activeSchoolId = schoolId
      syncSession()
    },
    clearCredential() {
      state.credential = null
      state.username = null
      state.isAuthenticated = false
      state.sessionExpired = false
      state.artifacts = {}
      syncSession()
    },
    setSessionExpired(expired) {
      state.sessionExpired = expired
      syncSession()
    },
    setArtifact(key, value) {
      if (value === null) delete state.artifacts[key]
      else state.artifacts[key] = value
      syncSession()
    },
    getArtifact(key) {
      return state.artifacts[key] ?? null
    },
    createCookieJar() {
      const jar = new TestCookieJar()
      jars.push(jar)
      return jar
    },
    fetchWithJar: (jar, request) => fetchWithJar(jar, request),
  }

  const activitySnapshot: NetworkActivitySnapshot = {
    active: [],
    history: [],
    session: null,
    revision: 0,
  }
  const activitySource = createObservableSource<NetworkActivitySnapshot>(activitySnapshot)
  const localeSource = createObservableSource<PluginLocale>("zh")
  const queryActivity = createObservableSource({ refreshingCount: 0, staleCount: 0 })

  const ctx = createYSUContext({
    config,
    getEndpoints: options.getEndpoints,
    session,
    http: {
      send: (req) => httpSend(req),
      activity: {
        state: activitySource,
        getSnapshot: activitySource.getSnapshot,
        subscribe: activitySource.subscribe,
        registerLabeler: () => () => {},
        registerClassifier: () => () => {},
        beginRequest: () => () => {},
      },
    },
    storage: {
      local: {
        getItem: async (key) => localStore.get(key) ?? null,
        setItem: async (key, value) => {
          localStore.set(key, value)
        },
        removeItem: async (key) => {
          localStore.delete(key)
        },
      },
      secure: {
        getItem: async (key) => secureStore.get(key) ?? null,
        setItem: async (key, value) => {
          secureStore.set(key, value)
        },
        removeItem: async (key) => {
          secureStore.delete(key)
        },
      },
    },
    native: {
      isNative: options.isNative ?? false,
      capabilities: {
        list: () => [],
        has: () => false,
        acquire: async () => async () => {},
        invoke: vi.fn(async () => {
          throw new Error("native capability unavailable")
        }),
      },
      saveImage: async () => ({ uri: "" }),
      requestNotificationPermission: async () => false,
      requestExactAlarmPermission: async () => false,
      requestBatteryOptimizationExemption: async () => false,
    },
    i18n: {
      locale: localeSource,
      register: () => () => {},
      t: (key) => key,
      translator: () => (key) => String(key),
      getLocale: () => localeSource.getSnapshot(),
      setLocale: (next) => localeSource.set(next),
    },
    query: {
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
      invalidate: vi.fn(),
      key: () => [],
      cacheKey: () => "",
      readPersistent: () => null,
      writePersistent: () => {},
      clearPersistent: vi.fn(),
    },
    mfa: {
      show:
        options.mfaShow ??
        (async () => {
          throw new Error("MFA interaction is not configured in this test")
        }),
    },
    appVersion: "1.0.0-test",
  })

  return { ctx, state, jars, localStore, secureStore }
}
