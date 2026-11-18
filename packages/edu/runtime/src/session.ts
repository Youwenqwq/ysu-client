import type {
  CookieJar,
  CredentialInput,
  SessionService,
  SessionSnapshot,
} from "@orahako/academic-sdk"
import {
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  type Context,
  type HttpRequest,
  type HttpResponse,
  type ObservableSource,
  type PluginConfig,
  type PluginHttpService,
  type PluginStorageService,
} from "@orahako/sdk"
import { fetchWithCookieJar, SimpleCookieJar } from "./cookie-jar"

const SESSION_META_KEY = "session-meta"
const SESSION_SECRETS_KEY = "session-secrets"

export interface SessionRuntimeConfig extends PluginConfig {
  readonly defaultSchoolId?: string
}

interface StoredCredential {
  readonly credential: string
  readonly username: string | null
}

type StoredArtifacts = Record<string, string>

interface PersistedSessionMeta {
  readonly version: 1
  readonly activeSchoolId: string | null
  readonly sessionExpired: boolean
}

interface PersistedSessionSecrets {
  readonly version: 1
  readonly credentialsBySchool: Record<string, StoredCredential>
  readonly artifactsBySchool: Record<string, StoredArtifacts>
}

export interface SessionRuntimeServiceOptions {
  readonly ctx: Pick<Context, "emit">
  readonly storage: PluginStorageService
  readonly http: PluginHttpService
  readonly defaultSchoolId?: string
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function sameArtifacts(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
): boolean {
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => left[key] === right[key])
}

function sameSnapshot(left: SessionSnapshot, right: SessionSnapshot): boolean {
  return (
    left.activeSchoolId === right.activeSchoolId &&
    left.credential === right.credential &&
    left.username === right.username &&
    left.isAuthenticated === right.isAuthenticated &&
    left.sessionExpired === right.sessionExpired &&
    left.hasHydrated === right.hasHydrated &&
    sameArtifacts(left.artifacts, right.artifacts)
  )
}

function requireSchoolId(schoolId: string | null | undefined, operation: string): string {
  if (!schoolId || !schoolId.trim()) {
    throw new Error(
      `Cannot ${operation}: no school is active. Activate a school first or pass an explicit schoolId.`
    )
  }
  return schoolId
}

function parsePersistedMeta(raw: string | null): Partial<PersistedSessionMeta> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainRecord(parsed)) return {}
    const activeSchoolId =
      typeof parsed.activeSchoolId === "string" && parsed.activeSchoolId.length > 0
        ? parsed.activeSchoolId
        : null
    const sessionExpired = Boolean(parsed.sessionExpired)
    return { activeSchoolId, sessionExpired }
  } catch {
    return {}
  }
}

function parsePersistedSecrets(raw: string | null): {
  credentialsBySchool: Record<string, StoredCredential>
  artifactsBySchool: Record<string, StoredArtifacts>
} {
  const credentialsBySchool: Record<string, StoredCredential> = {}
  const artifactsBySchool: Record<string, StoredArtifacts> = {}
  if (!raw) return { credentialsBySchool, artifactsBySchool }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isPlainRecord(parsed)) return { credentialsBySchool, artifactsBySchool }

    if (isPlainRecord(parsed.credentialsBySchool)) {
      for (const [school, value] of Object.entries(parsed.credentialsBySchool)) {
        if (!school || !isPlainRecord(value) || typeof value.credential !== "string") continue
        const username = typeof value.username === "string" ? value.username : null
        credentialsBySchool[school] = {
          credential: value.credential,
          username,
        }
      }
    }

    if (isPlainRecord(parsed.artifactsBySchool)) {
      for (const [school, value] of Object.entries(parsed.artifactsBySchool)) {
        if (!school || !isPlainRecord(value)) continue
        const cleanArtifacts: StoredArtifacts = {}
        for (const [k, v] of Object.entries(value)) {
          if (k && typeof v === "string") {
            cleanArtifacts[k] = v
          }
        }
        artifactsBySchool[school] = cleanArtifacts
      }
    }
  } catch {
    // Ignore corrupted storage payloads and start clean.
  }

  return { credentialsBySchool, artifactsBySchool }
}

