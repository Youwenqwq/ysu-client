import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  defineSchoolProvider,
  type EpayRecord,
  type EpaySessionStatus,
  type SchoolProvider,
} from "@orahako/academic-sdk"
import type { PluginKeyValueStorage, PluginStorageService } from "@orahako/sdk"
import {
  MIN_EPAY_CHECK_INTERVAL_MS,
  runEpayAutoCheck,
  shouldTriggerEpayCheckOnSession,
  type EpaySessionTriggerState,
} from "../src/auto-check"
import { epaySettingsStore, type EpaySettingsStoreInstance } from "../src/store"

function makeRecord(amountN: number, id = "1"): EpayRecord {
  return {
    id,
    payName: "学费",
    chargeYear: "2026",
    currencyTypeShow: "人民币",
    amountN,
    amount: amountN.toFixed(2),
    payAmount: "0.00",
    refundAmount: "0.00",
    status: "1",
    expired: "0",
    startTime: "2026-09-01",
    overTime: "",
  }
}

function createMemoryStorage(): {
  readonly map: Map<string, string>
  readonly service: PluginStorageService
} {
  const map = new Map<string, string>()
  const backend: PluginKeyValueStorage = {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value)
    },
    removeItem: async (key) => {
      map.delete(key)
    },
  }
  return {
    map,
    service: {
      local: backend,
      secure: backend,
    },
  }
}

