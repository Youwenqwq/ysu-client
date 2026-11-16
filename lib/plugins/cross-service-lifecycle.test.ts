import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type {
  CredentialInput,
  PluginContext,
  PluginQueryService,
  PluginSessionService,
  SessionSnapshot,
} from "@orahako/plugin-sdk"
import { PLUGIN_SERVICE_SCOPE, definePlugin } from "@orahako/plugin-sdk"
import type { AcademicProvider } from "@orahako/plugin-sdk/academic"
import { PluginRuntime } from "./runtime"
import { ProviderPluginRegistry } from "@/plugins/official/runtime/provider/registry"
import {
  ProviderRuntime,
  type ProviderCatalog,
} from "@/plugins/official/runtime/provider/runtime"
import { QueryRuntimeService } from "@/plugins/official/runtime/query"

/** Minimal localStorage so the real query cache has a deterministic backend. */
function memoryLocalStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key) => {
      entries.delete(key)
    },
    setItem: (key, value) => {
      entries.set(key, String(value))
    },
  }
}

/** Session contract with the state transitions the provider runtime relies on. */
class MemorySession implements PluginSessionService {
  private snapshotValue: SessionSnapshot = {
    activeSchoolId: null,
    credential: null,
    username: null,
    isAuthenticated: false,
    sessionExpired: false,
    hasHydrated: true,
    artifacts: {},
  }
  private readonly listeners = new Set<() => void>()

  getSnapshot = (): SessionSnapshot => this.snapshotValue

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setCredential(input: CredentialInput): void {
    this.update({
      activeSchoolId: input.schoolId,
      credential: input.credential,
      username: input.username ?? null,
      isAuthenticated: true,
      sessionExpired: false,
      artifacts: {},
    })
  }

  activateSchool(schoolId: string): void {
    this.update({
      activeSchoolId: schoolId,
      credential: null,
      username: null,
      isAuthenticated: false,
      sessionExpired: false,
      artifacts: {},
    })
  }

  clearCredential(schoolId?: string): void {
    if (schoolId && schoolId !== this.snapshotValue.activeSchoolId) return
    this.update({
      credential: null,
      username: null,
      isAuthenticated: false,
      sessionExpired: false,
      artifacts: {},
    })
  }

  setSessionExpired(expired: boolean): void {
    this.update({ sessionExpired: expired })
  }

  setArtifact(key: string, value: string | null): void {
    const artifacts = { ...this.snapshotValue.artifacts }
    if (value === null) delete artifacts[key]
    else artifacts[key] = value
    this.update({ artifacts })
  }

  getArtifact(key: string): string | null {
    return this.snapshotValue.artifacts[key] ?? null
  }

  createCookieJar(): never {
    throw new Error("Cookie jars are not used by this test")
  }

  async fetchWithJar(): Promise<never> {
    throw new Error("Cookie jars are not used by this test")
  }

  private update(patch: Partial<SessionSnapshot>): void {
    this.snapshotValue = { ...this.snapshotValue, ...patch }
    for (const listener of this.listeners) listener()
  }
}

interface TestProvider extends AcademicProvider {
  initializeCalls: number
  resetCalls: number
  logoutCalls: number
}

type ProviderDefinitionContext = PluginContext & {
  providers: {
    registerProvider(
      schoolId: string,
      factory: (ctx: PluginContext) => TestProvider
    ): () => void
  }
}

function createProvider(
  id: string,
  pluginContext: PluginContext,
  created: string[],
  instances: Map<string, TestProvider>
): TestProvider {
  const query = pluginContext.get("query") as PluginQueryService
  const session = pluginContext.get("session") as PluginSessionService
  const provider: TestProvider = {
    id,
    name: id,
    capabilities: {},
    initializeCalls: 0,
    resetCalls: 0,
    logoutCalls: 0,
    initialize: async () => {
      provider.initializeCalls += 1
    },
    reset: async () => {
      provider.resetCalls += 1
      query.clearPersistent()
      query.invalidate({ providerId: id })
    },
    logout: async () => {
      provider.logoutCalls += 1
      await provider.reset()
      session.clearCredential(id)
    },
    relogin: async () => true,
  } as unknown as TestProvider
  created.push(id)
  instances.set(`${id}:${provider.resetCalls}-${created.length}`, provider)
  return provider
}

