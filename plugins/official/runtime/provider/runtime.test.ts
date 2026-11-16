import { describe, expect, it, vi, type Mock } from "vitest"
import { Context } from "@cordisjs/core"
import type {
  ManagedProvider,
  PluginSessionService,
  SessionSnapshot,
} from "@orahako/plugin-sdk"
import { ProviderRuntime, type ProviderCatalog } from "./runtime"

function provider(_id: string): ManagedProvider & { initialize: Mock<() => Promise<void>> } {
  return {
    initialize: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    relogin: vi.fn(async () => true),
  } as unknown as ManagedProvider & { initialize: Mock<() => Promise<void>> }
}

function session(schoolId: string | null = null): PluginSessionService {
  let snapshot: SessionSnapshot = {
    activeSchoolId: schoolId,
    credential: null,
    username: null,
    isAuthenticated: false,
    sessionExpired: true,
    hasHydrated: true,
    artifacts: {},
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    setCredential: vi.fn(),
    activateSchool: vi.fn((next: string) => {
      snapshot = { ...snapshot, activeSchoolId: next }
    }),
    clearCredential: vi.fn(),
    setSessionExpired: vi.fn(),
    setArtifact: vi.fn(),
    getArtifact: () => null,
    createCookieJar: vi.fn(),
    fetchWithJar: vi.fn(),
  }
}

function catalog(providers: Record<string, ManagedProvider>): ProviderCatalog {
  const listeners = new Set<(schoolId: string) => void>()
  return {
    hasProvider: (id) => id in providers,
    createProvider: (id) => providers[id]!,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

describe("ProviderRuntime", () => {
  it("fails closed when neither the session nor composition selects a provider", () => {
    const runtime = new ProviderRuntime({
      ctx: new Context(),
      registry: catalog({}),
      session: session(),
    })
    expect(() => runtime.getActive()).toThrow("No school provider is selected")
    expect(runtime.getSnapshot().status).toBe("unavailable")
    runtime.dispose()
  })

  it("activates exactly the selected school and publishes ready", async () => {
    const selected = provider("test-school")
    const auth = session()
    const runtime = new ProviderRuntime({
      ctx: new Context(),
      registry: catalog({ "test-school": selected, "other-school": provider("other-school") }),
      session: auth,
      defaultSchoolId: "test-school",
    })
    await expect(runtime.initialize()).resolves.toBe(selected)
    expect(auth.activateSchool).toHaveBeenCalledWith("test-school")
    expect(runtime.getSnapshot()).toMatchObject({ status: "ready", schoolId: "test-school" })
    runtime.dispose()
  })

  it("retires the previous provider when switching schools", async () => {
    const first = provider("first")
    const second = provider("second")
    const runtime = new ProviderRuntime({
      ctx: new Context(),
      registry: catalog({ first, second }),
      session: session(),
      defaultSchoolId: "first",
    })
    await runtime.initialize()
    expect(runtime.selectSchool("second")).toBe(second)
    expect(first.reset).toHaveBeenCalledOnce()
    runtime.dispose()
    expect(second.reset).toHaveBeenCalledOnce()
  })

  it("rejects stale initialization after reset instead of publishing ready", async () => {
    const selected = provider("test-school")
    const pending = Promise.withResolvers<void>()
    selected.initialize.mockReturnValue(pending.promise)
    const runtime = new ProviderRuntime({
      ctx: new Context(),
      registry: catalog({ "test-school": selected }),
      session: session(),
      defaultSchoolId: "test-school",
    })
    const initialization = runtime.initialize()
    const expectation = expect(initialization).rejects.toThrow("superseded")
    await runtime.reset()
    pending.resolve()
    await expectation
    expect(runtime.getSnapshot().status).not.toBe("ready")
    runtime.dispose()
  })
})
