import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  beginRequest,
  classifyRequest,
  networkActivity,
  registerActivityLabeler,
  resetNetworkActivity,
} from "./activity"

let now = 0

beforeEach(() => {
  resetNetworkActivity()
  now = 0
  vi.spyOn(performance, "now").mockImplementation(() => now)
})

afterEach(() => {
  vi.restoreAllMocks()
  resetNetworkActivity()
})

describe("classifyRequest", () => {
  it.each([
    ["https://cer.ysu.edu.cn/authserver/login?service=secret", "auth"],
    ["https://jwxt.ysu.edu.cn/jwglxt/xtgl/login_slogin.html", "academic"],
    ["https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do", "academic"],
    ["https://jwxt.ysu.edu.cn/jwmobile/biz/v410/course", "mobile"],
    ["https://ehall.ysu.edu.cn/publicapp/sys/myyktzd/index.do", "one-stop"],
    ["https://epay.ysu.edu.cn/pay/allPay.html", "payment"],
    ["https://open.weixin.qq.com/connect/qrcode/uuid", "wechat"],
    ["https://xgxt.ysu.edu.cn/xsfw/sys/app/index.do", "campus"],
    ["https://ldxt.ysu.edu.cn/System/Home/Index", "campus"],
    ["https://example.com/anything", "other"],
    ["not a url", "other"],
  ])("classifies %s as %s", (url, category) => {
    expect(classifyRequest(url)).toBe(category)
  })
})

describe("network activity", () => {
  it("tracks concurrent requests without exposing urls", () => {
    now = 100
    const finishAcademic = beginRequest(
      "https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do?ticket=secret",
      "POST"
    )
    now = 140
    const finishAuth = beginRequest("https://cer.ysu.edu.cn/authserver/login?service=secret", "GET")

    let snapshot = networkActivity.getSnapshot()
    expect(snapshot.active).toHaveLength(2)
    expect(snapshot.active.map((entry) => entry.category)).toEqual(["academic", "auth"])
    expect(JSON.stringify(snapshot)).not.toContain("secret")

    now = 300
    finishAcademic("ok")
    now = 380
    finishAuth("error")

    snapshot = networkActivity.getSnapshot()
    expect(snapshot.active).toHaveLength(0)
    expect(snapshot.session).toMatchObject({
      count: 2,
      failed: 1,
      totalMs: 280,
      slowestCategory: "auth",
      slowestMs: 240,
    })
  })

  it("measures the longest category span, not the slowest single request", () => {
    now = 0
    const firstAuth = beginRequest("https://cer.ysu.edu.cn/authserver/index.do", "GET")
    now = 100
    firstAuth("ok")

    now = 500
    const academic = beginRequest(
      "https://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do",
      "GET"
    )
    now = 600
    academic("ok")

    now = 700
    const secondAuth = beginRequest("https://cer.ysu.edu.cn/authserver/login", "GET")
    now = 800
    secondAuth("ok")

    expect(networkActivity.getSnapshot().session).toMatchObject({
      count: 3,
      slowestCategory: "auth",
      slowestMs: 800,
      totalMs: 800,
    })
  })

  it("uses provider labels for finer grouping without retaining urls", () => {
    registerActivityLabeler((url) =>
      url.includes("/pjapp/") ? "networkActivity.ysu.evaluation" : undefined
    )

    now = 0
    const finish = beginRequest(
      "https://jwxt.ysu.edu.cn/jwapp/sys/pjapp/api/wdpj/getPjlx.do?secret=label",
      "POST"
    )
    expect(networkActivity.getSnapshot().active[0]?.label).toBe("networkActivity.ysu.evaluation")
    now = 120
    finish()

    const snapshot = networkActivity.getSnapshot()
    expect(snapshot.active).toHaveLength(0)
    expect(snapshot.session).toMatchObject({
      count: 1,
      slowestCategory: "academic",
      slowestLabel: "networkActivity.ysu.evaluation",
      slowestMs: 120,
    })
    expect(JSON.stringify(snapshot)).not.toContain("secret")
  })

  it("ignores a broken labeler", () => {
    registerActivityLabeler(() => {
      throw new Error("broken labeler")
    })

    now = 0
    const finish = beginRequest("https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/xscjcx.do", "POST")
    now = 50
    finish()

    expect(networkActivity.getSnapshot().session).toMatchObject({
      count: 1,
      slowestCategory: "academic",
      slowestMs: 50,
    })
    expect(networkActivity.getSnapshot().session?.slowestLabel).toBeUndefined()
  })

  it("keeps one burst inside the idle window and resets after it", () => {
    now = 0
    const first = beginRequest("https://cer.ysu.edu.cn/authserver/index.do", "GET")
    now = 100
    first("ok")

    now = 2_000
    const second = beginRequest("https://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do", "GET")
    now = 2_050
    second("ok")
    expect(networkActivity.getSnapshot().session).toMatchObject({ count: 2, totalMs: 2_050 })

    now = 4_051
    const third = beginRequest("https://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do", "GET")
    now = 4_101
    third("ok")
    expect(networkActivity.getSnapshot().session).toMatchObject({ count: 1, totalMs: 50 })
  })

  it("is idempotent and notifies only active subscribers", () => {
    const listener = vi.fn()
    const unsubscribe = networkActivity.subscribe(listener)

    now = 0
    const finish = beginRequest("https://jwxt.ysu.edu.cn/jwglxt/xtgl/login_slogin.html", "GET")
    expect(listener).toHaveBeenCalledTimes(1)
    now = 10
    finish()
    expect(listener).toHaveBeenCalledTimes(2)

    finish()
    expect(networkActivity.getSnapshot().session).toMatchObject({ count: 1 })
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    const next = beginRequest("https://jwxt.ysu.edu.cn/jwglxt/xtgl/login_slogin.html", "GET")
    next()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("returns a stable snapshot between publications", () => {
    const before = networkActivity.getSnapshot()
    expect(networkActivity.getSnapshot()).toBe(before)

    const finish = beginRequest("https://jwxt.ysu.edu.cn/jwglxt/xtgl/login_slogin.html", "GET")
    expect(networkActivity.getSnapshot()).not.toBe(before)
    finish()
  })
})
