import { beforeEach, describe, expect, it, vi } from "vitest"

const { requestMock, getCookiesMock, setCookieMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
  getCookiesMock: vi.fn(),
  setCookieMock: vi.fn(),
}))

vi.mock("@orahako/plugin-sdk/native", () => ({
  isCapacitor: () => true,
}))

vi.mock("@capacitor/core", () => ({
  CapacitorHttp: {
    request: requestMock,
  },
  CapacitorCookies: {
    getCookies: getCookiesMock,
    setCookie: setCookieMock,
  },
}))

// Top-level mocks require exercising the module-loading boundary.
const { fetchStateless, fetchWithJar, SimpleCookieJar } = await import("./cookie")

beforeEach(() => {
  requestMock.mockReset()
  getCookiesMock.mockReset()
  setCookieMock.mockReset()
})

describe("CapacitorHttp cookie ownership", () => {
  it("只发送 jar 与请求级 Cookie，并仅将共享 Cookie 回写 jar", async () => {
    const jar = new SimpleCookieJar()
    const origin = "https://jwxt.ysu.edu.cn/"
    await jar.setCookie("_WEU=shared; Path=/", origin)
    await jar.setCookie("SESSION=jar; Path=/", origin)
    requestMock.mockResolvedValue({
      status: 200,
      headers: {
        "Set-Cookie": ["SESSION=response; Path=/", "_WEU=response; Path=/"],
      },
      url: origin,
      data: "",
    })

    await fetchWithJar(jar, {
      method: "GET",
      url: `${origin}jwapp/sys/wdkb/current.do`,
      headers: { Cookie: "SESSION=manual" },
      cookies: [
        {
          name: "_WEU",
          value: "app-a",
          domain: ".ysu.edu.cn",
          path: "/jwapp/",
          secure: true,
          expires: null,
        },
      ],
      redirect: "manual",
    })

    expect(requestMock.mock.calls[0]![0].headers.Cookie).toBe("SESSION=jar; _WEU=app-a")
    expect(getCookiesMock).not.toHaveBeenCalled()
    expect(setCookieMock).not.toHaveBeenCalled()
    expect(await jar.getCookieString(`${origin}jwapp/`)).toBe("_WEU=shared; SESSION=response")
  })

  it("无会话请求不携带手写 Cookie，也不读取原生 Cookie", async () => {
    getCookiesMock.mockResolvedValue({ SESSION: "native" })
    requestMock.mockResolvedValue({ status: 200, headers: {}, data: "" })

    await fetchStateless({
      method: "GET",
      url: "https://example.com/data",
      headers: { cookie: "SESSION=manual" },
      redirect: "manual",
    })

    const headers = requestMock.mock.calls[0]![0].headers as Record<string, string>
    expect(Object.keys(headers).some((name) => name.toLowerCase() === "cookie")).toBe(false)
    expect(getCookiesMock).not.toHaveBeenCalled()
    expect(setCookieMock).not.toHaveBeenCalled()
  })
})

describe("CapacitorHttp binary response", () => {
  it("跟随重定向时仍使用 arraybuffer，并将原生 base64 响应还原为图片字节", async () => {
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

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        responseType: "arraybuffer",
      })
    )
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([255, 216, 255]))
  })
})
