import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  fetchEpayPayments: vi.fn(),
  getSettings: vi.fn(),
  getAuth: vi.fn(),
  setEpayLastCheckedAt: vi.fn(),
}))

vi.mock("@/providers/ysu/epay-access", () => ({
  fetchEpayPayments: mocks.fetchEpayPayments,
}))
vi.mock("@/lib/stores/settings", () => ({
  useSettingsStore: { getState: mocks.getSettings },
}))
vi.mock("@/lib/stores/auth", () => ({
  useAuthStore: { getState: mocks.getAuth },
}))

import { runEpayAutoCheck } from "./auto-check"

const settings = {
  epayNotifyEnabled: true,
  epayAccountSettings: {} as Record<string, { lastCheckedAt: number }>,
  setEpayLastCheckedAt: mocks.setEpayLastCheckedAt,
}

beforeEach(() => {
  vi.resetAllMocks()
  settings.epayNotifyEnabled = true
  settings.epayAccountSettings = {}
  mocks.getSettings.mockReturnValue(settings)
  mocks.getAuth.mockReturnValue({ username: "student-a", credential: "session-a" })
  mocks.setEpayLastCheckedAt.mockImplementation((username: string, lastCheckedAt: number) => {
    settings.epayAccountSettings[username] = { lastCheckedAt }
  })
})

describe("runEpayAutoCheck", () => {
  it("does not turn history-only unpaid-looking rows into notifications", async () => {
    mocks.fetchEpayPayments.mockResolvedValue({
      records: [{ amountN: 1200, overTime: "", status: "1", expired: "0" }],
      unpaid: [],
    })
    await expect(runEpayAutoCheck()).resolves.toEqual({ hasUnpaid: false, count: 0, total: 0 })
  })

  it("does not notify or consume the interval when the account changes during a request", async () => {
    const pending = Promise.withResolvers<{ unpaid: { amountN: number }[] }>()
    mocks.fetchEpayPayments.mockReturnValue(pending.promise)
    const check = runEpayAutoCheck()
    mocks.getAuth.mockReturnValue({ username: "student-b", credential: "session-b" })
    pending.resolve({ unpaid: [{ amountN: 1200 }] })
    await expect(check).resolves.toBeNull()
    expect(settings.epayAccountSettings).toEqual({})
  })

  it("does not publish an obsolete session result after the same account logs in again", async () => {
    const pending = Promise.withResolvers<{ unpaid: { amountN: number }[] }>()
    mocks.fetchEpayPayments.mockReturnValue(pending.promise)
    const check = runEpayAutoCheck()
    mocks.getAuth.mockReturnValue({ username: "student-a", credential: "new-session" })
    mocks.fetchEpayPayments.mockResolvedValueOnce({ unpaid: [{ amountN: 50 }] })
    await expect(runEpayAutoCheck()).resolves.toEqual({ hasUnpaid: true, count: 1, total: 50 })
    pending.resolve({ unpaid: [{ amountN: 1200 }] })
    await expect(check).resolves.toBeNull()
  })

  it("only one overlapping invocation can produce a notification and success starts the interval", async () => {
    const pending = Promise.withResolvers<{ unpaid: { amountN: number }[] }>()
    mocks.fetchEpayPayments.mockReturnValue(pending.promise)
    const first = runEpayAutoCheck()
    await expect(runEpayAutoCheck()).resolves.toBeNull()
    pending.resolve({ unpaid: [{ amountN: 0.1 }, { amountN: 0.2 }] })
    await expect(first).resolves.toEqual({ hasUnpaid: true, count: 2, total: 0.3 })
    await expect(runEpayAutoCheck()).resolves.toBeNull()
  })

  it("permits a later attempt after a failed request", async () => {
    mocks.fetchEpayPayments.mockRejectedValueOnce(new Error("unavailable"))
    await expect(runEpayAutoCheck()).resolves.toBeNull()
    mocks.fetchEpayPayments.mockResolvedValueOnce({ unpaid: [{ amountN: 50 }] })
    await expect(runEpayAutoCheck()).resolves.toEqual({ hasUnpaid: true, count: 1, total: 50 })
  })
})
