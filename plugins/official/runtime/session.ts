import {
  definePlugin,
  PLUGIN_API_VERSION,
  type CompositionPlugin,
  type CookieJar,
  type CredentialInput,
  type HttpRequest,
  type HttpResponse,
  type NetworkActivitySink,
  type PluginConfig,
  type PluginContext,
  type PluginDefinition,
  type PluginManifest,
  type PluginSessionService,
  type SessionSnapshot,
} from "@orahako/plugin-sdk"
import {
  SimpleCookieJar,
  fetchWithJar as fetchWithCookieJar,
  type ActivationTokenSource,
} from "./http/cookie"
import { useAuthStore, type AuthState } from "./session-store"

export interface SessionRuntimeConfig extends PluginConfig {
  /** School activated at startup; omitting it leaves the session school-less. */
  defaultSchoolId?: string
}

/** Cordis events published for consumers of the session service. */
export interface SessionSnapshotEvents {
  changed(snapshot: SessionSnapshot): void
  expired(snapshot: SessionSnapshot): void
}

function snapshotOf(state: AuthState): SessionSnapshot {
  return {
    activeSchoolId: state.activeSchoolId,
    credential: state.credential,
    username: state.username,
    isAuthenticated: state.isAuthenticated,
    sessionExpired: state.sessionExpired,
    hasHydrated: state.hasHydrated,
    artifacts: { ...state.artifacts },
  }
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
  if (!schoolId) {
    throw new Error(
      `Cannot ${operation}: no school is active. Activate a school first or pass an explicit schoolId.`
    )
  }
  return schoolId
}

/**
 * Session service backed by the securely persisted auth store. It owns the
 * generic view of school-scoped credentials and artifacts, while the store
 * keeps its legacy UI selectors for the current consumers.
 */
export class PersistedSessionService implements PluginSessionService {
  private readonly events: SessionSnapshotEvents
  private readonly activity: NetworkActivitySink
  private readonly listeners = new Set<() => void>()
  private readonly unsubscribeStore: () => void
  private snapshot: SessionSnapshot

  constructor(
    events: SessionSnapshotEvents,
    activity: NetworkActivitySink,
    private readonly activation?: ActivationTokenSource
  ) {
    this.events = events
    this.activity = activity
    this.snapshot = snapshotOf(useAuthStore.getState())
    this.unsubscribeStore = useAuthStore.subscribe((state) => this.publish(state))
  }

  /** Detaches from the auth store; the plugin context calls this on dispose. */
  dispose(): void {
    this.unsubscribeStore()
    this.listeners.clear()
  }

  getSnapshot(): SessionSnapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setCredential(input: CredentialInput): void {
    const schoolId = requireSchoolId(input.schoolId, "store a credential")
    useAuthStore.getState().setCredential(input.credential, input.username ?? null, schoolId)
  }

  activateSchool(schoolId: string): void {
    useAuthStore.getState().activateSchool(requireSchoolId(schoolId, "activate a school"))
  }

  clearCredential(schoolId?: string): void {
    useAuthStore.getState().clearCredential(schoolId)
  }

  setSessionExpired(expired: boolean): void {
    useAuthStore.getState().setSessionExpired(expired)
  }

  setArtifact(key: string, value: string | null, schoolId?: string): void {
    if (!key) throw new Error("Cannot store a session artifact without a key.")
    useAuthStore.getState().setArtifact(key, value, schoolId)
  }

  getArtifact(key: string, schoolId?: string): string | null {
    if (!key) throw new Error("Cannot read a session artifact without a key.")
    return useAuthStore.getState().getArtifact(key, schoolId)
  }

  createCookieJar(serialized?: string): CookieJar {
    return serialized ? SimpleCookieJar.fromJSON(serialized) : new SimpleCookieJar()
  }

  async fetchWithJar(jar: CookieJar, request: HttpRequest): Promise<HttpResponse> {
    const target =
      jar instanceof SimpleCookieJar ? jar : SimpleCookieJar.fromJSON(jar.toJSON())
    return fetchWithCookieJar(target, request, this.activity, this.activation)
  }

  private publish(state: AuthState): void {
    const next = snapshotOf(state)
    const previous = this.snapshot
    if (sameSnapshot(previous, next)) return
    this.snapshot = next
    for (const listener of this.listeners) listener()
    this.events.changed(next)
    if (next.sessionExpired && !previous.sessionExpired) {
      this.events.expired(next)
    }
  }
}

const sessionManifest: PluginManifest = {
  id: "orahako.runtime.session",
  name: "Session state and cookie transport",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "runtime",
  entry: "index.js",
  description: "School-scoped credentials, generic session artifacts and cookie jars.",
  provides: ["session"],
  inject: ["http"],
  configSchema: {
    type: "object",
    properties: {
      defaultSchoolId: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  },
}

/**
 * Builds the session runtime with the composition-owned activation credential
 * source. Transport code never reads a shell store directly.
 */
export function createSessionRuntimePlugin(
  activation?: ActivationTokenSource
): CompositionPlugin {
  const definition: PluginDefinition<SessionRuntimeConfig> = definePlugin(
    (ctx: PluginContext, config: SessionRuntimeConfig) => {
      const service = new PersistedSessionService(
        {
          changed: (snapshot) => ctx.emit("session/changed", snapshot),
          expired: (snapshot) => ctx.emit("session/expired", snapshot),
        },
        ctx.http.activity,
        activation
      )
      ctx.on("dispose", () => service.dispose())
      // The configured default only applies when the caller supplies it, and it
      // must be part of the initial snapshot consumers read after startup.
      if (typeof config.defaultSchoolId === "string" && config.defaultSchoolId.length > 0) {
        service.activateSchool(config.defaultSchoolId)
      }
      ctx.set("session", service)
    }
  )
  return { manifest: sessionManifest, definition }
}

/** Default session runtime without web activation wiring. */
export const sessionRuntimePlugin: CompositionPlugin = createSessionRuntimePlugin()