interface Harness {
  runtime: PluginRuntime
  session: MemorySession
  query: QueryRuntimeService
  providers: ProviderPluginRegistry
  providerRuntime: ProviderRuntime
  instances: Map<string, TestProvider>
  created: string[]
  disposers: Map<string, () => void>
}

async function createHarness(): Promise<Harness> {
  const runtime = new PluginRuntime()
  const session = new MemorySession()
  const query = new QueryRuntimeService(runtime.context)
  const providers = new ProviderPluginRegistry()
  const instances = new Map<string, TestProvider>()
  const created: string[] = []
  const disposers = new Map<string, () => void>()

  runtime.context.set("session", session)
  runtime.context.set("query", query)
  runtime.context.set("providers", providers)

  const definition = definePlugin((ctx: ProviderDefinitionContext) => {
    for (const id of ["alpha", "beta"]) {
      disposers.set(
        id,
        ctx.providers.registerProvider(id, (providerContext) =>
          createProvider(id, providerContext, created, instances)
        )
      )
    }
  })
  runtime.register(
    {
      id: "test.schools",
      name: "Test schools",
      version: "1.0.0",
      apiVersion: 2,
      kind: "provider",
      entry: "index.js",
      inject: ["providers", "session", "query"],
    },
    definition,
    "builtin"
  )

  runtime.register(
    {
      id: "test.provider-runtime",
      name: "Provider runtime",
      version: "1.0.0",
      apiVersion: 2,
      kind: "runtime",
      entry: "index.js",
      inject: ["providers", "session"],
      provides: ["provider"],
    },
    definePlugin((ctx) => {
      const catalog = ctx.root.get("providers") as unknown as ProviderCatalog
      const providerRuntime = new ProviderRuntime({
        ctx,
        registry: catalog,
        session: ctx.get("session") as PluginSessionService,
      })
      ctx.set("provider", providerRuntime)
      ctx.on("dispose", () => providerRuntime.dispose())
    }),
    "builtin"
  )

  await runtime.startAndWait("test.provider-runtime")
  await runtime.startAndWait("test.schools")

  return {
    runtime,
    session,
    query,
    providers,
    providerRuntime: runtime.context.get("provider") as ProviderRuntime,
    instances,
    created,
    disposers,
  }
}

function latestInstance(harness: Harness, id: string): TestProvider {
  let found: TestProvider | undefined
  for (const provider of harness.instances.values()) {
    if (provider.id === id) found = provider
  }
  if (!found) throw new Error(`No provider instance for ${id}`)
  return found
}

/**
 * These tests compose the real provider contribution registry, provider
 * runtime and query runtime through Cordis. They only replace the provider
 * implementation and the session transport boundary.
 */