export class ScopedSessionService implements SessionService {
  readonly state: ObservableSource<SessionSnapshot>
  readonly hydrated: Promise<void>

  private readonly ctx: Pick<Context, "emit">
  private readonly storage: PluginStorageService
  private readonly http: PluginHttpService
  private readonly stateSource: ReturnType<typeof createObservableSource<SessionSnapshot>>

  private activeSchoolId: string | null
  private credentialsBySchool: Record<string, StoredCredential> = {}
  private artifactsBySchool: Record<string, StoredArtifacts> = {}
  private sessionExpired = false
  private hasHydrated = false
  private disposed = false

  // Track mutations made prior to async hydration completion so user actions win over stale storage
  private dirtySchoolSelection = false
  private dirtySessionExpired = false
  private readonly touchedCredentialSchools = new Set<string>()
  private readonly clearedSchools = new Set<string>()
  private readonly resetArtifactSchools = new Set<string>()
  private readonly touchedArtifactKeys = new Map<string, Set<string>>()

  constructor({ ctx, storage, http, defaultSchoolId }: SessionRuntimeServiceOptions) {
    this.ctx = ctx
    this.storage = storage
    this.http = http
    this.activeSchoolId =
      typeof defaultSchoolId === "string" && defaultSchoolId.trim().length > 0
        ? defaultSchoolId
        : null

    this.stateSource = createObservableSource<SessionSnapshot>(this.computeSnapshot(), sameSnapshot)
    this.state = {
      getSnapshot: this.stateSource.getSnapshot,
      subscribe: this.stateSource.subscribe,
    }
    this.hydrated = this.hydrate()
  }

  dispose(): void {
    this.disposed = true
  }

  getSnapshot = (): SessionSnapshot => {
    return this.stateSource.getSnapshot()
  }

  subscribe = (listener: () => void): (() => void) => {
    return this.stateSource.subscribe(listener)
  }

  setCredential = (input: CredentialInput): void => {
    const school = requireSchoolId(input.schoolId, "store a credential")
    const username = input.username ?? null

    this.credentialsBySchool = {
      ...this.credentialsBySchool,
      [school]: { credential: input.credential, username },
    }
    // A fresh credential invalidates artifacts derived from the previous credential
    this.artifactsBySchool = {
      ...this.artifactsBySchool,
      [school]: {},
    }
    this.activeSchoolId = school
    this.sessionExpired = false

    if (!this.hasHydrated) {
      this.dirtySchoolSelection = true
      this.dirtySessionExpired = true
      this.clearedSchools.delete(school)
      this.touchedCredentialSchools.add(school)
      this.resetArtifactSchools.add(school)
      this.touchedArtifactKeys.delete(school)
    } else {
      this.persistMeta()
      this.persistSecrets()
    }

    this.publish()
  }

  activateSchool = (schoolId: string): void => {
    const school = requireSchoolId(schoolId, "activate a school")
    this.activeSchoolId = school
    this.sessionExpired = false

    if (!this.hasHydrated) {
      this.dirtySchoolSelection = true
      this.dirtySessionExpired = true
    } else {
      this.persistMeta()
    }

    this.publish()
  }

  clearCredential = (schoolId?: string): void => {
    const school = requireSchoolId(schoolId ?? this.activeSchoolId, "clear a credential")
    const nextCredentials = { ...this.credentialsBySchool }
    delete nextCredentials[school]
    this.credentialsBySchool = nextCredentials

    const nextArtifacts = { ...this.artifactsBySchool }
    delete nextArtifacts[school]
    this.artifactsBySchool = nextArtifacts

    if (this.activeSchoolId === school) {
      this.sessionExpired = false
    }

    if (!this.hasHydrated) {
      this.clearedSchools.add(school)
      this.touchedCredentialSchools.delete(school)
      this.resetArtifactSchools.delete(school)
      this.touchedArtifactKeys.delete(school)
      if (this.activeSchoolId === school) {
        this.dirtySessionExpired = true
      }
    } else {
      if (this.activeSchoolId === school) {
        this.persistMeta()
      }
      this.persistSecrets()
    }

    this.publish()
  }

