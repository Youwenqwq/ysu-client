import { describe, expect, it, vi, type Mock } from "vitest"
import {
  defineSchoolProvider,
  ProviderErrorCode,
  type ProviderRuntimeSnapshot,
  type SchoolProvider,
  type SessionService,
  type SessionSnapshot,
} from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { Context, createObservableSource } from "@orahako/sdk"
import {
  ProviderPluginRegistry,
  ProviderRuntime,
  providerRegistryRuntimePlugin,
  providerRuntimePlugin,
} from "../src"

type ControllableProvider = SchoolProvider & {
  initialize: Mock<() => Promise<void>>
  reset: Mock<() => Promise<void>>
  logout: Mock<() => Promise<void>>
  dispose: Mock<() => Promise<void>>
  relogin: Mock<() => Promise<boolean>>
}

function makeProvider(id: string, name = id): ControllableProvider {
  const initialize = vi.fn(async () => {})
  const reset = vi.fn(async () => {})
  const logout = vi.fn(async () => {})
  const dispose = vi.fn(async () => {})
  const relogin = vi.fn(async () => true)

  const base = defineSchoolProvider({
    id,
    name,
    slices: {},
    initialize,
    reset,
    logout,
    dispose,
    relogin,
  })
  return { ...base, initialize, reset, logout, dispose, relogin }
}

function makeMockSession(initialSchoolId: string | null = null): SessionService {
  const state = createObservableSource<SessionSnapshot>({
    activeSchoolId: initialSchoolId,
    credential: initialSchoolId ? "cred" : null,
    username: initialSchoolId ? "user1" : null,
    isAuthenticated: Boolean(initialSchoolId),
    sessionExpired: true,
    hasHydrated: true,
    artifacts: {},
  })

  return {
    state,
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    setCredential: vi.fn((input) => {
      state.set((prev) => ({
        ...prev,
        activeSchoolId: input.schoolId,
        credential: input.credential,
        username: input.username ?? null,
        isAuthenticated: true,
        sessionExpired: false,
      }))
    }),
    activateSchool: vi.fn((schoolId: string) => {
      state.set((prev) => ({ ...prev, activeSchoolId: schoolId, sessionExpired: false }))
    }),
    clearCredential: vi.fn(),
    setSessionExpired: vi.fn((expired: boolean) => {
      state.set((prev) => ({ ...prev, sessionExpired: expired }))
    }),
    setArtifact: vi.fn(),
    getArtifact: () => null,
    createCookieJar: vi.fn(),
    fetchWithJar: vi.fn(),
  }
}

