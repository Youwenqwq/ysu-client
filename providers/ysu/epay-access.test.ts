import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  NotAuthenticatedError: class NotAuthenticatedError extends Error {},
  EpayNotLoggedInError: class EpayNotLoggedInError extends Error {},
  getEpayStatus: vi.fn(),
  isAuthenticated: vi.fn(),
}))

vi.mock("./protocol/epay", () => ({
  EpayNotLoggedInError: mocks.EpayNotLoggedInError,
  getEpayStatus: mocks.getEpayStatus,
  resetEpay: vi.fn(),
}))
vi.mock("./protocol/cas", () => ({
  NotAuthenticatedError: mocks.NotAuthenticatedError,
  isAuthenticated: mocks.isAuthenticated,
}))

import { EpayAccessError, fetchEpayPayments } from "./epay-access"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isAuthenticated.mockResolvedValue(true)
})

describe("fetchEpayPayments 错误映射", () => {
  it("CAS 授权失败映射为 EpayAccessError", async () => {
    mocks.getEpayStatus.mockRejectedValue(new mocks.NotAuthenticatedError("expired"))

    await expect(fetchEpayPayments()).rejects.toBeInstanceOf(EpayAccessError)
  })

  it("缴费会话跳回登录页映射为 EpayAccessError", async () => {
    mocks.getEpayStatus.mockRejectedValue(new mocks.EpayNotLoggedInError("expired"))

    await expect(fetchEpayPayments()).rejects.toBeInstanceOf(EpayAccessError)
  })
})
