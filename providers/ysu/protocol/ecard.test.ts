import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpResponse } from "@/lib/cookie"
import type * as CookieModule from "@/lib/cookie"
import type * as CasModule from "./cas"

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  getCredentialApplied: vi.fn(),
  fetchWithJar: vi.fn<typeof CookieModule.fetchWithJar>(),
  authState: {
    username: "account-a",
    credential: "credential-a",
    isAuthenticated: true,
    sessionExpired: false,
    setSessionExpired(expired: boolean) {
      this.sessionExpired = expired
    },
  },
}))

vi.mock("@/lib/cookie", async (importOriginal) => ({
  ...(await importOriginal<typeof CookieModule>()),
  fetchWithJar: mocks.fetchWithJar,
}))
vi.mock("./cas", async (importOriginal) => ({
  ...(await importOriginal<typeof CasModule>()),
  authorize: mocks.authorize,
  getCredentialApplied: mocks.getCredentialApplied,
}))
vi.mock("@/lib/stores/auth", () => ({
  useAuthStore: { getState: () => mocks.authState },
}))

import {
  EcardNotLoggedInError,
  EcardProtocolError,
  getEcardBalance,
  resetEcard,
  toEcardBalance,
} from "./ecard"
import { NotAuthenticatedError } from "./cas"
import { fetchEcardBalance } from "../ecard-access"
import { ProviderErrorCode } from "@/providers/errors"

/** 真实抓包结构（余额 18.55，学号已脱敏） */
const REAL = {
  id: "000000000001",
  datas: {
    DM: "1",
    KYXQ: "2029-08-31",
    KH: "000000000001",
    KNYE: 18.55,
    MC: "在用",
    SFRZH: "000000000001",
  },
  status: 200,
  cardstatuscode: "1",
  cardnum: "000000000001",
  availdate: "2029-08-31",
  remining: "18.55",
  code: 200,
  yearMonths: ["2026-09", "2026-08", "2026-07"],
  cardstatusname: "在用",
}

describe("toEcardBalance", () => {
  it("真实结构解析（顶层字段优先）", () => {
    const b = toEcardBalance({ ...REAL, datas: { ...REAL.datas, KNYE: 99 } })
    expect(b).not.toBeNull()
    expect(b!.balance).toBeCloseTo(18.55)
    expect(b!.cardNum).toBe("000000000001")
    expect(b!.availableDate).toBe("2029-08-31")
    expect(b!.cardStatusName).toBe("在用")
    expect(b!.months).toEqual(["2026-09", "2026-08", "2026-07"])
  })

  it("datas 字段兜底（顶层缺失时）", () => {
    const body = {
      id: "student-id",
      datas: { KNYE: "5.00", KYXQ: "2025-01-01", MC: "挂失", KH: "123" },
    }
    const b = toEcardBalance(body)
    expect(b!.balance).toBe(5)
    expect(b!.availableDate).toBe("2025-01-01")
    expect(b!.cardStatusName).toBe("挂失")
    expect(b!.cardNum).toBe("123")
  })

  it("缺少余额不能被有效期伪装成零余额，真实零余额仍有效", () => {
    expect(toEcardBalance({ availdate: "2029-08-31" })).toBeNull()
    expect(toEcardBalance({ remining: null })).toBeNull()
    expect(toEcardBalance({ remining: "0.00" })?.balance).toBe(0)
  })

  it("拒绝把无效金额转成零或把布尔值转成金额", () => {
    expect(() => toEcardBalance({ remining: "unavailable" })).toThrow(EcardProtocolError)
    expect(() => toEcardBalance({ remining: true })).toThrow(EcardProtocolError)
    expect(() => toEcardBalance({ remining: Number.POSITIVE_INFINITY })).toThrow(EcardProtocolError)
  })
})

const BALANCE_URL =
  "https://ehall.ysu.edu.cn/publicapp/sys/myyktzd/mySmartCard/loadSmartCardBillMain.do"

