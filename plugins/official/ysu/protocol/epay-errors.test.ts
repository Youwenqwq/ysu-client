import { beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpResponse } from "@orahako/plugin-sdk"
import type { CASProtocol } from "./cas"
import { createEPAY, EpayNotLoggedInError, EpayProtocolError, type EpayProtocol } from "./epay"
import { createTestContext } from "../test-context"

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  getCredentialApplied: vi.fn(),
  fetchWithJar: vi.fn(),
}))

let epay: EpayProtocol

function response(text: string, url = "https://epay.ysu.edu.cn/pay/allPay.html"): HttpResponse {
  return {
    status: 200,
    headers: {},
    url,
    text: async () => text,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function page(rows: unknown[], hasNextPage = 0): HttpResponse {
  return response(
    `<script>var $E={D : ${JSON.stringify({
      queryResult: {
        names: { id: 1, payName: 2, amountN: 3, overTime: 4, status: 5, expired: 6 },
        rows,
        hasNextPage,
      },
    })}};</script>`
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.authorize.mockResolvedValue(undefined)
  mocks.getCredentialApplied.mockResolvedValue(undefined)
  const ctx = createTestContext({
    fetchWithJar: (jar, request) => mocks.fetchWithJar(jar, request),
  }).ctx
  const cas = {
    authorize: mocks.authorize,
    getCredentialApplied: mocks.getCredentialApplied,
  } as unknown as CASProtocol
  epay = createEPAY(ctx, cas)
  epay.resetEpay()
})

describe("getEpayStatus", () => {
  it("rejects malformed pages rather than claiming nothing is owed", async () => {
    mocks.fetchWithJar.mockResolvedValue(response("<html>unexpected response</html>"))
    await expect(epay.getEpayStatus()).rejects.toBeInstanceOf(EpayProtocolError)
  })

  it("rejects unreadable amounts instead of reporting a zero total", async () => {
    mocks.fetchWithJar.mockResolvedValue(page([["1", "tuition", "not a number", "", "1", "0"]]))
    await expect(epay.getEpayStatus()).rejects.toBeInstanceOf(EpayProtocolError)
  })

  it("rejects an incomplete paginated result instead of claiming all records were read", async () => {
    mocks.fetchWithJar.mockResolvedValue(page([], 1))
    await expect(epay.getEpayStatus()).rejects.toBeInstanceOf(EpayProtocolError)
  })

  it("uses index alone for unpaid totals and gives current index rows precedence", async () => {
    mocks.fetchWithJar
      .mockResolvedValueOnce(
        page([
          ["history-only", "historical", 900, "", "1", "0"],
          ["same", "old paid version", 100, "2026-01-01", "1", "0"],
        ])
      )
      .mockResolvedValueOnce(
        page([
          ["same", "current pending", 100, "", "1", "0"],
          ["same", "current pending", 100, "", "1", "0"],
          ["expired", "expired", 500, "", "1", "1"],
        ])
      )
    const result = await epay.getEpayStatus()
    expect(result.unpaid.map((record) => record.id)).toEqual(["same"])
    expect(result.records.find((record) => record.id === "same")?.overTime).toBe("")
  })

  it("handles braces and an escaped trailing backslash inside payment names", async () => {
    const name = "tuition {special} \\"
    mocks.fetchWithJar
      .mockResolvedValueOnce(page([["1", name, 100, "2026-01-01", "1", "0"]]))
      .mockResolvedValueOnce(page([]))
    expect((await epay.getEpayStatus()).records[0]?.payName).toBe(name)
  })

  it("reports a final CAS redirect as session expiry even without recognizable login text", async () => {
    mocks.fetchWithJar.mockResolvedValue(
      response("<html>sign in</html>", "https://auth.ysu.edu.cn/authserver/login")
    )
    await expect(epay.getEpayStatus()).rejects.toBeInstanceOf(EpayNotLoggedInError)
  })

  it("discards an old account response after reset without poisoning the new session", async () => {
    const pending = Promise.withResolvers<HttpResponse>()
    const started = Promise.withResolvers<void>()
    mocks.fetchWithJar.mockImplementationOnce(() => {
      started.resolve()
      return pending.promise
    })
    const oldQuery = epay.getEpayStatus()
    const rejected = expect(oldQuery).rejects.toBeInstanceOf(EpayNotLoggedInError)
    await started.promise
    epay.resetEpay()
    mocks.fetchWithJar
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([["new", "new account", 50, "", "1", "0"]]))
    const currentQuery = epay.getEpayStatus()
    pending.resolve(page([["old", "old account", 500, "", "1", "0"]]))
    await rejected
    expect((await currentQuery).unpaid.map((record) => record.id)).toEqual(["new"])
  })
})
