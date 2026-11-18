import { beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpResponse } from "@orahako/sdk"
import {
  CASProtocolError,
  createCAS,
  MFAFailedError,
  NotAuthenticatedError,
  type CASProtocol,
} from "../src/protocol/cas"
import { YSU_SECURE_KEY_CAS_TGC } from "../src/ysu-config"
import { createTestContext, type JarFetch } from "./test-helper"

const service = "https://epay.ysu.edu.cn/pay/allPay.html"

function response(
  url: string,
  status = 200,
  body = "",
  headers: Record<string, string> = {}
): HttpResponse {
  return {
    status,
    url,
    headers,
    text: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

const LOGIN_FORM_HTML = `
  <html><body>
    <form id="pwdFromId">
      <input type="hidden" name="cllt" value="userNameLogin" />
      <input type="hidden" name="execution" value="e1s1" />
      <input type="hidden" name="pwdEncryptSalt" value="1234567890123456" />
    </form>
  </body></html>
`

const fetchWithJar = vi.fn<JarFetch>()
let cas: CASProtocol

beforeEach(() => {
  vi.clearAllMocks()
  cas = createCAS(createTestContext({ fetchWithJar }).ctx)
  cas.resetCAS()
})

describe("CAS service authorization boundaries & isAuthenticated verification", () => {
  it("rejects secondary authentication instead of establishing a service session", async () => {
    fetchWithJar.mockResolvedValue(
      response(
        "https://cer.ysu.edu.cn/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true"
      )
    )
    await expect(cas.authorize(service)).rejects.toBeInstanceOf(NotAuthenticatedError)
  })

  it("keeps service outages distinct from expired credentials", async () => {
    fetchWithJar.mockResolvedValue(response(service, 502))
    await expect(cas.authorize(service)).rejects.toBeInstanceOf(CASProtocolError)
  })

  it("does not copy an old authorization response into a replacement account jar", async () => {
    const entered = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<HttpResponse>()
    const { ctx } = createTestContext({ fetchWithJar })
    cas = createCAS(ctx)
    cas.resetCAS()
    const target = ctx.session.createCookieJar()
    fetchWithJar.mockImplementation(() => {
      entered.resolve()
      return pending.promise
    })
    const result = cas.authorize(service, target)
    const rejected = expect(result).rejects.toBeInstanceOf(NotAuthenticatedError)
    await entered.promise
    cas.resetCAS()
    await target.setCookie(
      "CASTGC=old-account; Path=/authserver",
      "https://cer.ysu.edu.cn/authserver/login"
    )
    pending.resolve(response(service))
    await rejected
    expect(
      await cas.getJar().getCookieString("https://cer.ysu.edu.cn/authserver/index.do")
    ).not.toContain("old-account")
  })

  it("does not mark a temporary CAS outage as confirmed session expiry", async () => {
    fetchWithJar.mockResolvedValue(response("https://cer.ysu.edu.cn/authserver/index.do", 503))
    await expect(cas.isAuthenticated()).rejects.toBeInstanceOf(CASProtocolError)
  })

  it("requires isAuthenticated() confirmation before marking loginStep1 authenticated when CAS redirects to reAuth", async () => {
    const { ctx, secureStore } = createTestContext({ fetchWithJar })
    cas = createCAS(ctx)

    fetchWithJar
      // 1. getLoginPage
      .mockResolvedValueOnce(
        response("https://cer.ysu.edu.cn/authserver/login", 200, LOGIN_FORM_HTML)
      )
      // 2. POST login -> looks like service redirect with ticket
      .mockResolvedValueOnce(
        response("https://cer.ysu.edu.cn/authserver/login", 302, "", {
          location: "https://cer.ysu.edu.cn/personalInfo/personCenter/index.html?ticket=ST-1",
        })
      )
      // 3. GET ticket URL
      .mockResolvedValueOnce(
        response("https://cer.ysu.edu.cn/personalInfo/personCenter/index.html?ticket=ST-1", 200)
      )
      // 4. inspectAuthStatus() -> CAS actually bounces /authserver/index.do to reAuthCheck!
      .mockResolvedValueOnce(
        response("https://cer.ysu.edu.cn/authserver/index.do", 302, "", {
          location:
            "https://cer.ysu.edu.cn/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true",
        })
      )

    const result = await cas.loginStep1("20260001", "secret")
    expect(result).toEqual({
      authenticated: false,
      needsMfa: true,
      username: "20260001",
    })
    expect(secureStore.get(YSU_SECURE_KEY_CAS_TGC)).toBeUndefined()
  })

  it("persists CASTGC and marks loginStep1 authenticated once isAuthenticated() confirms the session", async () => {
    const { ctx, secureStore } = createTestContext({ fetchWithJar })
    cas = createCAS(ctx)

    fetchWithJar
      .mockResolvedValueOnce(
        response("https://cer.ysu.edu.cn/authserver/login", 200, LOGIN_FORM_HTML)
      )
      .mockImplementationOnce(async (jar) => {
        await jar.setCookie(
          "CASTGC=TGT-verified; Domain=cer.ysu.edu.cn; Path=/authserver; Secure",
          "https://cer.ysu.edu.cn/authserver/login"
        )
        return response("https://cer.ysu.edu.cn/authserver/login", 302, "", {
          location: "https://cer.ysu.edu.cn/personalInfo/personCenter/index.html?ticket=ST-2",
        })
      })
      .mockResolvedValueOnce(
        response("https://cer.ysu.edu.cn/personalInfo/personCenter/index.html?ticket=ST-2", 200)
      )
      .mockResolvedValueOnce(
        response("https://cer.ysu.edu.cn/authserver/index.do", 302, "", {
          location: "https://cer.ysu.edu.cn/personalInfo/personCenter/index.html",
        })
      )

    const result = await cas.loginStep1("20260001", "secret")
    expect(result).toEqual({
      authenticated: true,
      needsMfa: false,
      username: "20260001",
    })
    expect(secureStore.get(YSU_SECURE_KEY_CAS_TGC)).toBe("TGT-verified")
  })

  it("verifies isAuthenticated() on submitMFACode before returning a credential", async () => {
    fetchWithJar
      .mockResolvedValueOnce(
        response("https://cer.ysu.edu.cn/authserver/reAuthCheck/reAuthSubmit.do", 302, "", {
          location: "https://cer.ysu.edu.cn/personalInfo/personCenter/index.html?ticket=ST-3",
        })
      )
      .mockResolvedValueOnce(
        response("https://cer.ysu.edu.cn/personalInfo/personCenter/index.html", 200)
      )
      // Still unauthenticated on /authserver/index.do!
      .mockResolvedValueOnce(
        response("https://cer.ysu.edu.cn/authserver/index.do", 302, "", {
          location: "https://cer.ysu.edu.cn/authserver/login",
        })
      )

    await expect(
      cas.submitMFACode(
        {
          method: "sms",
          methodCode: "3",
          mobileHint: "138****0000",
          username: "20260001",
          raw: {},
        },
        "123456"
      )
    ).rejects.toBeInstanceOf(MFAFailedError)
  })
})
