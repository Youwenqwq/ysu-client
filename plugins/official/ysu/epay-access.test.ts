import { beforeEach, describe, expect, it, vi } from "vitest"
import { ProviderError, ProviderErrorCode } from "@orahako/plugin-sdk/provider-errors"
import { createEpayAccess } from "./epay-access"
import {
  EpayNotLoggedInError,
  EpayProtocolError,
  type EpayProtocol,
} from "./protocol/epay"
import { createTestContext } from "./test-context"

const mocks = vi.hoisted(() => ({
  getEpayStatus: vi.fn(),
  auth: {
    activeSchoolId: "ysu" as string | null,
    username: "student-a" as string | null,
    credential: "session-a" as string | null,
    isAuthenticated: true,
    sessionExpired: false,
    artifacts: {} as Record<string, string>,
  },
}))

let fetchEpayPayments: () => Promise<unknown>

const epay = {
  getEpayStatus: mocks.getEpayStatus,
} as unknown as EpayProtocol

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.username = "student-a"
  mocks.auth.credential = "session-a"
  mocks.auth.isAuthenticated = true
  mocks.auth.sessionExpired = false
  const ctx = createTestContext({ state: mocks.auth }).ctx
  fetchEpayPayments = createEpayAccess(ctx, epay, () => undefined)
})

describe("fetchEpayPayments session boundary", () => {
  it("marks only the current session expired without clearing the logged-in account", async () => {
    mocks.getEpayStatus.mockRejectedValue(new EpayNotLoggedInError("expired"))
    await expect(fetchEpayPayments()).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_SESSION_EXPIRED,
    })
    expect(mocks.auth.sessionExpired).toBe(true)
    expect(mocks.auth.username).toBe("student-a")
    expect(mocks.auth.isAuthenticated).toBe(true)
  })

  it("does not expire a newly logged-in account when an older query fails", async () => {
    const pending = Promise.withResolvers<never>()
    mocks.getEpayStatus.mockReturnValue(pending.promise)
    const query = fetchEpayPayments()
    const rejected = expect(query).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_SESSION_EXPIRED,
    })
    mocks.auth.username = "student-b"
    mocks.auth.credential = "session-b"
    pending.reject(new EpayNotLoggedInError("expired"))
    await rejected
    expect(mocks.auth.sessionExpired).toBe(false)
  })

  it("keeps protocol failures distinct from authentication failures", async () => {
    mocks.getEpayStatus.mockRejectedValue(new EpayProtocolError("malformed payment data"))
    await expect(fetchEpayPayments()).rejects.toMatchObject({
      code: ProviderErrorCode.BACKEND_PROTOCOL_ERROR,
    })
    expect(mocks.auth.sessionExpired).toBe(false)
  })

  it("requires local authentication instead of exposing a previously authorized protocol session", async () => {
    mocks.auth.isAuthenticated = false
    await expect(fetchEpayPayments()).rejects.toBeInstanceOf(ProviderError)
    expect(mocks.getEpayStatus).not.toHaveBeenCalled()
  })
})
