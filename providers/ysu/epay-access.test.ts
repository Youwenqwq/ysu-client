import { beforeEach, describe, expect, it, vi } from "vitest"
import { ProviderError, ProviderErrorCode } from "../errors"

const mocks = vi.hoisted(() => ({
  EpayNotLoggedInError: class EpayNotLoggedInError extends Error {},
  EpayProtocolError: class EpayProtocolError extends Error {},
  getEpayStatus: vi.fn(),
  getAuth: vi.fn(),
}))

vi.mock("./protocol/epay", () => ({
  EpayNotLoggedInError: mocks.EpayNotLoggedInError,
  EpayProtocolError: mocks.EpayProtocolError,
  getEpayStatus: mocks.getEpayStatus,
  resetEpay: vi.fn(),
}))
vi.mock("./cas-auth", () => ({ mapCASSessionError: () => undefined }))
vi.mock("@/lib/stores/auth", () => ({ useAuthStore: { getState: mocks.getAuth } }))
vi.mock("@/lib/server-config", () => ({ getSchoolConfigScope: () => "ysu" }))

import { fetchEpayPayments } from "./epay-access"

const auth = {
  username: "student-a",
  credential: "session-a",
  isAuthenticated: true,
  sessionExpired: false,
  setSessionExpired(value: boolean) { auth.sessionExpired = value },
}

beforeEach(() => {
  vi.resetAllMocks()
  auth.username = "student-a"
  auth.credential = "session-a"
  auth.isAuthenticated = true
  auth.sessionExpired = false
  mocks.getAuth.mockReturnValue(auth)
})

describe("fetchEpayPayments session boundary", () => {
  it("marks only the current session expired without clearing the logged-in account", async () => {
    mocks.getEpayStatus.mockRejectedValue(new mocks.EpayNotLoggedInError("expired"))
    await expect(fetchEpayPayments()).rejects.toMatchObject({ code: ProviderErrorCode.AUTH_SESSION_EXPIRED })
    expect(auth.sessionExpired).toBe(true)
    expect(auth.username).toBe("student-a")
    expect(auth.isAuthenticated).toBe(true)
  })

  it("does not expire a newly logged-in account when an older query fails", async () => {
    const pending = Promise.withResolvers<never>()
    mocks.getEpayStatus.mockReturnValue(pending.promise)
    const query = fetchEpayPayments()
    const rejected = expect(query).rejects.toMatchObject({ code: ProviderErrorCode.AUTH_SESSION_EXPIRED })
    auth.username = "student-b"
    auth.credential = "session-b"
    pending.reject(new mocks.EpayNotLoggedInError("expired"))
    await rejected
    expect(auth.sessionExpired).toBe(false)
  })

  it("keeps protocol failures distinct from authentication failures", async () => {
    mocks.getEpayStatus.mockRejectedValue(new mocks.EpayProtocolError("malformed payment data"))
    await expect(fetchEpayPayments()).rejects.toMatchObject({ code: ProviderErrorCode.BACKEND_PROTOCOL_ERROR })
    expect(auth.sessionExpired).toBe(false)
  })

  it("requires local authentication instead of exposing a previously authorized protocol session", async () => {
    auth.isAuthenticated = false
    await expect(fetchEpayPayments()).rejects.toBeInstanceOf(ProviderError)
    expect(mocks.getEpayStatus).not.toHaveBeenCalled()
  })
})
