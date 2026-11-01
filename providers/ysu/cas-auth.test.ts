import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ProviderErrorCode } from "../errors"
import { getCaptchaImage, loginStep1, mapCASSessionError, requestMFACode, submitMFACode } from "./cas-auth"
import * as casProtocol from "./protocol/cas"
import { LoginFailedError, NeedCaptchaError, NotAuthenticatedError } from "./protocol/cas"
import { checkRateLimit, recordLoginAttempt } from "@/lib/rate-limit"

describe("CAS session error mapping", () => {
  it("converts a CAS login bounce into a user-facing session error", () => {
    const error = mapCASSessionError(
      new NotAuthenticatedError("CAS bounced back to login page; TGC missing or expired")
    )

    expect(error?.code).toBe(ProviderErrorCode.AUTH_SESSION_EXPIRED)
    expect(error?.status).toBe(401)
  })

  it("leaves unrelated errors for their owning mapper", () => {
    expect(mapCASSessionError(new Error("network failure"))).toBeUndefined()
  })
})

describe("password login boundary", () => {
  const credential = { username: "synthetic-user", password: "synthetic-password" }
  const NOW = Date.UTC(2026, 9, 17, 12)
  const INTERVAL_MS = 60 * 1000
  const WINDOW_MS = 15 * 60 * 1000

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = new Map<string, string>()
    vi.stubGlobal("window", {})
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    })
    vi.spyOn(casProtocol, "prepareLogin").mockResolvedValue()
    vi.spyOn(casProtocol, "checkCaptchaNeeded").mockResolvedValue(false)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it.each([
    [new Error("synthetic transport failure"), ProviderErrorCode.UNKNOWN],
    [new LoginFailedError("synthetic credential failure"), ProviderErrorCode.AUTH_INVALID_CREDENTIAL],
    [new NeedCaptchaError("synthetic captcha failure after password submission"), ProviderErrorCode.AUTH_CAPTCHA_REQUIRED],
  ])("counts a rejected password once and permits retry at 60 seconds", async (failure, code) => {
    const passwordPost = vi.spyOn(casProtocol, "loginStep1").mockRejectedValue(failure)
    await expect(loginStep1(credential)).rejects.toMatchObject({ code })
    expect(checkRateLimit()).toEqual({
      allowed: false, retryAfterMs: INTERVAL_MS, reason: "interval",
    })
    vi.setSystemTime(NOW + INTERVAL_MS - 1)
    await expect(loginStep1(credential)).rejects.toMatchObject({
      code: ProviderErrorCode.RATE_LIMITED,
    })
    expect(passwordPost).toHaveBeenCalledTimes(1)
    expect(casProtocol.prepareLogin).toHaveBeenCalledTimes(1)
    vi.setSystemTime(NOW + INTERVAL_MS)
    await expect(loginStep1(credential)).rejects.toMatchObject({ code })
    expect(passwordPost).toHaveBeenCalledTimes(2)
    expect(checkRateLimit().reason).toBe("interval")
  })

  it("blocks the fourth normal password until the oldest of three attempts expires", async () => {
    const passwordPost = vi.spyOn(casProtocol, "loginStep1").mockRejectedValue(
      new LoginFailedError("synthetic credential failure")
    )
    for (let attempt = 0; attempt < 3; attempt++) {
      vi.setSystemTime(NOW + attempt * INTERVAL_MS)
      await expect(loginStep1(credential)).rejects.toMatchObject({
        code: ProviderErrorCode.AUTH_INVALID_CREDENTIAL,
      })
    }
    vi.setSystemTime(NOW + WINDOW_MS - 1)
    await expect(loginStep1(credential)).rejects.toMatchObject({
      code: ProviderErrorCode.RATE_LIMITED,
    })
    expect(passwordPost).toHaveBeenCalledTimes(3)
    vi.setSystemTime(NOW + WINDOW_MS)
    await expect(loginStep1(credential)).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_INVALID_CREDENTIAL,
    })
    expect(passwordPost).toHaveBeenCalledTimes(4)
    expect(checkRateLimit()).toEqual({
      allowed: false, retryAfterMs: INTERVAL_MS, reason: "window",
    })
  })

  it.each([1, 3])("honors explicit skip without checking or counting a blocked %i-attempt state", async (attempts) => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      vi.setSystemTime(NOW + attempt * INTERVAL_MS)
      recordLoginAttempt()
    }
    const limit = checkRateLimit()
    expect(limit.allowed).toBe(false)
    const passwordPost = vi.spyOn(casProtocol, "loginStep1").mockRejectedValue(
      new LoginFailedError("synthetic credential failure")
    )
    await expect(loginStep1(credential, true)).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_INVALID_CREDENTIAL,
    })
    expect(passwordPost).toHaveBeenCalledTimes(1)
    expect(checkRateLimit()).toEqual(limit)
    await expect(loginStep1(credential)).rejects.toMatchObject({
      code: ProviderErrorCode.RATE_LIMITED,
    })
    expect(passwordPost).toHaveBeenCalledTimes(1)
  })

  it.each(["prepareLogin", "checkCaptchaNeeded"] as const)(
    "does not count a failed %s preflight as a password submission",
    async (preflight) => {
      vi.mocked(casProtocol[preflight]).mockRejectedValue(
        new casProtocol.CASProtocolError("synthetic preflight failure")
      )
      const passwordPost = vi.spyOn(casProtocol, "loginStep1").mockRejectedValue(
        new Error("unexpected password submission")
      )
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(loginStep1(credential)).rejects.toMatchObject({
          code: ProviderErrorCode.BACKEND_PROTOCOL_ERROR,
        })
        expect(checkRateLimit()).toEqual({ allowed: true, retryAfterMs: 0, reason: null })
      }
      expect(casProtocol[preflight]).toHaveBeenCalledTimes(2)
      expect(passwordPost).not.toHaveBeenCalled()
    }
  )

  it.each([false, true])("prevents an empty-captcha password even with skip=%s", async (skipRateLimit) => {
    vi.mocked(casProtocol.checkCaptchaNeeded).mockResolvedValue(true)
    const passwordPost = vi.spyOn(casProtocol, "loginStep1").mockRejectedValue(
      new LoginFailedError("synthetic credential failure")
    )
    await expect(loginStep1({ ...credential, captcha: "   " }, skipRateLimit)).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_CAPTCHA_REQUIRED,
    })
    expect(passwordPost).not.toHaveBeenCalled()
    expect(checkRateLimit().allowed).toBe(true)
    await expect(loginStep1({ ...credential, captcha: "synthetic-captcha" }, skipRateLimit)).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_INVALID_CREDENTIAL,
    })
    expect(passwordPost).toHaveBeenCalledTimes(1)
    expect(checkRateLimit().allowed).toBe(skipRateLimit)
  })

  it("keeps captcha loading and MFA send/verify independent of the password window", async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      vi.setSystemTime(NOW + attempt * INTERVAL_MS)
      recordLoginAttempt()
    }
    const limit = checkRateLimit()
    expect(limit.reason).toBe("window")
    const passwordPost = vi.spyOn(casProtocol, "loginStep1").mockRejectedValue(
      new Error("unexpected password submission")
    )
    vi.spyOn(casProtocol, "getCaptchaImage").mockRejectedValue(new Error("synthetic image failure"))
    vi.spyOn(casProtocol, "requestMFACode").mockRejectedValue(
      new casProtocol.MFAFailedError("synthetic MFA send failure")
    )
    vi.spyOn(casProtocol, "submitMFACode").mockRejectedValue(
      new casProtocol.MFAFailedError("synthetic MFA verify failure")
    )

    await expect(getCaptchaImage()).rejects.toMatchObject({ code: ProviderErrorCode.UNKNOWN })
    await expect(requestMFACode(credential.username, "sms")).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_INVALID_CREDENTIAL,
    })
    await expect(submitMFACode({
      method: "sms", methodCode: "1", mobileHint: "", username: credential.username, raw: {},
    }, "synthetic-code")).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_INVALID_CREDENTIAL,
    })
    expect(checkRateLimit()).toEqual(limit)
    expect(passwordPost).not.toHaveBeenCalled()
  })

  it("sends only one normal password when asynchronous preflights overlap", async () => {
    const passwordPost = vi.spyOn(casProtocol, "loginStep1").mockRejectedValue(
      new Error("synthetic transport failure")
    )
    const outcomes = await Promise.allSettled([loginStep1(credential), loginStep1(credential)])
    expect(passwordPost).toHaveBeenCalledTimes(1)
    expect(outcomes.filter((outcome) =>
      outcome.status === "rejected" && outcome.reason.code === ProviderErrorCode.RATE_LIMITED
    )).toHaveLength(1)
    expect(checkRateLimit()).toEqual({
      allowed: false, retryAfterMs: INTERVAL_MS, reason: "interval",
    })
  })
})
