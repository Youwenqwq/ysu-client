import { beforeEach, describe, expect, it, vi } from "vitest"
import type * as MacModule from "@/lib/native/macos"

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  authorize: vi.fn(),
  persist: vi.fn(),
}))
vi.mock("@/lib/native/macos", async (importOriginal) => ({
  ...(await importOriginal<typeof MacModule>()),
  isMacOSApp: true,
  macHttpRequest: mocks.request,
}))
vi.mock("./cas", () => ({ authorize: mocks.authorize }))
vi.mock("@/lib/stores/auth", () => ({
  useAuthStore: { getState: () => ({ setMobileSession: mocks.persist }) },
}))

import { fetchWithJar } from "@/lib/cookie"
import { bytesToBase64 } from "@/lib/native/macos"
import { getJwxtCookieDomain, mobileUrls, casUrls } from "@/lib/server-config"
import {
  ensureMobileAuthorized,
  getJar,
  MobileBusinessError,
  MobileNotLoggedInError,
  MobileProtocolError,
  MobileSession,
  querySigninDetail,
  resetMobileAuth,
  restoreSession,
} from "./jwmobile"

const token = "synthetic-mobile-token"

function response(body: string, status = 200, url = mobileUrls.userInfo) {
  return {
    status,
    url,
    headers: { "content-type": "application/json" },
    bodyBase64: bytesToBase64(new TextEncoder().encode(body)),
  }
}

async function restoreToken() {
  await restoreSession(new MobileSession([{
    name: "Authorization",
    value: token,
    domain: getJwxtCookieDomain(),
    path: mobileUrls.cookiePath,
    secure: true,
    expires: null,
  }]))
}

beforeEach(() => {
  vi.resetAllMocks()
  resetMobileAuth()
  mocks.authorize.mockRejectedValue(new Error("Unexpected CAS authorization"))
})

describe("mobile token transport and verification", () => {
  it("does not leak mobile credentials into subsequent CAS requests", async () => {
    await restoreToken()
    mocks.request
      .mockResolvedValueOnce(response('{"code":200}'))
      .mockResolvedValueOnce(response('{"code":200,"data":{"duration":30}}'))
      .mockResolvedValueOnce(response("", 200, casUrls.authIndex))

    await ensureMobileAuthorized(true)
    await querySigninDetail({ activityId: "synthetic-activity" })
    await fetchWithJar(getJar(), { method: "GET", url: casUrls.authIndex, redirect: "manual" })

    const cas = mocks.request.mock.calls[2]![0]
    expect(cas.headers.Authorization).toBeUndefined()
    expect(cas.headers.Cookie ?? "").not.toContain(token)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it.each([
    [401, '{"code":200}', MobileNotLoggedInError],
    [404, "", MobileProtocolError],
    [200, "<html>Login</html>", MobileProtocolError],
    [200, "null", MobileProtocolError],
    [200, '{"code":401}', MobileNotLoggedInError],
    [200, '{"code":500,"msg":"Unavailable"}', MobileBusinessError],
  ])("rejects invalid verification responses without authorizing again (%s, %s)", async (status, body, error) => {
    await restoreToken()
    mocks.request.mockResolvedValue(response(body, status))
    await expect(ensureMobileAuthorized(true)).rejects.toBeInstanceOf(error)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.persist).not.toHaveBeenCalled()
  })

  it("does not retry a business request or authorize again after session rejection", async () => {
    await restoreToken()
    mocks.request.mockResolvedValue(response('{"code":401}'))
    await expect(querySigninDetail({ activityId: "synthetic-activity" }))
      .rejects.toBeInstanceOf(MobileNotLoggedInError)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.authorize).not.toHaveBeenCalled()
  })
})