function response(body: unknown, status = 200, url = BALANCE_URL): HttpResponse {
  return {
    status,
    headers: {},
    url,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

describe("ecard session and response handling", () => {
  afterEach(() => vi.unstubAllEnvs())

  beforeEach(() => {
    resetEcard()
    vi.resetAllMocks()
    mocks.authorize.mockResolvedValue(undefined)
    mocks.authState.username = "account-a"
    mocks.authState.credential = "credential-a"
    mocks.authState.isAuthenticated = true
    mocks.authState.sessionExpired = false
    mocks.getCredentialApplied.mockResolvedValue(undefined)
  })

  it("reauthorizes an expired balance session once and returns the new balance", async () => {
    mocks.fetchWithJar
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response(REAL))

    expect((await getEcardBalance()).balance?.balance).toBe(18.55)
  })

  it("omits diagnostics from ordinary builds", async () => {
    vi.stubEnv("NEXT_PUBLIC_ECARD_DIAGNOSTICS", "")
    mocks.fetchWithJar.mockResolvedValue(response(REAL))

    expect(await getEcardBalance()).not.toHaveProperty("diagnostics")
  })

  it("reports conflicting balance fields from each new response without changing selection", async () => {
    vi.stubEnv("NEXT_PUBLIC_ECARD_DIAGNOSTICS", "1")
    mocks.fetchWithJar
      .mockResolvedValueOnce(response(REAL))
      .mockResolvedValueOnce(response({ ...REAL, datas: { ...REAL.datas, KNYE: 27.5 } }))

    expect((await getEcardBalance()).diagnostics?.knye.value).toBe(18.55)
    const next = await getEcardBalance()
    expect(next.balance?.balance).toBe(18.55)
    expect(next.diagnostics).toEqual({
      remining: { present: true, value: 18.55 },
      knye: { present: true, value: 27.5 },
      selectedField: "remining",
    })
    expect(mocks.fetchWithJar).toHaveBeenCalledTimes(2)
    expect(mocks.authorize).toHaveBeenCalledTimes(1)
  })

  it("identifies a zero balance selected from the fallback field", async () => {
    vi.stubEnv("NEXT_PUBLIC_ECARD_DIAGNOSTICS", "1")
    mocks.fetchWithJar.mockResolvedValue(response({ code: 200, datas: { KNYE: "0.00" } }))

    const result = await getEcardBalance()
    expect(result.balance?.balance).toBe(0)
    expect(result.diagnostics).toEqual({
      remining: { present: false, value: null },
      knye: { present: true, value: 0 },
      selectedField: "datas.KNYE",
    })
  })

  it("retains only numeric balances, excluding identifiers and unexpected field contents", async () => {
    vi.stubEnv("NEXT_PUBLIC_ECARD_DIAGNOSTICS", "1")
    mocks.fetchWithJar.mockResolvedValue(
      response({ ...REAL, privateData: "private-response-data", datas: { KNYE: "private-value" } })
    )

    expect((await getEcardBalance()).diagnostics).toEqual({
      remining: { present: true, value: 18.55 },
      knye: { present: true, value: null },
      selectedField: "remining",
    })
  })

  it("keeps a renewed session usable when an older request reports expiry later", async () => {
    mocks.fetchWithJar.mockResolvedValue(response(REAL))
    await getEcardBalance()

    const entered = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<HttpResponse>()
    mocks.fetchWithJar
      .mockImplementationOnce(() => {
        entered.resolve()
        return pending.promise
      })
      .mockResolvedValueOnce(response({}, 401))
    const lateBalance = getEcardBalance()
    await entered.promise
    expect((await getEcardBalance()).balance?.balance).toBe(18.55)

    mocks.authorize.mockRejectedValue(new NotAuthenticatedError("extra authorization rejected"))
    pending.resolve(response({}, 401))
    expect((await lateBalance).balance?.balance).toBe(18.55)
  })

  it("surfaces repeated redirects as session expiry rather than an empty card", async () => {
    mocks.fetchWithJar.mockResolvedValue(response({}, 302))

    await expect(getEcardBalance()).rejects.toBeInstanceOf(EcardNotLoggedInError)
  })

  it("rejects a lookalike origin without exposing the redirect ticket", async () => {
    mocks.fetchWithJar.mockResolvedValue(
      response(REAL, 200, "https://ehall.ysu.edu.cn.evil.example/card?ticket=secret")
    )

    const result = getEcardBalance()
    await expect(result).rejects.toBeInstanceOf(EcardNotLoggedInError)
    await expect(result).rejects.not.toThrow("secret")
  })

  it("does not render business errors as successful balances", async () => {
    mocks.fetchWithJar.mockResolvedValue(response({ ...REAL, code: 500 }))

    await expect(getEcardBalance()).rejects.toBeInstanceOf(EcardProtocolError)
  })

  it("distinguishes an absent card from a malformed response", async () => {
    mocks.fetchWithJar.mockResolvedValueOnce(response({ code: 200, datas: {} }))
    expect((await getEcardBalance()).balance).toBeNull()

    mocks.fetchWithJar.mockResolvedValueOnce(response({ message: "backend unavailable" }))
    await expect(getEcardBalance()).rejects.toBeInstanceOf(EcardProtocolError)
  })

  it("discards an old account balance after reset while the replacement account remains usable", async () => {
    const entered = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<HttpResponse>()
    mocks.fetchWithJar.mockImplementationOnce(() => {
      entered.resolve()
      return pending.promise
    })
    const oldBalance = getEcardBalance()
    const rejected = expect(oldBalance).rejects.toBeInstanceOf(EcardProtocolError)
    await entered.promise

    resetEcard()
    mocks.fetchWithJar.mockResolvedValue(response({ ...REAL, remining: "27.50" }))
    expect((await getEcardBalance()).balance?.balance).toBe(27.5)
    pending.resolve(response(REAL))
    await rejected
    expect((await getEcardBalance()).balance?.balance).toBe(27.5)
  })

  it("does not authorize the replacement account with an old in-flight login", async () => {
    const entered = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<void>()
    mocks.authorize.mockImplementationOnce(() => {
      entered.resolve()
      return pending.promise
    })
    const oldBalance = getEcardBalance()
    const rejected = expect(oldBalance).rejects.toBeInstanceOf(EcardProtocolError)
    await entered.promise
    resetEcard()
    pending.resolve()
    await rejected

    mocks.authorize.mockRejectedValueOnce(new NotAuthenticatedError("expired"))
    await expect(fetchEcardBalance()).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_SESSION_EXPIRED,
    })
  })

  it("maps CAS authentication failures to the access layer authentication error", async () => {
    mocks.authorize.mockRejectedValue(new NotAuthenticatedError("expired"))

    await expect(fetchEcardBalance()).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_SESSION_EXPIRED,
    })
    expect(mocks.authState.sessionExpired).toBe(true)
  })

  it("does not mark a replacement account expired when an old login fails", async () => {
    const entered = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<void>()
    mocks.authorize.mockImplementationOnce(() => {
      entered.resolve()
      return pending.promise
    })
    const oldBalance = fetchEcardBalance()
    const rejected = expect(oldBalance).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_SESSION_EXPIRED,
    })
    await entered.promise
    mocks.authState.username = "account-b"
    mocks.authState.credential = "credential-b"
    pending.reject(new NotAuthenticatedError("expired"))

    await rejected
    expect(mocks.authState.sessionExpired).toBe(false)
  })

  it("does not expose a still-active card session once the account is logged out locally", async () => {
    mocks.fetchWithJar.mockResolvedValue(response(REAL))
    expect((await fetchEcardBalance()).balance?.balance).toBe(18.55)
    mocks.authState.isAuthenticated = false

    await expect(fetchEcardBalance()).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_REQUIRED,
    })
    expect(mocks.authState.sessionExpired).toBe(false)
  })
})
