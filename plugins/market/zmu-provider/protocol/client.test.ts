import { createCipheriv } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import type { HttpRequest, HttpResponse, SimpleCookieJar } from "@orahako/plugin-sdk/host"
import { ProviderErrorCode } from "@orahako/plugin-sdk/provider-errors"
import { ZMUClient } from "./client"

function response(body: string | ArrayBuffer, status = 200, headers = {}): HttpResponse {
  return {
    status,
    headers,
    url: "",
    text: async () => (typeof body === "string" ? body : ""),
    arrayBuffer: async () => (typeof body === "string" ? new ArrayBuffer(0) : body),
  }
}

type Transport = (jar: SimpleCookieJar, request: HttpRequest) => Promise<HttpResponse>

describe("ZMUClient", () => {
  it("loads a jar-bound captcha and encrypts the password with the captcha key", async () => {
    const transport = vi.fn<Transport>(async (jar, request) => {
      if (request.url.endsWith("/")) {
        await jar.setCookie("JSESSIONID=session-1; Path=/; HttpOnly", request.url)
        return response('<form id="login-form"><input name="account"></form>')
      }
      if (request.url.includes("/yzm?")) {
        return response(new Uint8Array([1, 2, 3]).buffer, 200, {
          "content-type": "image/jpeg;charset=UTF-8",
        })
      }
      if (request.url.endsWith("/new/login")) {
        return response('{"code":0,"message":"成功","data":{"url":"/new/welcome.page"}}')
      }
      throw new Error(`Unexpected ${request.url}`)
    })
    const client = new ZMUClient(transport)
    await client.prepareLogin()
    await expect(client.refreshCaptcha()).resolves.toBe("data:image/jpeg;base64,AQID")
    await expect(client.login("20240001", "p@ss", "2enb")).resolves.toMatchObject({ code: 0 })

    const loginRequest = transport.mock.calls.find(([, request]) =>
      request.url.endsWith("/new/login")
    )?.[1]
    const form = loginRequest?.body as URLSearchParams
    const cipher = createCipheriv("aes-128-ecb", Buffer.from("2enb2enb2enb2enb"), null)
    const expected = cipher.update("p@ss", "utf8", "hex") + cipher.final("hex")
    expect(form.get("account")).toBe("20240001")
    expect(form.get("pwd")).toBe(expected)
    expect(form.get("verifycode")).toBe("2enb")
    expect(client.credential).toContain("session-1")
  })

  it("maps a login-page redirect from an academic request to session expiry", async () => {
    const client = new ZMUClient(async () =>
      response('<form id="login-form"><input name="account"></form>')
    )
    await expect(client.getStudentInfo()).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_SESSION_EXPIRED,
    })
  })

  it("discovers the current term and requests the aggregate schedule", async () => {
    const urls: string[] = []
    const client = new ZMUClient(async (_jar, request) => {
      urls.push(request.url)
      if (request.url.includes("xsgrkbMain")) {
        return response("getXsgrbkList.action?xnxqdm=202601")
      }
      return response('[[{"kcmc":"医学英语","xq":"1","jcdm2":"05,06","zc":"11"}]]')
    })
    await expect(client.getSchedule()).resolves.toMatchObject([
      { name: "医学英语", weekList: [11] },
    ])
    expect(urls[1]).toContain("getKbRq.action?xnxqdm=202601&zc=")
  })

  it("uses all terms by default for grades and normalizes exam terms", async () => {
    const bodies: URLSearchParams[] = []
    const client = new ZMUClient(async (_jar, request) => {
      if (request.url.includes("xsgrkbMain")) {
        return response("getXsgrbkList.action?xnxqdm=202601")
      }
      bodies.push(request.body as URLSearchParams)
      return response('{"total":0,"rows":[]}')
    })
    await client.getGrades()
    await client.getExams({ semester: "2025-2026-2" })
    expect(bodies[0]?.get("xnxqdm")).toBe("")
    expect(bodies[0]?.get("rows")).toBe("1000")
    expect(bodies[1]?.get("xnxqdm")).toBe("202502")
  })
})
