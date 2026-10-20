import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SimpleCookieJar, fetchWithJar } from "@/lib/cookie"
import { HarmonySecureStorage } from "@/lib/storage/harmony-secure"

describe("Harmony bridge transport", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_PLATFORM", "harmony")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("follows redirects in the app, with each hop's cookies, without browser fetch", async () => {
    const messages: Array<{
      id: string
      method: string
      params: { url: string; headers: Record<string, string> }
    }> = []
    const fetch = vi.fn(() => {
      throw new Error("Browser network must not be used")
    })
    vi.stubGlobal("fetch", fetch)
    vi.stubGlobal("window", {
      YSUHarmony: {
        postMessage(raw: string) {
          const message = JSON.parse(raw)
          messages.push(message)
          const first = messages.length === 1
          queueMicrotask(() =>
            window.__ysuHarmonyReply!({
              id: message.id,
              ok: true,
              data: {
                status: first ? 302 : 200,
                headers: first
                  ? {
                      location: "/authserver/index.do",
                      "set-cookie": [
                        "JSESSIONID=one; Path=/authserver; Secure",
                        "CASTGC=two; Path=/authserver; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Secure",
                      ],
                    }
                  : {},
                bodyBase64: btoa(first ? "" : "success"),
              },
            })
          )
        },
      },
    })
    const response = await fetchWithJar(new SimpleCookieJar(), {
      method: "GET",
      url: "https://cer.ysu.edu.cn/authserver/login",
      redirect: "follow",
    })
    expect(await response.text()).toBe("success")
    expect(messages).toHaveLength(2)
    expect(messages[1].params.headers.cookie).toContain("JSESSIONID=one")
    expect(messages[1].params.headers.cookie).toContain("CASTGC=two")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("rejects an external redirect before sending cookies or another request", async () => {
    const send = vi.fn((raw: string) => {
      const message = JSON.parse(raw)
      queueMicrotask(() =>
        window.__ysuHarmonyReply!({
          id: message.id,
          ok: true,
          data: {
            status: 302,
            headers: { location: "https://evil.example/" },
            bodyBase64: "",
          },
        })
      )
    })
    vi.stubGlobal("window", { YSUHarmony: { postMessage: send } })
    await expect(
      fetchWithJar(new SimpleCookieJar(), {
        method: "GET",
        url: "https://cer.ysu.edu.cn/authserver/login",
        redirect: "follow",
      })
    ).rejects.toThrow()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it("allows the CAS secondary-authentication redirect with its reviewed service callback", async () => {
    const service = "https://cer.ysu.edu.cn/personalInfo/personCenter/index.html"
    const target = `/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true&service=${encodeURIComponent(service)}`
    const urls: string[] = []
    vi.stubGlobal("window", {
      YSUHarmony: {
        postMessage(raw: string) {
          const message = JSON.parse(raw)
          urls.push(message.params.url)
          const first = urls.length === 1
          queueMicrotask(() =>
            window.__ysuHarmonyReply!({
              id: message.id,
              ok: true,
              data: {
                status: first ? 302 : 200,
                headers: first ? { location: target } : {},
                bodyBase64: btoa(first ? "" : "reAuthType"),
              },
            })
          )
        },
      },
    })
    const response = await fetchWithJar(new SimpleCookieJar(), {
      method: "GET",
      url: `https://cer.ysu.edu.cn/authserver/login?service=${encodeURIComponent(service)}`,
      redirect: "follow",
    })
    expect(urls).toHaveLength(2)
    expect(response.url).toBe(`https://cer.ysu.edu.cn${target}`)
    expect(await response.text()).toBe("reAuthType")
  })

  it("fails closed when native storage is missing or rejects a write", async () => {
    const plaintext = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }
    vi.stubGlobal("localStorage", plaintext)
    vi.stubGlobal("window", {})
    await expect(HarmonySecureStorage.setItem("academic-client-auth", "secret")).rejects.toThrow()
    vi.stubGlobal("window", {
      YSUHarmony: {
        postMessage(raw: string) {
          const message = JSON.parse(raw)
          queueMicrotask(() =>
            window.__ysuHarmonyReply!({ id: message.id, ok: false, error: "locked" })
          )
        },
      },
    })
    await expect(HarmonySecureStorage.setItem("academic-client-auth", "secret")).rejects.toThrow(
      "locked"
    )
    expect(plaintext.setItem).not.toHaveBeenCalled()
  })

  it("preserves binary bytes and combined Set-Cookie values containing Expires commas", async () => {
    vi.stubGlobal("window", {
      YSUHarmony: {
        postMessage(raw: string) {
          const message = JSON.parse(raw)
          queueMicrotask(() =>
            window.__ysuHarmonyReply!({
              id: message.id,
              ok: true,
              data: {
                status: 200,
                headers: {
                  "Set-Cookie":
                    "a=one; Path=/; Expires=Wed, 21 Oct 2037 07:28:00 GMT, b=two; Path=/",
                },
                bodyBase64: btoa(String.fromCharCode(0, 128, 255)),
              },
            })
          )
        },
      },
    })
    const jar = new SimpleCookieJar()
    const response = await fetchWithJar(jar, {
      method: "GET",
      url: "https://cer.ysu.edu.cn/authserver/getCaptcha.htl",
      redirect: "manual",
      responseType: "arraybuffer",
    })
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([0, 128, 255])
    expect(await jar.getCookieString("https://cer.ysu.edu.cn/authserver/login")).toContain("b=two")
    expect(await jar.getCookieString("https://cer.ysu.edu.cn/authserver/login")).toContain("a=one")
  })
})
