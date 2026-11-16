import { vi } from "vitest"
import type {
  CookieEntry,
  CookieJar,
  HttpRequest,
  HttpResponse,
  PluginSessionService,
  SessionSnapshot,
} from "@orahako/plugin-sdk"
import { YSU_CONFIG, type YSUConfig } from "./ysu-config"
import { createYSUUrls, type YSUContext } from "./context"

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

function emptyResponse(url = "https://example.invalid"): HttpResponse {
  return {
    status: 200,
    headers: {},
    url,
    text: async () => "",
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

export interface TestContextOptions {
  readonly state?: Partial<MutableSessionState>
  readonly fetchWithJar?: JarFetch
  readonly config?: YSUConfig
}

export interface TestContext {
  readonly ctx: YSUContext
  readonly state: MutableSessionState
  readonly jars: TestCookieJar[]
}

export function createTestContext(options: TestContextOptions = {}): TestContext {
  const config = options.config ?? YSU_CONFIG
  const state = (options.state ?? {}) as MutableSessionState
  state.activeSchoolId ??= config.id
  state.username ??= null
  state.credential ??= null
  state.isAuthenticated ??= false
  state.sessionExpired ??= false
  state.artifacts ??= {}
  const jars: TestCookieJar[] = []
  const secure = new Map<string, string>()
  const fetchWithJar = options.fetchWithJar ?? (async () => emptyResponse())

  const session: PluginSessionService = {
    getSnapshot(): SessionSnapshot {
      return {
        activeSchoolId: state.activeSchoolId,
        credential: state.credential,
        username: state.username,
        isAuthenticated: state.isAuthenticated,
        sessionExpired: state.sessionExpired,
        hasHydrated: true,
        artifacts: { ...state.artifacts },
      }
    },
    subscribe: () => () => {},
    setCredential(input) {
      state.activeSchoolId = input.schoolId
      state.credential = input.credential
      state.username = input.username ?? null
      state.isAuthenticated = true
      state.sessionExpired = false
    },
    activateSchool(schoolId) {
      state.activeSchoolId = schoolId
    },
    clearCredential() {
      state.credential = null
      state.username = null
      state.isAuthenticated = false
      state.artifacts = {}
    },
    setSessionExpired(expired) {
      state.sessionExpired = expired
    },
    setArtifact(key, value) {
      if (value === null) delete state.artifacts[key]
      else state.artifacts[key] = value
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

  const ctx: YSUContext = {
    config,
    urls: createYSUUrls(config),
    session,
    http: {
      send: async () => emptyResponse(),
      activity: {
        getSnapshot: () => ({
          active: [],
          history: [],
          session: null,
          revision: 0,
        }),
        subscribe: () => () => {},
        registerLabeler: () => () => {},
        registerClassifier: () => () => {},
        beginRequest: () => () => {},
      },
    },
    storage: {
      local: {
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
      },
      secure: {
        getItem: async (key) => secure.get(key) ?? null,
        setItem: async (key, value) => {
          secure.set(key, value)
        },
        removeItem: async (key) => {
          secure.delete(key)
        },
      },
    },
    native: {
      isNative: false,
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
      register: () => () => {},
      t: (key) => key,
      getLocale: () => "zh",
      setLocale: () => {},
    },
    query: {
      key: () => [],
      cacheKey: () => "",
      policy: () => ({ ttl: 0, persist: false }),
      registerPolicy: () => () => {},
      readPersistent: () => null,
      writePersistent: () => {},
      clearPersistent: () => {},
      invalidate: () => {},
    },
    mfa: {
      show: async () => {
        throw new Error("MFA interaction is not configured in this test")
      },
    },
    appVersion: "0.0.0-test",
  }

  return { ctx, state, jars }
}