  setSessionExpired = (expired: boolean): void => {
    this.sessionExpired = expired
    if (!this.hasHydrated) {
      this.dirtySessionExpired = true
    } else {
      this.persistMeta()
    }
    this.publish()
  }

  setArtifact = (key: string, value: string | null, schoolId?: string): void => {
    if (!key) {
      throw new Error("Cannot store a session artifact without a key.")
    }
    const school = requireSchoolId(
      schoolId ?? this.activeSchoolId,
      `store session artifact "${key}"`
    )
    const nextSchoolArtifacts: StoredArtifacts = { ...(this.artifactsBySchool[school] ?? {}) }
    if (value === null) {
      delete nextSchoolArtifacts[key]
    } else {
      nextSchoolArtifacts[key] = value
    }
    this.artifactsBySchool = {
      ...this.artifactsBySchool,
      [school]: nextSchoolArtifacts,
    }

    if (!this.hasHydrated) {
      let keys = this.touchedArtifactKeys.get(school)
      if (!keys) {
        keys = new Set<string>()
        this.touchedArtifactKeys.set(school, keys)
      }
      keys.add(key)
    } else {
      this.persistSecrets()
    }

    this.publish()
  }

  getArtifact = (key: string, schoolId?: string): string | null => {
    if (!key) {
      throw new Error("Cannot read a session artifact without a key.")
    }
    const school = requireSchoolId(
      schoolId ?? this.activeSchoolId,
      `read session artifact "${key}"`
    )
    return this.artifactsBySchool[school]?.[key] ?? null
  }

  createCookieJar = (serialized?: string): CookieJar => {
    return serialized ? SimpleCookieJar.fromJSON(serialized) : new SimpleCookieJar()
  }

  fetchWithJar = async (jar: CookieJar, request: HttpRequest): Promise<HttpResponse> => {
    return fetchWithCookieJar(this.http, jar, request)
  }

  private async hydrate(): Promise<void> {
    let rawMeta: string | null = null
    let rawSecrets: string | null = null
    try {
      ;[rawMeta, rawSecrets] = await Promise.all([
        this.storage.local.getItem(SESSION_META_KEY),
        this.storage.secure.getItem(SESSION_SECRETS_KEY),
      ])
    } catch {
      // Proceed with in-memory state if storage read fails.
    }

    if (this.disposed) return

    const savedMeta = parsePersistedMeta(rawMeta)
    const savedSecrets = parsePersistedSecrets(rawSecrets)

    const mergedCredentials: Record<string, StoredCredential> = {
      ...savedSecrets.credentialsBySchool,
    }
    for (const cleared of this.clearedSchools) {
      delete mergedCredentials[cleared]
    }
    for (const touched of this.touchedCredentialSchools) {
      const current = this.credentialsBySchool[touched]
      if (current) {
        mergedCredentials[touched] = current
      }
    }

    const mergedArtifacts: Record<string, StoredArtifacts> = {
      ...savedSecrets.artifactsBySchool,
    }
    for (const cleared of this.clearedSchools) {
      delete mergedArtifacts[cleared]
    }
    for (const resetSchool of this.resetArtifactSchools) {
      mergedArtifacts[resetSchool] = {}
    }
    for (const [school, keys] of this.touchedArtifactKeys.entries()) {
      const target: StoredArtifacts = { ...(mergedArtifacts[school] ?? {}) }
      const currentSchoolArtifacts = this.artifactsBySchool[school] ?? {}
      for (const key of keys) {
        if (key in currentSchoolArtifacts) {
          target[key] = currentSchoolArtifacts[key]!
        } else {
          delete target[key]
        }
      }
      mergedArtifacts[school] = target
    }

    const hadPreHydrationMutation =
      this.dirtySchoolSelection ||
      this.dirtySessionExpired ||
      this.touchedCredentialSchools.size > 0 ||
      this.clearedSchools.size > 0 ||
      this.resetArtifactSchools.size > 0 ||
      this.touchedArtifactKeys.size > 0

    if (!this.dirtySchoolSelection && savedMeta.activeSchoolId) {
      this.activeSchoolId = savedMeta.activeSchoolId
    }

    this.credentialsBySchool = mergedCredentials
    this.artifactsBySchool = mergedArtifacts

    if (!this.dirtySessionExpired) {
      const hasActiveCredential = Boolean(
        this.activeSchoolId && this.credentialsBySchool[this.activeSchoolId]
      )
      this.sessionExpired = hasActiveCredential ? Boolean(savedMeta.sessionExpired) : false
    }

    this.clearedSchools.clear()
    this.touchedCredentialSchools.clear()
    this.resetArtifactSchools.clear()
    this.touchedArtifactKeys.clear()
    this.hasHydrated = true

    if (hadPreHydrationMutation) {
      this.persistMeta()
      this.persistSecrets()
    }

    this.publish()
  }

