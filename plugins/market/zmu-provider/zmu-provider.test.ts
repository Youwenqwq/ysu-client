import { beforeEach, describe, expect, it } from "vitest"
import { useAuthStore } from "@orahako/plugin-sdk/host"
import { ProviderErrorCode } from "@orahako/plugin-sdk/provider-errors"
import { ZMUClient } from "./protocol/client"
import { ZMUProvider } from "./zmu-provider"

function jsonResponse(body: unknown) {
  return {
    status: 200,
    headers: {},
    url: "",
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

beforeEach(() => {
  useAuthStore.getState().activateSchool("zmu")
  useAuthStore.getState().clearCredential("zmu")
})

describe("ZMUProvider auth", () => {
  it("requires the captcha before sending a login request", async () => {
    const provider = new ZMUProvider()
    await expect(
      provider.loginStep1({ username: "student", password: "secret" })
    ).rejects.toMatchObject({ code: ProviderErrorCode.AUTH_CAPTCHA_REQUIRED, status: 403 })
  })

  it("returns a restorable session credential and clears it on logout", async () => {
    const client = new ZMUClient(async (jar, request) => {
      if (request.url.endsWith("/")) {
        await jar.setCookie("JSESSIONID=zmu-session; Path=/", request.url)
        return jsonResponse('<form id="login-form"><input name="account"></form>')
      }
      if (request.url.endsWith("/new/login")) {
        return jsonResponse({ code: 0, message: "成功", data: { url: "/new/welcome.page" } })
      }
      return jsonResponse("")
    })
    const provider = new ZMUProvider(client)
    await provider.prepareLogin()
    await provider.checkCaptchaNeeded("student")
    await provider.login({
      username: "student",
      password: "secret",
      metadata: { captcha: "2enb" },
    })
    expect(useAuthStore.getState().credential).toContain("zmu-session")
    expect(provider.isAuthenticated()).toBe(true)
    await provider.logout()
    expect(useAuthStore.getState().credential).toBeNull()
    expect(provider.isAuthenticated()).toBe(false)
  })

  it("provides all twelve period rows required by the schedule grid", async () => {
    const periods = await new ZMUProvider().getClassPeriods()
    expect(periods.map((period) => period.section)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(periods.every((period) => period.isInUse)).toBe(true)
  })

  it("maps a wrong captcha to the existing captcha error contract", async () => {
    const provider = new ZMUProvider(
      new ZMUClient(async () => jsonResponse({ code: -1, message: "验证码不正确" }))
    )
    await expect(
      provider.loginStep1({ username: "student", password: "secret", captcha: "bad1" })
    ).rejects.toMatchObject({ code: ProviderErrorCode.AUTH_CAPTCHA_REQUIRED, status: 403 })
  })
})
