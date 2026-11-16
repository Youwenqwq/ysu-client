import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NetworkActivityRuntime } from "./activity"
import { classifyYsuRequest } from "@/plugins/official/ysu/activity"

let now = 0
let activity: NetworkActivityRuntime

beforeEach(() => {
  now = 0
  vi.spyOn(performance, "now").mockImplementation(() => now)
  activity = new NetworkActivityRuntime()
  activity.registerClassifier(classifyYsuRequest)
})

afterEach(() => {
  activity.dispose()
  vi.restoreAllMocks()
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
    expect(activity.classifyRequest(url)).toBe(category)
  })
})

describe("classifier independence", () => {
  it("does not assign school categories without a provider classifier", () => {
    const bare = new NetworkActivityRuntime()
    try {
      expect(
        bare.classifyRequest("https://jwxt.ysu.edu.cn/jwglxt/xtgl/login_slogin.html")
      ).toBe("other")
    } finally {
      bare.dispose()
    }
  })
})

describe("network activity", () => {
  it("tracks concurrent requests without exposing urls", () => {
    now = 100
    const finishAcademic = activity.beginRequest(
      "https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do?ticket=secret",
      "POST"
    )
    now = 140
    const finishAuth = activity.beginRequest(
      "https://cer.ysu.edu.cn/authserver/login?service=secret",
      "GET"
    )

    let snapshot = activity.getSnapshot()
    expect(snapshot.active).toHaveLength(2)
    expect(snapshot.active.map((entry) => entry.category)).toEqual(["academic", "auth"])
    expect(JSON.stringify(snapshot)).not.toContain("secret")

    now = 300
    finishAcademic("ok")
    now = 380
    finishAuth("error")

    snapshot = activity.getSnapshot()
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
    const firstAuth = activity.beginRequest("https://cer.ysu.edu.cn/authserver/index.do", "GET")
    now = 100
    firstAuth("ok")

    now = 500
    const academic = activity.beginRequest(
      "https://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do",
      "GET"
    )
    now = 600
    academic("ok")

    now = 700
    const secondAuth = activity.beginRequest("https://cer.ysu.edu.cn/authserver/login", "GET")
    now = 800
    secondAuth("ok")

    expect(activity.getSnapshot().session).toMatchObject({
      count: 3,
      slowestCategory: "auth",
      slowestMs: 800,
      totalMs: 800,
    })
  })

  it("uses provider labels for finer grouping without retaining urls", () => {
    activity.registerLabeler((url) =>
      url.includes("/pjapp/") ? "networkActivity.ysu.evaluation" : undefined
    )

    now = 0
    const finish = activity.beginRequest(
      "https://jwxt.ysu.edu.cn/jwapp/sys/pjapp/api/wdpj/getPjlx.do?secret=label",
      "POST"
    )
    expect(activity.getSnapshot().active[0]?.label).toBe("networkActivity.ysu.evaluation")
    now = 120
    finish()

    const snapshot = activity.getSnapshot()
    expect(snapshot.active).toHaveLength(0)
    expect(snapshot.session).toMatchObject({
      count: 1,
      slowestCategory: "academic",
      slowestLabel: "networkActivity.ysu.evaluation",
      slowestMs: 120,
    })
    expect(snapshot.history).toHaveLength(1)
    expect(snapshot.history[0]).toMatchObject({
      category: "academic",
      label: "networkActivity.ysu.evaluation",
      durationMs: 120,
      outcome: "ok",
    })
    expect(JSON.stringify(snapshot)).not.toContain("secret")
  })

  it("ignores a broken labeler", () => {
    activity.registerLabeler(() => {
      throw new Error("broken labeler")
    })

    now = 0
    const finish = activity.beginRequest("https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/xscjcx.do", "POST")
    now = 50
    finish()

    expect(activity.getSnapshot().session).toMatchObject({
      count: 1,
      slowestCategory: "academic",
      slowestMs: 50,
    })
    expect(activity.getSnapshot().session?.slowestLabel).toBeUndefined()
  })

  it("keeps one burst inside the idle window and resets after it", () => {
    now = 0
    const first = activity.beginRequest("https://cer.ysu.edu.cn/authserver/index.do", "GET")
    now = 100
    first("ok")

    now = 2_000
    const second = activity.beginRequest(
      "https://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do",
      "GET"
    )
    now = 2_050
    second("ok")
    expect(activity.getSnapshot().session).toMatchObject({ count: 2, totalMs: 2_050 })

    now = 4_051
    const third = activity.beginRequest(
      "https://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do",
      "GET"
    )
    now = 4_101
    third("ok")
    expect(activity.getSnapshot().session).toMatchObject({ count: 1, totalMs: 50 })
    expect(activity.getSnapshot().history).toHaveLength(1)
  })

  it("is idempotent and notifies only active subscribers", () => {
    const listener = vi.fn()
    const unsubscribe = activity.subscribe(listener)

    now = 0
    const finish = activity.beginRequest(
      "https://jwxt.ysu.edu.cn/jwglxt/xtgl/login_slogin.html",
      "GET"
    )
    expect(listener).toHaveBeenCalledTimes(1)
    now = 10
    finish()
    expect(listener).toHaveBeenCalledTimes(2)

    finish()
    expect(activity.getSnapshot().session).toMatchObject({ count: 1 })
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    const next = activity.beginRequest("https://jwxt.ysu.edu.cn/jwglxt/xtgl/login_slogin.html", "GET")
    next()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("returns a stable snapshot between publications", () => {
    const before = activity.getSnapshot()
    expect(activity.getSnapshot()).toBe(before)

    const finish = activity.beginRequest("https://jwxt.ysu.edu.cn/jwglxt/xtgl/login_slogin.html", "GET")
    expect(activity.getSnapshot()).not.toBe(before)
    finish()
  })
})

describe("runtime isolation", () => {
  it("starts a replacement runtime without inherited activity, labelers or classifiers", () => {
    const oldListener = vi.fn()
    activity.subscribe(oldListener)
    activity.registerLabeler((url) =>
      url.includes("/pjapp/") ? "networkActivity.test.label" : undefined
    )

    now = 0
    const oldFinish = activity.beginRequest(
      "https://jwxt.ysu.edu.cn/jwapp/sys/pjapp/api/wdpj/getPjlx.do",
      "GET"
    )
    expect(activity.getSnapshot().active[0]?.label).toBe("networkActivity.test.label")
    expect(oldListener).toHaveBeenCalledTimes(1)

    const replacement = new NetworkActivityRuntime()
    const replacementListener = vi.fn()
    replacement.subscribe(replacementListener)
    try {
      expect(replacement.getSnapshot()).toEqual({
        active: [],
        history: [],
        session: null,
        revision: 0,
      })
      expect(
        replacement.classifyRequest("https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do")
      ).toBe("other")

      const finish = replacement.beginRequest(
        "https://jwxt.ysu.edu.cn/jwapp/sys/pjapp/api/wdpj/getPjlx.do",
        "GET"
      )
      const snapshot = replacement.getSnapshot()
      expect(snapshot.active).toHaveLength(1)
      expect(snapshot.active[0]).toMatchObject({ category: "other", method: "GET" })
      expect(snapshot.active[0]?.label).toBeUndefined()
      expect(replacementListener).toHaveBeenCalledTimes(1)
      expect(oldListener).toHaveBeenCalledTimes(1)

      now = 50
      finish()
      expect(replacement.getSnapshot().session).toMatchObject({ count: 1 })
      expect(oldListener).toHaveBeenCalledTimes(1)
    } finally {
      replacement.dispose()
      oldFinish("ok")
    }
  })

  it("disposes listeners, labelers and classifiers with the runtime", () => {
    const listener = vi.fn()
    activity.subscribe(listener)
    activity.registerLabeler(() => "networkActivity.test.label")
    activity.dispose()

    expect(activity.getSnapshot()).toEqual({
      active: [],
      history: [],
      session: null,
      revision: 0,
    })
    expect(
      activity.classifyRequest("https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do")
    ).toBe("other")

    const finish = activity.beginRequest("https://cer.ysu.edu.cn/authserver/login", "GET")
    finish("ok")
    expect(listener).not.toHaveBeenCalled()
    expect(activity.getSnapshot().active).toHaveLength(0)
    expect(activity.getSnapshot().session).toBeNull()
    expect(activity.getSnapshot().history).toHaveLength(0)
  })

  it("resets accumulated activity while keeping the runtime usable", () => {
    now = 0
    const finish = activity.beginRequest("https://cer.ysu.edu.cn/authserver/index.do", "GET")
    now = 40
    finish()
    expect(activity.getSnapshot().session).toMatchObject({ count: 1 })

    activity.reset()
    expect(activity.getSnapshot()).toEqual({
      active: [],
      history: [],
      session: null,
      revision: 0,
    })

    const stale = activity.beginRequest("https://cer.ysu.edu.cn/authserver/index.do", "GET")
    activity.reset()
    now = 50
    stale()
    expect(activity.getSnapshot()).toEqual({
      active: [],
      history: [],
      session: null,
      revision: 0,
    })

    const next = activity.beginRequest("https://cer.ysu.edu.cn/authserver/index.do", "GET")
    expect(activity.getSnapshot().active).toHaveLength(1)
    now = 60
    next()
    expect(activity.getSnapshot().session).toMatchObject({ count: 1 })
  })

  it("discards in-flight results once disposed", () => {
    const listener = vi.fn()
    activity.subscribe(listener)

    now = 0
    const finish = activity.beginRequest("https://cer.ysu.edu.cn/authserver/index.do", "GET")
    expect(activity.getSnapshot().active).toHaveLength(1)
    expect(listener).toHaveBeenCalledTimes(1)

    activity.dispose()
    now = 10
    finish("ok")

    expect(listener).toHaveBeenCalledTimes(1)
    expect(activity.getSnapshot().active).toHaveLength(0)
    expect(activity.getSnapshot().history).toHaveLength(0)
  })
})
