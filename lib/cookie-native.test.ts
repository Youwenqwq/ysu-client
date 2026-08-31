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

  it("使用 arraybuffer 请求并将原生 base64 响应还原为图片字节", async () => {
    requestMock.mockResolvedValue({
      status: 200,
      headers: { "Content-Type": "image/jpeg" },
      url: "http://b1.cdn.zanao.com/avatar.jpeg@!sm_w100_h100",
      data: "/9j/",
    })

    const response = await fetchStateless({
      method: "GET",
      url: "http://b1.cdn.zanao.com/avatar.jpeg@!sm_w100_h100",
      redirect: "manual",
      responseType: "arraybuffer",
    })

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: "arraybuffer",
      })
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]))
  })
})
