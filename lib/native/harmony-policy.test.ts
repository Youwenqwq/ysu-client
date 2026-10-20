import { describe, expect, it } from "vitest"
import { assertHarmonyRequest } from "./harmony-policy"
import policy from "../../harmony/security-policy.json"

const official = "https://jwxt.ysu.edu.cn"

describe("Harmony local-only security policy", () => {
  it("allows reviewed read-only POSTs and the explicit student evaluation exception", () => {
    expect(() =>
      assertHarmonyRequest("POST", `${official}/jwapp/sys/cjcx/modules/cjcx/xscjcx.do`)
    ).not.toThrow()
    expect(() =>
      assertHarmonyRequest(
        "POST",
        `${official}/jwapp/sys/pjapp/api/wdpj/commitQuestionnaireAnswer.do`
      )
    ).not.toThrow()
  })

  it.each([
    "https://ysu.welain.com/api/proxy?url=https://jwxt.ysu.edu.cn",
    "https://jwxt.ysu.edu.cn.evil.example/jwapp/sys/cjcx/modules/cjcx/xscjcx.do",
    "https://jwxt.ysu.edu.cn@evil.example/jwapp/sys/cjcx/modules/cjcx/xscjcx.do",
    "https://attacker@jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do",
    "http://jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do",
    "https://jwxt.ysu.edu.cn:8443/jwapp/sys/cjcx/modules/cjcx/xscjcx.do",
    "https://127.0.0.1/jwapp/sys/cjcx/modules/cjcx/xscjcx.do",
    "https://xqh5.17wanxiao.com/smartWaterAndElectricityService/SWAEEncryptServlet",
    "https://open.weixin.qq.com/connect/qrconnect",
  ])("rejects proxies, third parties and alternate authorities: %s", (input) => {
    expect(() => assertHarmonyRequest("POST", input)).toThrow()
  })

  it.each([
    "/jwapp/sys/bkbl/modules/bkbm/xgksrwxs.do",
    "/jwapp/sys/xywccx/modules/xywccx/bysc.do",
    "/jwmobile/biz/v410/signin/sign",
    "/jwapp/sys/cjcx/modules/cjcx/delete.do",
    "/jwapp/sys/cjcx/modules/cjcx/%78scjcx.do",
  ])("rejects unreviewed actions even on the official host: %s", (path) => {
    expect(() => assertHarmonyRequest("POST", `${official}${path}`)).toThrow()
  })

  it("validates authentication callbacks before credentials are sent", () => {
    const url = "https://cer.ysu.edu.cn/authserver/login"
    expect(() =>
      assertHarmonyRequest("POST", url, "service=https%3A%2F%2Fevil.example%2F")
    ).toThrow()
    expect(() =>
      assertHarmonyRequest(
        "POST",
        url,
        `service=${encodeURIComponent(`${official}/jwapp/sys/emaphome/portal/index.do`)}`
      )
    ).not.toThrow()
    expect(() =>
      assertHarmonyRequest(
        "GET",
        `${url}?service=${encodeURIComponent("https://ysu.welain.com/api/proxy")}`
      )
    ).toThrow()
    expect(() =>
      assertHarmonyRequest(
        "POST",
        url,
        `service=${encodeURIComponent(`${official}/jwapp/sys/emaphome/portal/index.do`)}&service=https%3A%2F%2Fevil.example%2F`
      )
    ).toThrow()
  })

  it("limits methods per endpoint and never permits payment or registration actions", () => {
    expect(() =>
      assertHarmonyRequest("DELETE", `${official}/jwapp/sys/cjcx/modules/cjcx/xscjcx.do`)
    ).toThrow()
    expect(
      policy.routes.filter((route) => /bysc|xgksrwxs|signin|payment|recharge/.test(route.path))
    ).toEqual([])
    expect(
      policy.routes.every((route) => /^https:\/\/[a-z]+\.ysu\.edu\.cn$/.test(route.origin))
    ).toBe(true)
  })
})
