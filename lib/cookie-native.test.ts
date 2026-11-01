import { beforeEach, describe, expect, it, vi } from "vitest"

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock("@/lib/native/platform", () => ({
  isCapacitor: () => true,
}))

vi.mock("@capacitor/core", () => ({
  CapacitorHttp: {
    request: requestMock,
  },
  CapacitorCookies: {
    getCookies: vi.fn().mockResolvedValue({}),
  },
}))

const { fetchStateless } = await import("./cookie")

describe("CapacitorHttp binary response", () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it("保留自动跳转请求的 arraybuffer 类型并还原图片字节", async () => {
    requestMock.mockResolvedValue({
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
      url: "http://b1.cdn.zanao.com/avatar.jpeg@!sm_w100_h100",
      data: "/9j/",
    })

    const response = await fetchStateless({
      method: "GET",
      url: "http://b1.cdn.zanao.com/avatar.jpeg@!sm_w100_h100",
      redirect: "follow",
      responseType: "arraybuffer",
    })

    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]))
  })

  it("discards an in-flight native response when its signal was aborted", async () => {
    const controller = new AbortController()
    const entered = Promise.withResolvers<void>()
    const pending = Promise.withResolvers<{
      status: number
      headers: Record<string, string>
      url: string
      data: string
    }>()
    requestMock.mockImplementation(() => {
      entered.resolve()
      return pending.promise
    })
    const result = fetchStateless({
      method: "GET",
      url: "https://cer.ysu.edu.cn/authserver/login",
      redirect: "follow",
      signal: controller.signal,
    })
    await entered.promise
    controller.abort()
    pending.resolve({
      status: 200,
      headers: {},
      url: "https://cer.ysu.edu.cn/authserver/login",
      data: "discarded",
    })
    await expect(result).rejects.toMatchObject({ name: "AbortError" })
  })
})

describe("redirect credential isolation", () => {
  it("keeps same-origin authorization but never forwards or restores it across origins", async () => {
    requestMock.mockReset()
    const urls = [
      "https://mobile.test/start",
      "https://mobile.test/next",
      "https://other.test/redirect",
      "https://mobile.test/complete",
    ]
    const observedAuthorization: (string | undefined)[] = []
    requestMock.mockImplementation(async (request: {
      url: string
      headers: Record<string, string>
    }) => {
      observedAuthorization.push(
        Object.entries(request.headers).find(([name]) => name.toLowerCase() === "authorization")?.[1]
      )
      const index = urls.indexOf(request.url)
      if (index < 0) throw new Error("Unexpected redirect destination")
      return {
        status: index < urls.length - 1 ? 302 : 200,
        headers: index < urls.length - 1 ? { Location: urls[index + 1]! } : {},
        url: request.url,
        data: "complete",
      }
    })

    const response = await fetchStateless({
      method: "GET",
      url: urls[0]!,
      headers: { aUtHoRiZaTiOn: "synthetic-mobile-token" },
      redirect: "follow",
    })

    expect(response.status).toBe(200)
    expect(observedAuthorization).toEqual([
      "synthetic-mobile-token",
      "synthetic-mobile-token",
      undefined,
      undefined,
    ])
  })
})