describe("runEpayAutoCheck (scoped epaySettingsStore)", () => {
  const fetchPayments = vi.fn<() => Promise<EpaySessionStatus>>()
  const getAuth =
    vi.fn<() => { username: string | null; credential: string | null; isAuthenticated?: boolean }>()
  let store: EpaySettingsStoreInstance
  let currentNow: number
  let testProvider: SchoolProvider

  beforeEach(() => {
    vi.resetAllMocks()
    currentNow = 1_760_000_000_000
    store = epaySettingsStore.create()
    getAuth.mockReturnValue({
      username: "student-a",
      credential: "session-a",
      isAuthenticated: true,
    })
    testProvider = defineSchoolProvider({
      id: "ysu",
      name: "燕山大学",
      timeZone: "Asia/Shanghai",
      slices: {
        epay: {
          fetchPayments,
          recordStatus: () => "unpaid",
        },
      },
      async initialize() {},
      async reset() {},
      async logout() {},
      async dispose() {},
      async relogin() {
        return true
      },
    })
  })

  const check = () =>
    runEpayAutoCheck({
      session: { getSnapshot: getAuth },
      provider: { getSnapshot: () => ({ provider: testProvider }) },
      store,
      now: () => currentNow,
    })

  it("does not turn history-only unpaid-looking rows into notifications", async () => {
    fetchPayments.mockResolvedValue({
      ready: true,
      records: [makeRecord(1200)],
      unpaid: [],
    })
    await expect(check()).resolves.toEqual({ hasUnpaid: false, count: 0, total: 0 })
  })

  it("does not notify or consume the interval when the account changes during a request", async () => {
    const pending = Promise.withResolvers<EpaySessionStatus>()
    fetchPayments.mockReturnValue(pending.promise)

    const running = check()
    getAuth.mockReturnValue({
      username: "student-b",
      credential: "session-b",
      isAuthenticated: true,
    })
    pending.resolve({
      ready: true,
      records: [makeRecord(1200)],
      unpaid: [makeRecord(1200)],
    })

    await expect(running).resolves.toBeNull()
    expect(store.source.getSnapshot().accountSettings).toEqual({})
  })

  it("does not publish an obsolete session result after the same account logs in again", async () => {
    const pending = Promise.withResolvers<EpaySessionStatus>()
    fetchPayments.mockReturnValue(pending.promise)

    const first = check()
    getAuth.mockReturnValue({
      username: "student-a",
      credential: "new-session",
      isAuthenticated: true,
    })
    fetchPayments.mockResolvedValueOnce({
      ready: true,
      records: [makeRecord(50)],
      unpaid: [makeRecord(50)],
    })
    await expect(check()).resolves.toEqual({ hasUnpaid: true, count: 1, total: 50 })

    pending.resolve({
      ready: true,
      records: [makeRecord(1200)],
      unpaid: [makeRecord(1200)],
    })
    await expect(first).resolves.toBeNull()
  })

  it("only one overlapping invocation can produce a notification and success starts the 3-hour cooldown", async () => {
    const pending = Promise.withResolvers<EpaySessionStatus>()
    fetchPayments.mockReturnValue(pending.promise)

    const first = check()
    await expect(check()).resolves.toBeNull()

    pending.resolve({
      ready: true,
      records: [],
      unpaid: [makeRecord(0.1, "1"), makeRecord(0.2, "2")],
    })
    await expect(first).resolves.toEqual({ hasUnpaid: true, count: 2, total: 0.3 })

    // Still within cooldown
    currentNow += MIN_EPAY_CHECK_INTERVAL_MS - 1
    await expect(check()).resolves.toBeNull()
    expect(fetchPayments).toHaveBeenCalledTimes(1)

    // Cooldown elapsed
    currentNow += 2
    fetchPayments.mockResolvedValueOnce({
      ready: true,
      records: [],
      unpaid: [makeRecord(800)],
    })
    await expect(check()).resolves.toEqual({ hasUnpaid: true, count: 1, total: 800 })
    expect(fetchPayments).toHaveBeenCalledTimes(2)
  })

  it("isolates cooldown timestamps per account", async () => {
    fetchPayments.mockResolvedValue({
      ready: true,
      records: [],
      unpaid: [makeRecord(300)],
    })
    await expect(check()).resolves.toEqual({ hasUnpaid: true, count: 1, total: 300 })

    // Switching to student-b immediately is NOT throttled by student-a's check
    getAuth.mockReturnValue({
      username: "student-b",
      credential: "session-b",
      isAuthenticated: true,
    })
    await expect(check()).resolves.toEqual({ hasUnpaid: true, count: 1, total: 300 })
    expect(Object.keys(store.source.getSnapshot().accountSettings).sort()).toEqual([
      "student-a",
      "student-b",
    ])
  })

  it("permits a later attempt after a failed request and respects notifyEnabled=false", async () => {
    fetchPayments.mockRejectedValueOnce(new Error("unavailable"))
    await expect(check()).resolves.toBeNull()

    fetchPayments.mockResolvedValueOnce({
      ready: true,
      records: [],
      unpaid: [makeRecord(50)],
    })
    await expect(check()).resolves.toEqual({ hasUnpaid: true, count: 1, total: 50 })

    currentNow += MIN_EPAY_CHECK_INTERVAL_MS + 1000
    store.actions.setNotifyEnabled(false)
    await expect(check()).resolves.toBeNull()
    expect(fetchPayments).toHaveBeenCalledTimes(2)
  })

  it("waits for persisted store hydration before deciding whether to query", async () => {
    const memory = createMemoryStorage()
    memory.map.set(
      "epay-settings",
      JSON.stringify({
        version: 1,
        state: {
          notifyEnabled: false,
          accountSettings: {},
        },
      })
    )
    const persistedStore = epaySettingsStore.create(memory.service)
    expect(persistedStore.hydrated.getSnapshot()).toBe(false)

    const result = await runEpayAutoCheck({
      session: { getSnapshot: getAuth },
      provider: { getSnapshot: () => ({ provider: testProvider }) },
      store: persistedStore,
      now: () => currentNow,
    })

    expect(result).toBeNull()
    expect(fetchPayments).not.toHaveBeenCalled()
    persistedStore.dispose()
  })
})

describe("shouldTriggerEpayCheckOnSession", () => {
  const signedIn: EpaySessionTriggerState = {
    hasHydrated: true,
    isAuthenticated: true,
    username: "student-a",
    credential: "session-a",
  }

  it("ignores notifications that do not move the relevant session fields", () => {
    expect(shouldTriggerEpayCheckOnSession(signedIn, { ...signedIn })).toBe(false)
  })

  it("triggers when hydration, authentication, username or credential becomes ready", () => {
    expect(
      shouldTriggerEpayCheckOnSession({ ...signedIn, hasHydrated: false }, signedIn)
    ).toBe(true)
    expect(
      shouldTriggerEpayCheckOnSession({ ...signedIn, isAuthenticated: false }, signedIn)
    ).toBe(true)
    expect(
      shouldTriggerEpayCheckOnSession({ ...signedIn, username: null }, signedIn)
    ).toBe(true)
    expect(
      shouldTriggerEpayCheckOnSession({ ...signedIn, credential: null }, signedIn)
    ).toBe(true)
  })
})
