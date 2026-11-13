import { beforeEach, describe, expect, it, vi } from "vitest"
import type { HttpRequest, HttpResponse } from "@ysu/plugin-sdk/host"
import { aes128EcbDecrypt, aes128EcbEncrypt, base64ToBytes, bytesToBase64 } from "./crypto"

const sendMock = vi.fn<(req: HttpRequest) => Promise<HttpResponse>>()

vi.mock("@ysu/plugin-sdk/host", () => ({
  fetchStateless: (req: HttpRequest) => sendMock(req),
}))

import { MeterClient, MeterError } from "./client"

// 与协议笔记一致的独立实现（client 内部 deriveKey 未导出，测试中复算以交叉验证）
function deriveKey(ts: string, rs: string): Uint8Array {
  const part = Number(ts) % 2 === 1 ? ts.slice(0, 6) : ts.slice(-6)
  return new TextEncoder().encode(part + rs)
}

/** 构造加密响应包：ts 选奇数，覆盖 key 派生的奇数分支 */
const RES_TS = "1760000000001"
const RES_RS = "ABCDEFGHIJ"

function encryptedResponse(envelope: unknown): HttpResponse {
  const payload = {
    randomStr: RES_RS,
    timestamp: RES_TS,
    encryptData: bytesToBase64(
      aes128EcbEncrypt(
        deriveKey(RES_TS, RES_RS),
        new TextEncoder().encode(JSON.stringify(envelope))
      )
    ),
  }
  return {
    status: 200,
    headers: {},
    url: "",
    text: async () => JSON.stringify(payload),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

beforeEach(() => {
  sendMock.mockReset()
})

describe("MeterClient 协议契约", () => {
  it("getRoom：请求加密体可还原，响应解密映射 roomverify", async () => {
    sendMock.mockImplementation(async (req) => {
      expect(req.method).toBe("POST")
      expect(req.url).toContain("SWAEEncryptServlet")
      const form = new URLSearchParams(String(req.body))
      expect(form.get("method")).toBe("getbindroom")
      expect(form.get("randomStr")).toMatch(/^[0-9A-Z]{10}$/)
      const ts = form.get("timestamp")!
      expect(ts).toMatch(/^\d+$/)
      // 用请求自带参数解密，还原外层明文
      const outer = JSON.parse(
        new TextDecoder().decode(
          aes128EcbDecrypt(
            deriveKey(ts, form.get("randomStr")!),
            base64ToBytes(form.get("encryptData")!)
          )
        )
      )
      expect(outer.customercode).toBe("2036")
      expect(outer.method).toBe("getbindroom")
      const inner = JSON.parse(outer.param)
      expect(inner.cmd).toBe("getbindroom")
      expect(inner.account).toBe("202411040369")
      expect(inner.timestamp).toBe(ts)

      return encryptedResponse({
        code_: 0,
        result_: "true",
        body: JSON.stringify({
          result: "0",
          roomfullname: "燕山大学西校区_四组团B座_5层_526房间",
          roomverify: "104-9--36-526",
          account_num: "104936526",
        }),
      })
    })

    const room = await new MeterClient("202411040369").getRoom()
    expect(room).toEqual({
      roomFullName: "燕山大学西校区_四组团B座_5层_526房间",
      roomverify: "104-9--36-526",
      accountNum: "104936526",
    })
  })

  it("getRoom：业务层 result != 0 视为未绑定", async () => {
    sendMock.mockResolvedValue(
      encryptedResponse({
        code_: 0,
        result_: "true",
        body: JSON.stringify({ result: "-20003", message: "账号不存在" }),
      })
    )
    await expect(new MeterClient("x").getRoom()).resolves.toBeNull()
  })

  it("信封 code_ != 0 抛 MeterError（带服务端 message_）", async () => {
    sendMock.mockResolvedValue(
      encryptedResponse({ code_: 500, result_: "false", message_: "系统繁忙", body: "" })
    )
    const err = await new MeterClient("x").getRoom().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MeterError)
    expect((err as MeterError).code).toBe(500)
    expect((err as MeterError).message).toBe("系统繁忙")
  })

  it("HTTP 非 200 抛 MeterError", async () => {
    sendMock.mockResolvedValue({
      status: 502,
      headers: {},
      url: "",
      text: async () => "",
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    await expect(new MeterClient("x").getRoom()).rejects.toThrow("HTTP 502")
  })

  it("getDailyUse：携带 account 与 businesstype=0（实测缺 account 报参数异常）", async () => {
    sendMock.mockImplementation(async (req) => {
      const form = new URLSearchParams(String(req.body))
      const outer = JSON.parse(
        new TextDecoder().decode(
          aes128EcbDecrypt(
            deriveKey(form.get("timestamp")!, form.get("randomStr")!),
            base64ToBytes(form.get("encryptData")!)
          )
        )
      )
      const inner = JSON.parse(outer.param)
      expect(inner.cmd).toBe("gettimeusedetail")
      expect(inner.account).toBe("202411040369")
      expect(inner.businesstype).toBe("0")
      return encryptedResponse({
        code_: 0,
        result_: "true",
        body: JSON.stringify({ result: "0", dayuselist: [{ date: "2026-08-15", use: "0.01" }] }),
      })
    })
    const daily = await new MeterClient("202411040369").getDailyUse(
      "104-9--36-526",
      "2026-08-15",
      "2026-08-22"
    )
    expect(daily).toEqual([{ date: "2026-08-15", use: 0.01 }])
  })
})
