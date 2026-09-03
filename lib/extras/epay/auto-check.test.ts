import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  EpayAccessError: class EpayAccessError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "EpayAccessError"
    }
  },
  fetchEpayPayments: vi.fn(),
  fetchEpayBills: vi.fn(),
  getSettings: vi.fn(),
  getAuth: vi.fn(),
  setEpayLastCheckedAt: vi.fn(),
}))

vi.mock("@/providers/ysu/epay-access", () => ({
  EpayAccessError: mocks.EpayAccessError,
  fetchEpayPayments: mocks.fetchEpayPayments,
}))
vi.mock("@/lib/stores/settings", () => ({
  useSettingsStore: { getState: mocks.getSettings },
}))
vi.mock("@/lib/stores/auth", () => ({
  useAuthStore: { getState: mocks.getAuth },
}))
vi.mock("@/providers/ysu/protocol/epay", () => ({
  toRecordStatus: (record: { status: string }) => record.status,
}))
vi.mock("./client", () => ({
  fetchEpayBills: mocks.fetchEpayBills,
}))
vi.mock("./types", () => ({
  isUnpaid: (status: string) => status === "未支付",
}))

import { runEpayAutoCheck } from "./auto-check"

const settings = {
  epayNotifyEnabled: true,
  epayAccountSettings: {},
  setEpayLastCheckedAt: mocks.setEpayLastCheckedAt,
}

function accessError(): Error {
  return new mocks.EpayAccessError("SSO unavailable")
}

beforeEach(() => {
  vi.clearAllMocks()
  settings.epayAccountSettings = {}
  mocks.getSettings.mockReturnValue(settings)
  mocks.getAuth.mockReturnValue({ username: "student-a" })
})

describe("runEpayAutoCheck", () => {
  it("SSO 不可用时使用当前账号保存的姓名回退查询", async () => {
    settings.epayAccountSettings = {
      "student-a": { name: "张三", lastCheckedAt: 0 },
    }
    mocks.fetchEpayPayments.mockRejectedValue(accessError())
    mocks.fetchEpayBills.mockResolvedValue({
      unpaid: [{ amount: 1200.5, payStatus: "未支付" }],
    })

    await expect(runEpayAutoCheck()).resolves.toEqual({
      hasUnpaid: true,
      count: 1,
      total: 1200.5,
    })
    expect(mocks.fetchEpayBills).toHaveBeenCalledWith("student-a", "张三")
    expect(mocks.setEpayLastCheckedAt).toHaveBeenCalledWith("student-a", expect.any(Number))
  })

  it("不使用其他账号的姓名或检查时间", async () => {
    settings.epayAccountSettings = {
      "student-b": { name: "李四", lastCheckedAt: 0 },
    }
    mocks.fetchEpayPayments.mockRejectedValue(accessError())

    await expect(runEpayAutoCheck()).resolves.toBeNull()
    expect(mocks.fetchEpayBills).not.toHaveBeenCalled()
    expect(mocks.setEpayLastCheckedAt).not.toHaveBeenCalled()
  })
})
