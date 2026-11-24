import { afterEach, describe, expect, it, vi } from "vitest"
import {
  defineSchoolProvider,
  isProviderError,
  ProviderError,
  ProviderErrorCode,
  requireSlice,
  type AcademicSliceMap,
  type Exam,
  type Grade,
  type ProviderRuntimeService,
  type ProviderRuntimeSnapshot,
  type ProviderQueryPolicy,
  type QuerySnapshot,
  type SchoolProvider,
  type SessionService,
  type SessionSnapshot,
} from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import {
  Context,
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  type ObservableSource,
  type PluginKeyValueStorage,
  type PluginStorageService,
} from "@orahako/sdk"
import {
  DEFAULT_TTL_MS,
  QueryRuntimeService,
  queryRuntimePlugin,
} from "../src"

function createTrackedStorage() {
  const localMap = new Map<string, string>()
  const secureMap = new Map<string, string>()
  const wrap = (map: Map<string, string>): PluginKeyValueStorage => ({
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v)
    },
    removeItem: async (k) => {
      map.delete(k)
    },
  })
  const storage: PluginStorageService = {
    local: wrap(localMap),
    secure: wrap(secureMap),
  }
  return { storage, localMap, secureMap }
}

function makeProvider(id: string, slices: Partial<AcademicSliceMap> = {}): SchoolProvider {
  return defineSchoolProvider({
    id,
    name: id,
    slices,
    initialize: async () => {},
    reset: async () => {},
    logout: async () => {},
    relogin: async () => true,
  })
}

function createQueryTestRig(options?: {
  schoolId?: string | null
  provider?: SchoolProvider | null
  status?: ProviderRuntimeSnapshot["status"]
  username?: string | null
  isAuthenticated?: boolean
  storage?: PluginStorageService
  policies?: Readonly<Record<string, ProviderQueryPolicy>>
}) {
  const ctx = new Context()
  const { storage, localMap } = options?.storage
    ? { storage: options.storage, localMap: new Map<string, string>() }
    : createTrackedStorage()

  let providerListeners = 0
  const rawProviderState = createObservableSource<ProviderRuntimeSnapshot>({
    status: options?.status ?? (options?.provider ? "ready" : "unavailable"),
    schoolId: options?.schoolId ?? options?.provider?.id ?? null,
    provider: options?.provider ?? null,
    error: null,
    generation: options?.provider ? 1 : 0,
  })
  const providerService: ProviderRuntimeService = {
    state: {
      getSnapshot: rawProviderState.getSnapshot,
      subscribe: (listener) => {
        providerListeners += 1
        const unsub = rawProviderState.subscribe(listener)
        return () => {
          providerListeners -= 1
          unsub()
        }
      },
    },
    getSnapshot: rawProviderState.getSnapshot,
    subscribe: rawProviderState.subscribe,
    getActive: () => {
      const p = rawProviderState.getSnapshot().provider
      if (!p) throw new Error("unavailable")
      return p
    },
    selectSchool: () => {
      throw new Error("unused")
    },
    initialize: async () => {
      throw new Error("unused")
    },
    reset: async () => {},
    logout: async () => {},
    relogin: async () => false,
  }

  let sessionListeners = 0
  const rawSessionState = createObservableSource<SessionSnapshot>({
    activeSchoolId: options?.schoolId ?? options?.provider?.id ?? null,
    credential: options?.isAuthenticated === false ? null : "cred-token",
    username: options?.username === undefined ? "202201" : options.username,
    isAuthenticated: options?.isAuthenticated ?? true,
    sessionExpired: false,
    hasHydrated: true,
    artifacts: {},
  })
  const sessionService: SessionService = {
    state: {
      getSnapshot: rawSessionState.getSnapshot,
      subscribe: (listener) => {
        sessionListeners += 1
        const unsub = rawSessionState.subscribe(listener)
        return () => {
          sessionListeners -= 1
          unsub()
        }
      },
    },
    getSnapshot: rawSessionState.getSnapshot,
    subscribe: rawSessionState.subscribe,
    setCredential: vi.fn(),
    activateSchool: vi.fn(),
    clearCredential: vi.fn(),
    setSessionExpired: vi.fn((expired: boolean) => {
      rawSessionState.set((prev) => ({ ...prev, sessionExpired: expired }))
    }),
    setArtifact: vi.fn(),
    getArtifact: () => null,
    createCookieJar: vi.fn(),
    fetchWithJar: vi.fn(),
  }

  const query = new QueryRuntimeService({
    ctx,
    provider: providerService,
    session: sessionService,
    storage,
    policies: options?.policies,
  })

  return {
    ctx,
    storage,
    localMap,
    query,
    providerService,
    providerState: rawProviderState,
    sessionState: rawSessionState,
    sessionService,
    getListenerCounts: () => ({ providerListeners, sessionListeners }),
  }
}

