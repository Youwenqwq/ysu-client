import { beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpResponse } from "@orahako/plugin-sdk"
import {
  createCAS,
  CASProtocolError,
  NotAuthenticatedError,
  type CASProtocol,
} from "./cas"
import { createTestContext } from "../test-context"

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

const fetchWithJar = vi.fn()
let cas: CASProtocol

beforeEach(() => {
  vi.clearAllMocks()
  cas = createCAS(createTestContext({ fetchWithJar }).ctx)
  cas.resetCAS()
})

describe("CAS service authorization boundaries", () => {
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
})