  private persistMeta(): void {
    const payload: PersistedSessionMeta = {
      version: 1,
      activeSchoolId: this.activeSchoolId,
      sessionExpired: this.sessionExpired,
    }
    void this.storage.local.setItem(SESSION_META_KEY, JSON.stringify(payload)).catch(() => {
      // Storage quota or unavailable errors must not crash active session state.
    })
  }

  private persistSecrets(): void {
    const payload: PersistedSessionSecrets = {
      version: 1,
      credentialsBySchool: this.credentialsBySchool,
      artifactsBySchool: this.artifactsBySchool,
    }
    void this.storage.secure.setItem(SESSION_SECRETS_KEY, JSON.stringify(payload)).catch(() => {
      // Storage quota or unavailable errors must not crash active session state.
    })
  }

  private computeSnapshot(): SessionSnapshot {
    const school = this.activeSchoolId
    const stored = school ? this.credentialsBySchool[school] : undefined
    const schoolArtifacts = school ? this.artifactsBySchool[school] : undefined
    return {
      activeSchoolId: school,
      credential: stored?.credential ?? null,
      username: stored?.username ?? null,
      isAuthenticated: Boolean(stored),
      sessionExpired: this.sessionExpired,
      hasHydrated: this.hasHydrated,
      artifacts: schoolArtifacts ? { ...schoolArtifacts } : {},
    }
  }

  private publish(): void {
    if (this.disposed) return
    const previous = this.stateSource.getSnapshot()
    const next = this.computeSnapshot()
    if (sameSnapshot(previous, next)) return

    this.stateSource.set(next)
    this.ctx.emit("session/changed", next)
    if (next.sessionExpired && !previous.sessionExpired) {
      this.ctx.emit("session/expired", next)
    }
  }
}

export const sessionRuntimePlugin = definePlugin({
  manifest: {
    id: "orahako.runtime.session",
    name: "Session state and cookie transport",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description: "School-scoped credentials, session artifacts, and RFC cookie jar HTTP loop.",
    provides: ["session"],
    inject: ["storage", "http"],
    configSchema: {
      type: "object",
      properties: {
        defaultSchoolId: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  inject: ["storage", "http"],
  apply(ctx, config: SessionRuntimeConfig = {}) {
    const service = new ScopedSessionService({
      ctx,
      storage: ctx.storage,
      http: ctx.http,
      defaultSchoolId: config.defaultSchoolId,
    })
    ctx.set("session", service)
    ctx.effect(() => () => service.dispose())
  },
})