const SAMPLE_GRADE: Grade = {
  courseName: "编译原理",
  courseCode: "CS301",
  credit: "4",
  numericCredit: 4,
  score: "95",
  gradePoint: "4.0",
  semester: "2025-2026-1",
  isMajor: true,
  isPass: true,
  isValid: true,
  isDegreeCourse: true,
}

afterEach(() => {
  vi.useRealTimers()
})

describe("QueryRuntimeService & queryRuntimePlugin", () => {
  it("ships only the generic default policy and manages LIFO overrides with revocation on plugin dispose", async () => {
    const { storage } = createTrackedStorage()
    const freshRig = createQueryTestRig({ storage })
    const genericPolicy = { ttl: DEFAULT_TTL_MS, persist: false }
    expect(freshRig.query.policy("grades")).toEqual(genericPolicy)
    expect(freshRig.query.policy("schedule")).toEqual(genericPolicy)
    expect(freshRig.query.policy("ecard")).toEqual(genericPolicy)
    freshRig.query.dispose()

    const runtime = new PluginRuntime()
    runtime.context.set("provider", {
      state: freshRig.providerState,
      getSnapshot: freshRig.providerState.getSnapshot,
      subscribe: freshRig.providerState.subscribe,
      getActive: () => {
        throw new Error("unused")
      },
      selectSchool: () => {
        throw new Error("unused")
      },
      initialize: async () => {
        throw new Error("unused")
      },
      reset: async () => {},
      logout: async () => {},
      relogin: async () => false,
    })
    runtime.context.set("session", freshRig.sessionService)
    runtime.context.set("storage", storage)

    runtime.register(queryRuntimePlugin, "builtin", {
      policies: { schedule: { ttl: 2_000, persist: true } },
    })
    await runtime.startAndWait(queryRuntimePlugin.manifest.id)
    const rootQuery = runtime.context.get("query")!
    expect(rootQuery.policy("grades")).toEqual(genericPolicy)
    expect(rootQuery.policy("schedule")).toEqual({ ttl: 2_000, persist: true })

    const overrideA = definePlugin({
      manifest: {
        id: "plugin.override-a",
        name: "Override A",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["query"],
      apply(ctx) {
        ctx.query.registerPolicy("grades", { ttl: 5_000, persist: true })
      },
    })

    const overrideB = definePlugin({
      manifest: {
        id: "plugin.override-b",
        name: "Override B",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["query"],
      apply(ctx) {
        ctx.query.registerPolicy("grades", { ttl: 1_000, persist: false })
      },
    })

    runtime.register(overrideA, "builtin")
    runtime.register(overrideB, "builtin")
    await runtime.startAndWait(overrideA.manifest.id)
    expect(rootQuery.policy("grades")).toEqual({ ttl: 5_000, persist: true })

    await runtime.startAndWait(overrideB.manifest.id)
    expect(rootQuery.policy("grades")).toEqual({ ttl: 1_000, persist: false })

    // Stopping top-of-stack B restores A's policy; stopping A restores default
    runtime.stop(overrideB.manifest.id)
    expect(rootQuery.policy("grades")).toEqual({ ttl: 5_000, persist: true })
    runtime.stop(overrideA.manifest.id)
    expect(rootQuery.policy("grades")).toEqual(genericPolicy)

    runtime.dispose()
  })

  it("returns reference-stable ObservableSources and immediately publishes FEATURE_NOT_SUPPORTED when slice is missing", () => {
    const providerWithoutExams = makeProvider("ysu", {
      grades: {
        getGrades: async () => [SAMPLE_GRADE],
      },
    })
    const { query } = createQueryTestRig({ provider: providerWithoutExams })

    const s1 = query.source({
      feature: "grades",
      slice: "grades",
      params: { semester: "1", extra: [1, 2] },
      fetcher: (p) => requireSlice(p, "grades").getGrades(),
    })
    const s2 = query.source({
      feature: "grades",
      slice: "grades",
      params: { extra: [1, 2], semester: "1" }, // key-sorted stableStringify match!
      fetcher: (p) => requireSlice(p, "grades").getGrades(),
    })
    expect(s1).toBe(s2)
    expect(s1.getSnapshot()).toBe(s1.getSnapshot())

    const fetcherSpy = vi.fn(async () => [])
    const unsupportedSource = query.source({
      feature: "exams",
      slice: "exams",
      fetcher: fetcherSpy,
    })

    const snap = unsupportedSource.getSnapshot()
    expect(snap.status).toBe("error")
    expect(isProviderError(snap.error)).toBe(true)
    if (isProviderError(snap.error)) {
      expect(snap.error.code).toBe(ProviderErrorCode.FEATURE_NOT_SUPPORTED)
    }
    expect(fetcherSpy).not.toHaveBeenCalled()

    const unsub = unsupportedSource.subscribe(() => {})
    expect(fetcherSpy).not.toHaveBeenCalled()
    unsub()
    query.dispose()
  })

  it("releases transient query records and ignores late results", async () => {
    const first = Promise.withResolvers<string[]>()
    const second = Promise.withResolvers<string[]>()
    const { query } = createQueryTestRig({ provider: makeProvider("ysu") })
    await query.hydrated
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const descriptor = {
      feature: "test-room-search",
      params: { name: "301" },
      releaseOnInactive: true,
      fetcher,
    }
    const source = query.source<string[]>(descriptor)
    const stop = source.subscribe(() => {})
    expect(fetcher).toHaveBeenCalledTimes(1)
    stop()
    const nextSource = query.source<string[]>(descriptor)
    expect(nextSource).not.toBe(source)
    const stopNext = nextSource.subscribe(() => {})
    expect(fetcher).toHaveBeenCalledTimes(2)
    second.resolve(["new"])
    first.resolve(["old"])
    await vi.waitFor(() => expect(nextSource.getSnapshot().data).toEqual(["new"]))
    stopNext()
    query.dispose()
  })

  it("releases transient search records after the last subscriber and ignores late results", async () => {
    const first = Promise.withResolvers<string[]>()
    const second = Promise.withResolvers<string[]>()
    const { query, getListenerCounts } = createQueryTestRig({ provider: makeProvider("ysu") })
    await query.hydrated
    const descriptor = {
      feature: "test-room-search",
      params: { name: "301" },
      releaseOnInactive: true,
      fetcher: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    }
    const source = query.source<string[]>(descriptor)
    const stopFirst = source.subscribe(() => {})
    const stopSecond = source.subscribe(() => {})
    expect(descriptor.fetcher).toHaveBeenCalledTimes(1)
    stopFirst()
    expect(query.source<string[]>(descriptor)).toBe(source)
    stopSecond()
    expect(getListenerCounts()).toEqual({ providerListeners: 0, sessionListeners: 0 })

    const rebound = query.source<string[]>(descriptor)
    expect(rebound).not.toBe(source)
    expect(rebound.getSnapshot().status).toBe("idle")
    const stopRebound = rebound.subscribe(() => {})
    expect(descriptor.fetcher).toHaveBeenCalledTimes(2)
    second.resolve(["new"])
    first.resolve(["old"])
    await vi.waitFor(() => expect(rebound.getSnapshot().data).toEqual(["new"]))
    stopRebound()
    expect(query.source<string[]>(descriptor).getSnapshot().status).toBe("idle")
    query.dispose()
  })

  it("deduplicates transient sources created before either source subscribes", async () => {
    const { query } = createQueryTestRig({ provider: makeProvider("ysu") })
    await query.hydrated
    const descriptor = {
      feature: "test-room-search",
      params: { name: "301" },
      releaseOnInactive: true,
      fetcher: vi.fn(async () => [] as string[]),
    }
    const first = query.source<string[]>(descriptor)
    const second = query.source<string[]>(descriptor)
    expect(second).not.toBe(first)

    const stopFirst = first.subscribe(() => {})
    const stopSecond = second.subscribe(() => {})
    expect(descriptor.fetcher).toHaveBeenCalledTimes(1)
    stopFirst()
    expect(query.source<string[]>(descriptor)).toBe(second)
    stopSecond()
    expect(query.source<string[]>(descriptor)).not.toBe(second)
    query.dispose()
  })

  it("deduplicates concurrent fetches, tracks upstream listeners only while active, and selectively invalidates", async () => {
    const gate = Promise.withResolvers<Grade[]>()
    const getGrades = vi.fn(() => gate.promise)
    const getExams = vi.fn(
      async (): Promise<Exam[]> => [{ name: "OS", startAt: "2026-01-10T09:00:00" }]
    )

    const ysu = makeProvider("ysu", {
      grades: { getGrades },
      exams: { getExams },
    })
    const { query, getListenerCounts } = createQueryTestRig({ provider: ysu })
    await query.hydrated

    expect(getListenerCounts()).toEqual({ providerListeners: 0, sessionListeners: 0 })

    const gradesA = query.source({
      feature: "grades",
      slice: "grades",
      params: { term: "1" },
      fetcher: (p) => requireSlice(p, "grades").getGrades(),
    })
    const gradesB = query.source({
      feature: "grades",
      slice: "grades",
      params: { term: "1" },
      fetcher: (p) => requireSlice(p, "grades").getGrades(),
    })
    const examsSource = query.source({
      feature: "exams",
      slice: "exams",
      fetcher: () => getExams(),
    })

    const unsubA = gradesA.subscribe(() => {})
    const unsubB = gradesB.subscribe(() => {})
    const unsubExams = examsSource.subscribe(() => {})
    const manualPromise = gradesA.getSnapshot().refresh()

    // Upstream subscriptions attached while holders > 0
    expect(getListenerCounts()).toEqual({ providerListeners: 1, sessionListeners: 1 })
    expect(gradesA.getSnapshot().status).toBe("loading")
    expect(gradesA.getSnapshot().isLoading).toBe(true)
    expect(getGrades).toHaveBeenCalledTimes(1)

    gate.resolve([SAMPLE_GRADE])
    await manualPromise
    await vi.waitFor(() => {
      expect(gradesA.getSnapshot().status).toBe("success")
      expect(examsSource.getSnapshot().status).toBe("success")
    })
    expect(gradesA.getSnapshot().data).toEqual([SAMPLE_GRADE])
    expect(getGrades).toHaveBeenCalledTimes(1)
    expect(getExams).toHaveBeenCalledTimes(1)

    // Selective invalidation on feature: "grades" revalidates grades ONLY, leaving exams untouched
    const updatedGrade: Grade = { ...SAMPLE_GRADE, score: "99" }
    getGrades.mockResolvedValueOnce([updatedGrade])
    query.invalidate({ feature: "grades" })

    await vi.waitFor(() => {
      expect(gradesA.getSnapshot().data).toEqual([updatedGrade])
    })
    expect(getGrades).toHaveBeenCalledTimes(2)
    expect(getExams).toHaveBeenCalledTimes(1)

    // Unsubscribing all sources detaches upstream provider & session listeners
    unsubA()
    unsubB()
    unsubExams()
    expect(getListenerCounts()).toEqual({ providerListeners: 0, sessionListeners: 0 })

    query.dispose()
  })

  it("hydrates persistent cache across restarts, serves fresh cache without network, and revalidates expired cache with activity counts", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-18T08:00:00Z"))

    const { storage } = createTrackedStorage()
    const ysu = makeProvider("ysu", {
      grades: { getGrades: async () => [SAMPLE_GRADE] },
    })
    const policies = { grades: { ttl: DEFAULT_TTL_MS, persist: true } }

    // First session writes persistent cache
    const rig1 = createQueryTestRig({ provider: ysu, storage, policies })
    await rig1.query.hydrated
    const src1 = rig1.query.source({
      feature: "grades",
      slice: "grades",
      fetcher: (p) => requireSlice(p, "grades").getGrades(),
    })
    const unsub1 = src1.subscribe(() => {})
    await vi.waitFor(() => expect(src1.getSnapshot().status).toBe("success"))
    unsub1()
    rig1.query.dispose()

    // Cold-start 1 hour later (within 24h TTL): serves cached data immediately WITHOUT calling fetcher!
    vi.advanceTimersByTime(60 * 60 * 1000)
    const coldFetcher = vi.fn(async () => [{ ...SAMPLE_GRADE, score: "100" }])
    const rig2 = createQueryTestRig({ provider: ysu, storage, policies })
    await rig2.query.hydrated

    const src2 = rig2.query.source({
      feature: "grades",
      slice: "grades",
      fetcher: coldFetcher,
    })
    expect(src2.getSnapshot()).toMatchObject({
      status: "success",
      data: [SAMPLE_GRADE],
      isStale: false,
      isRefreshing: false,
    })
    const unsub2 = src2.subscribe(() => {})
    expect(coldFetcher).not.toHaveBeenCalled()
    expect(rig2.query.activity.getSnapshot()).toEqual({ refreshingCount: 0, staleCount: 0 })
    unsub2()
    rig2.query.dispose()

    // Cold-start 25 hours later (expired > 24h TTL): serves stale cached data immediately while revalidating!
    vi.advanceTimersByTime(25 * 60 * 60 * 1000)
    const revalidateGate = Promise.withResolvers<Grade[]>()
    const expiredFetcher = vi.fn(() => revalidateGate.promise)
    const rig3 = createQueryTestRig({ provider: ysu, storage, policies })
    await rig3.query.hydrated

    const src3 = rig3.query.source({
      feature: "grades",
      slice: "grades",
      fetcher: expiredFetcher,
    })
    // Before subscribing: cached data already visible and marked stale
    expect(src3.getSnapshot()).toMatchObject({
      status: "success",
      data: [SAMPLE_GRADE],
      isStale: true,
      isRefreshing: false,
    })

    const unsub3 = src3.subscribe(() => {})
    // Subscribing triggers background revalidation while keeping cached data visible!
    expect(expiredFetcher).toHaveBeenCalledTimes(1)
    expect(src3.getSnapshot()).toMatchObject({
      status: "success",
      data: [SAMPLE_GRADE],
      isStale: true,
      isRefreshing: true,
      isLoading: false,
    })
    expect(rig3.query.activity.getSnapshot()).toEqual({ refreshingCount: 1, staleCount: 1 })

    const freshGrades: Grade[] = [{ ...SAMPLE_GRADE, score: "98" }]
    revalidateGate.resolve(freshGrades)
    await vi.waitFor(() => {
      expect(src3.getSnapshot().isRefreshing).toBe(false)
    })

    expect(src3.getSnapshot()).toMatchObject({
      status: "success",
      data: freshGrades,
      isStale: false,
      isRefreshing: false,
      error: null,
    })
    expect(rig3.query.activity.getSnapshot()).toEqual({ refreshingCount: 0, staleCount: 0 })

    unsub3()
    rig3.query.dispose()
  })

  it("marks sessionExpired on AUTH_SESSION_EXPIRED when authenticated, falls back to stale cache when present, and errors otherwise", async () => {
    const { storage } = createTrackedStorage()
    const ysu = makeProvider("ysu", {
      grades: { getGrades: async () => [SAMPLE_GRADE] },
      ecard: {
        fetchBalance: async () => ({ ready: true, balance: null }),
      },
    })

    const rig = createQueryTestRig({
      provider: ysu,
      storage,
      isAuthenticated: true,
      policies: { grades: { ttl: DEFAULT_TTL_MS, persist: true } },
    })
    await rig.query.hydrated

    // 1. Seed persistent cache for "grades"
    let shouldExpire = false
    const gradesSource = rig.query.source({
      feature: "grades",
      slice: "grades",
      fetcher: async () => {
        if (shouldExpire) {
          throw new ProviderError(
            ProviderErrorCode.AUTH_SESSION_EXPIRED,
            "JWXT session expired",
            undefined,
            401
          )
        }
        return [SAMPLE_GRADE]
      },
    })

    const unsubGrades = gradesSource.subscribe(() => {})
    await vi.waitFor(() => expect(gradesSource.getSnapshot().status).toBe("success"))
    expect(rig.sessionService.setSessionExpired).not.toHaveBeenCalled()

    // 2. Next revalidation throws AUTH_SESSION_EXPIRED -> marks sessionExpired(true) AND keeps persistent fallback with isStale: true!
    shouldExpire = true
    await gradesSource.getSnapshot().refresh()

    expect(rig.sessionService.setSessionExpired).toHaveBeenCalledWith(true)
    expect(gradesSource.getSnapshot()).toMatchObject({
      status: "success",
      data: [SAMPLE_GRADE],
      error: null,
      isStale: true,
      isRefreshing: false,
    })
    expect(rig.query.activity.getSnapshot()).toEqual({ refreshingCount: 0, staleCount: 1 })

    // Unsubscribing clears staleCount from activity!
    unsubGrades()
    expect(rig.query.activity.getSnapshot()).toEqual({ refreshingCount: 0, staleCount: 0 })

    // 3. Non-persisted query ("ecard") without fallback transitions to status: "error"
    const ecardSource = rig.query.source({
      feature: "ecard",
      slice: "ecard",
      fetcher: async () => {
        throw new ProviderError(ProviderErrorCode.NETWORK_ERROR, "Gateway timeout", undefined, 504)
      },
    })
    const unsubEcard = ecardSource.subscribe(() => {})
    await vi.waitFor(() => expect(ecardSource.getSnapshot().status).toBe("error"))
    expect(ecardSource.getSnapshot().data).toBeUndefined()
    expect(ecardSource.getSnapshot().error?.message).toBe("Gateway timeout")
    expect(rig.query.activity.getSnapshot()).toEqual({ refreshingCount: 0, staleCount: 0 })

    unsubEcard()
    rig.query.dispose()
  })

  it("isolates scoped source handles per consumer manifest id while sharing the data record", async () => {
    const { storage } = createTrackedStorage()
    const fetcherA = vi.fn(async (): Promise<Grade[]> => [{ ...SAMPLE_GRADE, courseName: "A" }])
    const fetcherB = vi.fn(async (): Promise<Grade[]> => [{ ...SAMPLE_GRADE, courseName: "B" }])
    const enabledA = { value: false }
    const ysu = makeProvider("ysu", { grades: { getGrades: async () => [SAMPLE_GRADE] } })
    const rig = createQueryTestRig({ provider: ysu, storage })
    await rig.query.hydrated

    const runtime = new PluginRuntime()
    runtime.context.set("provider", rig.providerService)
    runtime.context.set("session", rig.sessionService)
    runtime.context.set("storage", storage)
    runtime.register(queryRuntimePlugin, "builtin")
    await runtime.startAndWait(queryRuntimePlugin.manifest.id)

    let sourceA: ObservableSource<QuerySnapshot<Grade[]>> | null = null
    let sourceB: ObservableSource<QuerySnapshot<Grade[]>> | null = null
    let reconfigureA: (() => void) | null = null

    const consumerA = definePlugin({
      manifest: {
        id: "ext.consumer-a",
        name: "Consumer A",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["query"],
      apply(ctx) {
        const open = () => {
          const next = ctx.query.source<Grade[]>({
            feature: "grades",
            slice: "grades",
            params: { consumer: "shared" },
            enabled: () => enabledA.value,
            fetcher: fetcherA,
          })
          sourceA = next
          return next
        }
        open().subscribe(() => {})
        reconfigureA = open
      },
    })

    const consumerB = definePlugin({
      manifest: {
        id: "ext.consumer-b",
        name: "Consumer B",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["query"],
      apply(ctx) {
        const next = ctx.query.source<Grade[]>({
          feature: "grades",
          slice: "grades",
          params: { consumer: "shared" },
          fetcher: fetcherB,
        })
        sourceB = next
        next.subscribe(() => {})
      },
    })

    runtime.register(consumerA, "external")
    await runtime.startAndWait(consumerA.manifest.id)
    expect(sourceA).not.toBeNull()
    expect(sourceA!.getSnapshot().status).toBe("idle")
    expect(fetcherA).not.toHaveBeenCalled()

    runtime.register(consumerB, "external")
    await runtime.startAndWait(consumerB.manifest.id)
    expect(sourceA).not.toBe(sourceB)
    expect(fetcherB).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(sourceB!.getSnapshot().data?.[0]?.courseName).toBe("B"))
    expect(fetcherA).not.toHaveBeenCalled()

    // Enabling A and refreshing uses A's own fetcher on the shared record.
    enabledA.value = true
    reconfigureA!()
    await sourceA!.getSnapshot().refresh()
    expect(fetcherA).toHaveBeenCalledTimes(1)
    expect(fetcherB).toHaveBeenCalledTimes(1)
    expect(sourceA!.getSnapshot().data?.[0]?.courseName).toBe("A")

    // Disabling A must not reset B's record or block B's next refresh.
    enabledA.value = false
    reconfigureA!()
    expect(sourceB!.getSnapshot().data?.[0]?.courseName).toBe("A")
    await sourceB!.getSnapshot().refresh()
    expect(fetcherB).toHaveBeenCalledTimes(2)
    expect(fetcherA).toHaveBeenCalledTimes(1)
    expect(sourceB!.getSnapshot().data?.[0]?.courseName).toBe("B")

    // Disposing A leaves B subscribed and fetching independently.
    runtime.stop(consumerA.manifest.id)
    expect(sourceB!.getSnapshot().data?.[0]?.courseName).toBe("B")
    const rootQuery = runtime.context.get("query")!
    rootQuery.invalidate({ feature: "grades" })
    await vi.waitFor(() => expect(fetcherB).toHaveBeenCalledTimes(3))
    expect(fetcherA).toHaveBeenCalledTimes(1)

    runtime.stop(consumerB.manifest.id)
    expect(rig.getListenerCounts()).toEqual({ providerListeners: 0, sessionListeners: 0 })
    runtime.dispose()
    rig.query.dispose()
  })

  it("clears failed fetch state and retries the current identity after session expiry recovery", async () => {
    const ysu = makeProvider("ysu", {
      exams: { getExams: async () => [{ name: "OS", startAt: "2026-01-10T09:00:00" }] },
    })
    const rig = createQueryTestRig({ provider: ysu })
    await rig.query.hydrated

    let mode: "fail" | "ok" = "fail"
    const fetcher = vi.fn(async (): Promise<Exam[]> => {
      if (mode === "fail") {
        throw new ProviderError(ProviderErrorCode.NETWORK_ERROR, "offline", undefined, 503)
      }
      return [{ name: "OS", startAt: "2026-01-10T09:00:00" }]
    })

    const source = rig.query.source({
      feature: "exams",
      slice: "exams",
      fetcher,
    })
    const unsub = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().status).toBe("error"))
    expect(fetcher).toHaveBeenCalledTimes(1)

    rig.sessionState.set((prev) => ({ ...prev, sessionExpired: true }))
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(1)

    mode = "ok"
    rig.sessionState.set((prev) => ({ ...prev, sessionExpired: false }))
    await vi.waitFor(() => expect(source.getSnapshot().status).toBe("success"))
    expect(fetcher).toHaveBeenCalledTimes(2)

    unsub()
    rig.query.dispose()
  })

  it("retries the current identity after valid credentials are restored", async () => {
    const ysu = makeProvider("ysu", {
      exams: { getExams: async () => [{ name: "OS", startAt: "2026-01-10T09:00:00" }] },
    })
    const rig = createQueryTestRig({ provider: ysu, isAuthenticated: false })
    await rig.query.hydrated

    let mode: "fail" | "ok" = "fail"
    const fetcher = vi.fn(async (): Promise<Exam[]> => {
      if (mode === "fail") {
        throw new ProviderError(ProviderErrorCode.NETWORK_ERROR, "offline", undefined, 503)
      }
      return [{ name: "OS", startAt: "2026-01-10T09:00:00" }]
    })

    const source = rig.query.source({
      feature: "exams",
      slice: "exams",
      fetcher,
    })
    const unsub = source.subscribe(() => {})
    await vi.waitFor(() => expect(source.getSnapshot().status).toBe("error"))
    expect(fetcher).toHaveBeenCalledTimes(1)

    mode = "ok"
    rig.sessionState.set((prev) => ({
      ...prev,
      credential: "fresh-token",
      isAuthenticated: true,
      sessionExpired: false,
    }))
    await vi.waitFor(() => expect(source.getSnapshot().status).toBe("success"))
    expect(fetcher).toHaveBeenCalledTimes(2)

    unsub()
    rig.query.dispose()
  })

  it("isolates accounts & provider generations, handles enabled toggles, external query/invalidate events, clearPersistent, and scoped plugin disposal", async () => {
    const { storage } = createTrackedStorage()
    const aliceGate = Promise.withResolvers<Grade[]>()

    const ysu = makeProvider("ysu", {
      grades: {
        getGrades: async () => [SAMPLE_GRADE],
      },
    })
    const rig = createQueryTestRig({
      provider: ysu,
      storage,
      username: "alice",
      isAuthenticated: true,
      policies: { grades: { ttl: DEFAULT_TTL_MS, persist: true } },
    })
    await rig.query.hydrated

    // 1. Dynamic enabled toggle: starts idle while disabled, fetches once enabled
    let dynamicEnabled = false
    const toggledFetcher = vi.fn(async () => [SAMPLE_GRADE])
    const toggled = rig.query.source({
      feature: "grades",
      slice: "grades",
      params: { view: "toggled" },
      enabled: () => dynamicEnabled,
      fetcher: toggledFetcher,
    })
    const unsubToggled = toggled.subscribe(() => {})
    expect(toggled.getSnapshot().status).toBe("idle")
    expect(toggledFetcher).not.toHaveBeenCalled()

    dynamicEnabled = true
    rig.query.source({
      feature: "grades",
      slice: "grades",
      params: { view: "toggled" },
      enabled: () => dynamicEnabled,
      fetcher: toggledFetcher,
    })
    await vi.waitFor(() => expect(toggled.getSnapshot().status).toBe("success"))
    expect(toggledFetcher).toHaveBeenCalledTimes(1)
    unsubToggled()

    // 2. Account switch while Alice's AUTH_SESSION_EXPIRED failure is in flight must NOT expire Bob's session!
    let currentUserCall = 0
    const accountSource = rig.query.source({
      feature: "grades",
      slice: "grades",
      params: { view: "account" },
      fetcher: () => {
        currentUserCall += 1
        if (currentUserCall === 1) return aliceGate.promise
        return Promise.resolve([{ ...SAMPLE_GRADE, courseName: "Bob Course" }])
      },
    })
    const unsubAccount = accountSource.subscribe(() => {})
    expect(accountSource.getSnapshot().status).toBe("loading")

    // Switch session from Alice -> Bob before Alice's request fails
    rig.sessionState.set((prev) => ({
      ...prev,
      username: "bob",
      credential: "bob-cred",
      isAuthenticated: true,
      sessionExpired: false,
    }))

    await vi.waitFor(() => {
      expect(accountSource.getSnapshot().data?.[0]?.courseName).toBe("Bob Course")
    })

    // Alice's stale in-flight request now rejects with AUTH_SESSION_EXPIRED -> must NOT mark Bob's session expired!
    aliceGate.reject(
      new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, "Alice expired", undefined, 401)
    )
    await Promise.resolve()
    expect(rig.sessionService.setSessionExpired).not.toHaveBeenCalled()

    // 3. External ctx.emit("query/invalidate") event triggers revalidation while subscribed
    rig.ctx.emit("query/invalidate", { feature: "grades" })
    await vi.waitFor(() => {
      expect(currentUserCall).toBe(3)
    })

    // 4. clearPersistent wipes persistent cache
    const keyForBob = rig.query.cacheKey({
      providerId: "ysu",
      providerScope: "ysu:1",
      username: "bob",
      feature: "grades",
      params: { view: "account" },
    })
    expect(rig.query.readPersistent(keyForBob)).not.toBeNull()
    rig.query.clearPersistent()
    expect(rig.query.readPersistent(keyForBob)).toBeNull()

    unsubAccount()

    // 5. Scoped plugin disposal auto-cleans subscriptions leaked by stopped plugins
    const runtime = new PluginRuntime()
    runtime.context.set("provider", rig.providerService)
    runtime.context.set("session", rig.sessionService)
    runtime.context.set("storage", storage)
    runtime.register(queryRuntimePlugin, "builtin")
    await runtime.startAndWait(queryRuntimePlugin.manifest.id)

    const leakyConsumer = definePlugin({
      manifest: {
        id: "ext.leaky",
        name: "Leaky",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      },
      inject: ["query"],
      apply(ctx) {
        const sA = ctx.query.source({
          feature: "grades",
          slice: "grades",
          fetcher: async () => [SAMPLE_GRADE],
        })
        const sB = ctx.query.source({
          feature: "grades",
          slice: "grades",
          fetcher: async () => [SAMPLE_GRADE],
        })
        expect(sA).toBe(sB)
        // Intentionally do NOT save or call unsubscribe; stopping plugin must clean it up!
        sA.subscribe(() => {})
      },
    })

    runtime.register(leakyConsumer, "external")
    await runtime.startAndWait(leakyConsumer.manifest.id)
    expect(rig.getListenerCounts().providerListeners).toBe(1)

    runtime.stop(leakyConsumer.manifest.id)
    expect(rig.getListenerCounts().providerListeners).toBe(0)

    runtime.dispose()
    rig.query.dispose()
  })
})
