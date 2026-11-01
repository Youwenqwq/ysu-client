import { beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpResponse } from "@/lib/cookie"
import type * as CookieModule from "@/lib/cookie"

const mocks = vi.hoisted(() => ({ fetchWithJar: vi.fn() }))
vi.mock("@/lib/cookie", async (importOriginal) => ({
  ...(await importOriginal<typeof CookieModule>()),
  fetchWithJar: mocks.fetchWithJar,
}))
vi.mock("@/lib/storage/secure", () => ({
  saveCASTGC: vi.fn().mockResolvedValue(undefined),
  loadCASTGC: vi.fn().mockResolvedValue(null),
}))

import { SimpleCookieJar } from "@/lib/cookie"
import {
  authorize,
  CASProtocolError,
  getJar,
  getCaptchaImage,
  isAuthenticated,
  prepareLogin,
  NotAuthenticatedError,
  resetCAS,
} from "./cas"

const service = "https://epay.ysu.edu.cn/pay/allPay.html"
function response(url: string, status = 200, body = ""): HttpResponse {
  return {
    status,
    url,
    headers: {},
    text: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetCAS()
})

describe("CAS service authorization boundaries", () => {
  it("rejects secondary authentication instead of establishing a service session", async () => {
    mocks.fetchWithJar.mockResolvedValue(
      response(
        "https://cer.ysu.edu.cn/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true"
      )
    )
    await expect(authorize(service)).rejects.toBeInstanceOf(NotAuthenticatedError)
  })

  it("keeps service outages distinct from expired credentials", async () => {
    mocks.fetchWithJar.mockResolvedValue(response(service, 502))
    await expect(authorize(service)).rejects.toBeInstanceOf(CASProtocolError)
  })

  it("does not copy an old authorization response into a replacement account jar", async () => {
    const entered = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<HttpResponse>()
    const target = new SimpleCookieJar()
    mocks.fetchWithJar.mockImplementation(() => {
      entered.resolve()
      return pending.promise
    })
    const result = authorize(service, target)
    const rejected = expect(result).rejects.toBeInstanceOf(NotAuthenticatedError)
    await entered.promise
    resetCAS()
    await target.setCookie(
      "CASTGC=old-account; Path=/authserver",
      "https://cer.ysu.edu.cn/authserver/login"
    )
    pending.resolve(response(service))
    await rejected
    expect(
      await getJar().getCookieString("https://cer.ysu.edu.cn/authserver/index.do")
    ).not.toContain("old-account")
  })

  it("does not mark a temporary CAS outage as confirmed session expiry", async () => {
    mocks.fetchWithJar.mockResolvedValue(
      response("https://cer.ysu.edu.cn/authserver/index.do", 503)
    )
    await expect(isAuthenticated()).rejects.toBeInstanceOf(CASProtocolError)
  })
})

describe("CAS login preparation", () => {
  it("drops rejected TGC cookies without retrying the returned login page", async () => {
    await getJar().setCookie(
      "CASTGC=synthetic-stale-session; Path=/authserver",
      "https://cer.ysu.edu.cn/authserver/login"
    )
    mocks.fetchWithJar.mockResolvedValueOnce(
      response(
        "https://cer.ysu.edu.cn/authserver/login",
        200,
        '<form><input name="execution" value="synthetic-execution"></form>'
      )
    )

    await prepareLogin()

    expect(mocks.fetchWithJar).toHaveBeenCalledTimes(1)
    expect(await getJar().getCookieString("https://cer.ysu.edu.cn/authserver/login"))
      .not.toContain("CASTGC=")
  })
})

describe("CAS captcha images", () => {
  it("preserves captcha image MIME and binary bytes in a data URL", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0x00, 0x80, 0xff])
    mocks.fetchWithJar.mockResolvedValue({
      ...response("https://cer.ysu.edu.cn/authserver/getCaptcha.htl"),
      headers: { "content-type": "image/jpeg; charset=binary" },
      arrayBuffer: async () => bytes.buffer,
    })

    expect(await getCaptchaImage()).toBe("data:image/jpeg;base64,/9gAgP8=")
  })

  it("rejects login/error HTML instead of presenting it as a captcha image", async () => {
    mocks.fetchWithJar.mockResolvedValue({
      ...response("https://cer.ysu.edu.cn/authserver/login"),
      headers: { "content-type": "text/html" },
    })
    await expect(getCaptchaImage()).rejects.toBeInstanceOf(CASProtocolError)
  })
})