describe("cross-service school lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryLocalStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("switches schools, retires the old provider, and clears provider query state", async () => {
    const harness = await createHarness()
    try {
      harness.session.activateSchool("alpha")
      await harness.providerRuntime.initialize()
      const alpha = latestInstance(harness, "alpha")
      harness.query.writePersistent("provider|seed", { data: "alpha-data", updatedAt: 1 })
      expect(harness.query.readPersistent("provider|seed")).toMatchObject({
        data: "alpha-data",
      })

      const beta = harness.providerRuntime.selectSchool("beta") as TestProvider

      expect(alpha.resetCalls).toBe(1)
      expect(alpha.initializeCalls).toBe(1)
      expect(beta.id).toBe("beta")
      expect(harness.session.getSnapshot().activeSchoolId).toBe("beta")
      expect(harness.providerRuntime.getSnapshot()).toMatchObject({
        status: "initializing",
        schoolId: "beta",
        provider: beta,
      })
      expect(harness.query.readPersistent("provider|seed")).toBeNull()
      expect(harness.providers.hasProvider("alpha")).toBe(true)
      expect(harness.providers.hasProvider("beta")).toBe(true)
    } finally {
      harness.runtime.dispose()
    }
  })

  it("logs out through the provider, clearing session and query state", async () => {
    const harness = await createHarness()
    try {
      harness.session.setCredential({
        schoolId: "alpha",
        credential: "credential",
        username: "student",
      })
      await harness.providerRuntime.initialize()
      const alpha = latestInstance(harness, "alpha")
      harness.query.writePersistent("provider|seed", { data: "alpha-data", updatedAt: 1 })

      await harness.providerRuntime.logout()

      expect(alpha.logoutCalls).toBe(1)
      expect(alpha.resetCalls).toBe(1)
      expect(harness.session.getSnapshot()).toMatchObject({
        credential: null,
        username: null,
        isAuthenticated: false,
      })
      expect(harness.query.readPersistent("provider|seed")).toBeNull()
      expect(harness.providerRuntime.getSnapshot()).toMatchObject({
        status: "initializing",
        provider: alpha,
      })
    } finally {
      harness.runtime.dispose()
    }
  })

  it("never falls back to another school when the selected one is unavailable", () => {
    const runtime = new PluginRuntime()
    const session = new MemorySession()
    const instances = new Map<string, TestProvider>()
    const created: string[] = []
    const pluginContext = runtime.context as unknown as PluginContext
    const catalog: ProviderCatalog = {
      hasProvider: (schoolId) => schoolId === "alpha",
      createProvider: () => createProvider("alpha", pluginContext, created, instances),
      subscribe: () => () => {},
    }
    session.activateSchool("missing")
    const providerRuntime = new ProviderRuntime({
      ctx: runtime.context,
      registry: catalog,
      session,
      defaultSchoolId: "alpha",
    })

    expect(() => providerRuntime.getActive()).toThrow(
      "Unsupported school provider: missing"
    )
    expect(created).toEqual([])
    expect(providerRuntime.getSnapshot()).toMatchObject({
      status: "unavailable",
      schoolId: "missing",
      provider: null,
    })
    providerRuntime.dispose()
    runtime.dispose()
  })

  it("retires the active provider and stays unavailable when its school is removed", async () => {
    const harness = await createHarness()
    try {
      harness.session.activateSchool("alpha")
      await harness.providerRuntime.initialize()
      const alpha = latestInstance(harness, "alpha")

      harness.disposers.get("alpha")?.()

      expect(alpha.resetCalls).toBe(1)
      expect(harness.created.filter((id) => id === "beta")).toEqual([])
      expect(harness.providerRuntime.getSnapshot()).toMatchObject({
        status: "unavailable",
        schoolId: "alpha",
        provider: null,
      })
      expect(harness.providers.hasProvider("alpha")).toBe(false)
    } finally {
      harness.runtime.dispose()
    }
  })
})

function sessionFacadeLabel(value: unknown): string {
  if (value && typeof value === "object" && "school" in value) {
    return String(value.school)
  }
  return ""
}

describe("root service replacement", () => {
  it("recreates the service facade and restarts consumers without touching bystanders", async () => {
    const runtime = new PluginRuntime()
    const consumerRuns: string[] = []
    const bystanderRuns: string[] = []
    const consumerDisposes = vi.fn()
    const facades: Array<{ ctx: unknown; manifestId: string }> = []

    class ScopedSession {
      [PLUGIN_SERVICE_SCOPE](ctx: PluginContext, manifest: { id: string }) {
        facades.push({ ctx, manifestId: manifest.id })
        return { school: "first" }
      }
    }

    runtime.register(
      {
        id: "test.consumer",
        name: "Consumer",
        version: "1.0.0",
        apiVersion: 2,
        kind: "feature",
        entry: "index.js",
        inject: ["session"],
      },
      definePlugin((ctx) => {
        consumerRuns.push(sessionFacadeLabel(ctx.get("session")))
        ctx.on("dispose", consumerDisposes)
      }),
      "builtin"
    )
    runtime.register(
      {
        id: "test.bystander",
        name: "Bystander",
        version: "1.0.0",
        apiVersion: 2,
        kind: "feature",
        entry: "index.js",
        inject: ["providers"],
      },
      definePlugin(() => {
        bystanderRuns.push("run")
      }),
      "builtin"
    )

    const releaseSession = runtime.context.set("session", new ScopedSession())
    runtime.context.set("providers", { hasProvider: () => false })
    await runtime.startAndWait("test.consumer")
    await runtime.startAndWait("test.bystander")
    expect(consumerRuns).toEqual(["first"])
    expect(bystanderRuns).toEqual(["run"])
    expect(facades).toHaveLength(1)

    releaseSession()
    expect(consumerDisposes).toHaveBeenCalledOnce()
    runtime.context.set("session", new ScopedSession())
    expect(consumerRuns).toEqual(["first", "first"])
    expect(bystanderRuns).toEqual(["run"])
    expect(facades).toHaveLength(2)
    expect(facades[0].ctx).not.toBe(facades[1].ctx)
    expect(facades[0].manifestId).toBe("test.consumer")
    expect(facades[1].manifestId).toBe("test.consumer")

    runtime.dispose()
  })
})