describe("ProviderRuntime & providerRuntimePlugin", () => {
  it("fails closed without falling back to other schools when selection is missing or unregistered", () => {
    const registry = new ProviderPluginRegistry()
    registry.registerProvider("other", () => makeProvider("other"))
    const session = makeMockSession(null)
    const runtime = new ProviderRuntime({
      ctx: new Context(),
      registry,
      session,
    })

    expect(() => runtime.getActive()).toThrow("No school provider is selected")
    expect(runtime.getSnapshot().status).toBe("unavailable")

    expect(() => runtime.selectSchool("missing")).toThrow("Unsupported school provider: missing")
    expect(runtime.getSnapshot()).toMatchObject({
      status: "unavailable",
      schoolId: "missing",
      provider: null,
    })

    expect(() => runtime.selectSchool("")).toThrow("school id is required")
    runtime.dispose()
  })

  it("reuses in-flight initialization per generation and emits provider/changed + provider/ready", async () => {
    const ctx = new Context()
    const registry = new ProviderPluginRegistry()
    const ysu = makeProvider("ysu")
    const gate = Promise.withResolvers<void>()
    ysu.initialize.mockReturnValue(gate.promise)
    registry.registerProvider("ysu", () => ysu)

    const changed: ProviderRuntimeSnapshot[] = []
    const ready: ProviderRuntimeSnapshot[] = []
    ctx.on("provider/changed", (snap) => changed.push(snap))
    ctx.on("provider/ready", (snap) => ready.push(snap))

    const session = makeMockSession(null)
    const runtime = new ProviderRuntime({
      ctx,
      registry,
      session,
      defaultSchoolId: "ysu",
    })

    const p1 = runtime.initialize()
    const p2 = runtime.initialize()
    expect(p1).toBe(p2)
    expect(ysu.initialize).toHaveBeenCalledTimes(1)
    expect(session.activateSchool).toHaveBeenCalledWith("ysu")
    expect(runtime.getSnapshot().status).toBe("initializing")

    gate.resolve()
    await expect(p1).resolves.toBe(ysu)
    expect(runtime.getSnapshot()).toMatchObject({
      status: "ready",
      schoolId: "ysu",
      provider: ysu,
      generation: 1,
    })
    expect(ready).toHaveLength(1)
    expect(changed.map((s) => s.status)).toContain("ready")

    // Calling initialize() when already ready returns cached provider immediately
    await expect(runtime.initialize()).resolves.toBe(ysu)
    expect(ysu.initialize).toHaveBeenCalledTimes(1)

    runtime.dispose()
  })

  it("waits for the retired provider's async dispose before initializing its replacement", async () => {
    const registry = new ProviderPluginRegistry()
    const ysu = makeProvider("ysu")
    const zmu = makeProvider("zmu")
    const disposeGate = Promise.withResolvers<void>()
    ysu.dispose.mockReturnValueOnce(disposeGate.promise)
    registry.registerProvider("ysu", () => ysu)
    registry.registerProvider("zmu", () => zmu)

    const session = makeMockSession("ysu")
    const runtime = new ProviderRuntime({ ctx: new Context(), registry, session })

    await runtime.initialize()
    expect(runtime.getSnapshot().status).toBe("ready")

    expect(runtime.selectSchool("zmu")).toBe(zmu)
    const replacementInit = runtime.initialize()

    // The replacement must not touch provider state while the old instance is
    // still disposing; user-facing reset/logout paths must not be reused.
    expect(zmu.initialize).not.toHaveBeenCalled()
    expect(ysu.reset).not.toHaveBeenCalled()
    expect(ysu.logout).not.toHaveBeenCalled()

    disposeGate.resolve()
    await expect(replacementInit).resolves.toBe(zmu)
    expect(ysu.dispose).toHaveBeenCalledTimes(1)
    expect(zmu.initialize).toHaveBeenCalledTimes(1)
    expect(runtime.getSnapshot()).toMatchObject({ status: "ready", provider: zmu })

    runtime.dispose()
  })

  it("keeps the current ready provider untouched when a school switch factory fails", async () => {
    const registry = new ProviderPluginRegistry()
    const ysu = makeProvider("ysu")
    registry.registerProvider("ysu", () => ysu)
    registry.registerProvider("zmu", () => {
      throw new Error("zmu factory failed")
    })

    const session = makeMockSession("ysu")
    const runtime = new ProviderRuntime({ ctx: new Context(), registry, session })

    const provider = runtime.selectSchool("ysu")
    await runtime.initialize()
    expect(provider).toBe(ysu)
    expect(runtime.getSnapshot()).toMatchObject({ status: "ready", provider: ysu })

    expect(() => runtime.selectSchool("zmu")).toThrow("zmu factory failed")
    expect(runtime.getSnapshot()).toMatchObject({
      status: "ready",
      schoolId: "ysu",
      provider: ysu,
    })
    expect(ysu.dispose).not.toHaveBeenCalled()

    await expect(runtime.initialize()).resolves.toBe(ysu)
    runtime.dispose()
  })

  it("guards generation races across reset, school switch, logout, and relogin", async () => {
    const ctx = new Context()
    const registry = new ProviderPluginRegistry()
    const ysu = makeProvider("ysu")
    const zmu = makeProvider("zmu")
    registry.registerProvider("ysu", () => ysu)
    registry.registerProvider("zmu", () => zmu)

    const session = makeMockSession("ysu")
    const runtime = new ProviderRuntime({ ctx, registry, session })

    // 1. Stale initialize superseded by school switch
    const initGate1 = Promise.withResolvers<void>()
    ysu.initialize.mockReturnValueOnce(initGate1.promise)
    const staleInit = runtime.initialize()
    const staleReject = expect(staleInit).rejects.toMatchObject({
      code: ProviderErrorCode.UNKNOWN,
      status: 409,
    })

    expect(runtime.selectSchool("zmu")).toBe(zmu)
    await vi.waitFor(() => expect(ysu.dispose).toHaveBeenCalledTimes(1))
    expect(ysu.reset).not.toHaveBeenCalled()
    initGate1.resolve()
    await staleReject
    expect(runtime.getSnapshot().schoolId).toBe("zmu")
    expect(runtime.getSnapshot().status).toBe("initializing")

    // 2. Initialize zmu to ready
    await runtime.initialize()
    expect(runtime.getSnapshot().status).toBe("ready")

    // 3. Stale relogin superseded by logout must return false and NOT clear sessionExpired
    session.setSessionExpired(true)
    const reloginGate = Promise.withResolvers<boolean>()
    zmu.relogin.mockReturnValueOnce(reloginGate.promise)
    const reloginPromise = runtime.relogin()
    await runtime.logout()
    expect(zmu.logout).toHaveBeenCalledTimes(1)
    reloginGate.resolve(true)
    await expect(reloginPromise).resolves.toBe(false)

    // 4. Valid relogin clears sessionExpired
    await runtime.initialize()
    session.setSessionExpired(true)
    zmu.relogin.mockResolvedValueOnce(true)
    await expect(runtime.relogin()).resolves.toBe(true)
    expect(session.setSessionExpired).toHaveBeenLastCalledWith(false)

    runtime.dispose()
  })

  it("reacts to providers.subscribe when active school's provider plugin loads, reloads, or unloads", async () => {
    const kernel = new PluginRuntime()
    const session = makeMockSession("ysu")
    kernel.context.set("session", session)
    kernel.register(providerRegistryRuntimePlugin, "builtin")
    kernel.register(providerRuntimePlugin, "builtin", { defaultSchoolId: "ysu" })

    await kernel.startAndWait(providerRegistryRuntimePlugin.manifest.id)
    await kernel.startAndWait(providerRuntimePlugin.manifest.id)

    const providers = kernel.context.get("providers")!
    const providerRuntime = kernel.context.get("provider")!

    // Initially "ysu" is not registered -> selectSchool marks unavailable for "ysu"
    expect(() => providerRuntime.selectSchool("ysu")).toThrow("Unsupported school provider: ysu")
    expect(providerRuntime.getSnapshot()).toMatchObject({
      status: "unavailable",
      schoolId: "ysu",
      provider: null,
    })

    // Dynamically registering "ysu" activates v1 in initializing state
    const ysuV1 = makeProvider("ysu", "YSU v1")
    const disposeV1 = providers.registerProvider("ysu", () => ysuV1)
    expect(providerRuntime.getSnapshot()).toMatchObject({
      status: "initializing",
      schoolId: "ysu",
      provider: ysuV1,
    })
    await providerRuntime.initialize()
    expect(providerRuntime.getSnapshot().status).toBe("ready")

    // Hot-reloading "ysu" with v2 retires v1, bumps generation, and mounts v2
    const genBefore = providerRuntime.getSnapshot().generation
    const ysuV2 = makeProvider("ysu", "YSU v2")
    const disposeV2 = providers.registerProvider("ysu", () => ysuV2)
    await vi.waitFor(() => expect(ysuV1.dispose).toHaveBeenCalledTimes(1))
    expect(ysuV1.reset).not.toHaveBeenCalled()
    expect(ysuV1.logout).not.toHaveBeenCalled()
    expect(providerRuntime.getSnapshot().generation).toBeGreaterThan(genBefore)
    expect(providerRuntime.getSnapshot().provider).toBe(ysuV2)
    expect(providerRuntime.getSnapshot().status).toBe("initializing")

    disposeV1() // Stale disposer does nothing
    expect(providerRuntime.getSnapshot().provider).toBe(ysuV2)

    // Unloading v2 transitions runtime back to unavailable
    disposeV2()
    await vi.waitFor(() => expect(ysuV2.dispose).toHaveBeenCalledTimes(1))
    expect(ysuV2.reset).not.toHaveBeenCalled()
    expect(providerRuntime.getSnapshot()).toMatchObject({
      status: "unavailable",
      schoolId: "ysu",
      provider: null,
    })

    kernel.dispose()
  })
})
