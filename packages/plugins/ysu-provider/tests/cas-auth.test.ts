import { describe, expect, it, vi } from "vitest"
import { ProviderErrorCode } from "@orahako/academic-sdk"
import { createCasAuth } from "../src/cas-auth"
import { createCAS, NotAuthenticatedError } from "../src/protocol/cas"
import { createTestContext, textResponse } from "./test-helper"

describe("CAS auth wrapper", () => {
  it("converts a CAS login bounce into a user-facing session error", () => {
    const { ctx } = createTestContext()
    const { mapCASSessionError } = createCasAuth(ctx, createCAS(ctx))
    const error = mapCASSessionError(
      new NotAuthenticatedError("CAS bounced back to login page; TGC missing or expired")
    )

    expect(error?.code).toBe(ProviderErrorCode.AUTH_SESSION_EXPIRED)
    expect(error?.status).toBe(401)
    expect(error?.message).not.toContain("CAS bounced back")
  })

  it("leaves unrelated errors for their owning mapper", () => {
    const { ctx } = createTestContext()
    const { mapCASSessionError } = createCasAuth(ctx, createCAS(ctx))
    expect(mapCASSessionError(new Error("network failure"))).toBeUndefined()
  })

  it("enforces loginStep1 rate limiting unless skipRateLimit is true", async () => {
    const fetchWithJar = vi.fn(async (_jar, req) => {
      if (req.url.includes("/authserver/index.do")) {
        return textResponse("https://cer.ysu.edu.cn/authserver/index.do", "", 302, {
          location: "https://cer.ysu.edu.cn/personalInfo/personCenter/index.html",
        })
      }
      return textResponse("https://cer.ysu.edu.cn/personalInfo/personCenter/index.html", "ok")
    })
    const { ctx } = createTestContext({ fetchWithJar })
    const auth = createCasAuth(ctx, createCAS(ctx))

    await expect(auth.loginStep1({ username: "u1", password: "p1" })).resolves.toMatchObject({
      authenticated: true,
    })

    // Immediate second attempt within 60s hits interval limit
    await expect(auth.loginStep1({ username: "u1", password: "p1" })).rejects.toMatchObject({
      code: ProviderErrorCode.RATE_LIMITED,
      status: 429,
    })

    // skipRateLimit bypasses rate limiter
    await expect(auth.loginStep1({ username: "u1", password: "p1" }, true)).resolves.toMatchObject({
      authenticated: true,
    })
  })

  it("rejects unsupported MFA methods with FEATURE_NOT_SUPPORTED", async () => {
    const { ctx } = createTestContext()
    const auth = createCasAuth(ctx, createCAS(ctx))
    await expect(auth.requestMFACode("20260001", "totp")).rejects.toMatchObject({
      code: ProviderErrorCode.FEATURE_NOT_SUPPORTED,
      status: 501,
    })
  })
})
