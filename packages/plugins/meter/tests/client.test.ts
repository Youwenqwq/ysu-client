import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  aes128EcbDecrypt,
  aes128EcbEncrypt,
  base64ToBytes,
  bytesToBase64,
  type HttpRequest,
  type HttpResponse,
} from "@orahako/sdk"
import { fetchMeterData, MeterClient, MeterError } from "../src/client"

const sendMock = vi.fn<(req: HttpRequest) => Promise<HttpResponse>>()
const http = { send: sendMock }

function deriveKey(ts: string, rs: string): Uint8Array {
  const part = Number(ts) % 2 === 1 ? ts.slice(0, 6) : ts.slice(-6)
  return new TextEncoder().encode(part + rs)
}

const RES_TS_ODD = "1760000000001"
const RES_TS_EVEN = "1760000000002"
const RES_RS = "ABCDEFGHIJ"

function encryptedResponse(envelope: unknown, ts = RES_TS_ODD): HttpResponse {
  const payload = {
    randomStr: RES_RS,
    timestamp: ts,
    encryptData: bytesToBase64(
      aes128EcbEncrypt(deriveKey(ts, RES_RS), new TextEncoder().encode(JSON.stringify(envelope)))
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

describe("MeterClient 17wanxiao protocol contract", () => {
  it("getRoom: encrypts request body and decrypts roomverify response", async () => {
    sendMock.mockImplementation(async (req) => {
      expect(req.method).toBe("POST")
      expect(req.url).toContain("SWAEEncryptServlet")
      const form = new URLSearchParams(String(req.body))
      expect(form.get("method")).toBe("getbindroom")
      expect(form.get("randomStr")).toMatch(/^[0-9A-Z]{10}$/)
      const ts = form.get("timestamp")!
      expect(ts).toMatch(/^\d+$/)
      const outer: Record<string, unknown> = JSON.parse(
        new TextDecoder().decode(
          aes128EcbDecrypt(
            deriveKey(ts, form.get("randomStr")!),
            base64ToBytes(form.get("encryptData")!)
          )
        )
      )
      expect(outer.customercode).toBe("2036")
      expect(outer.method).toBe("getbindroom")
      const inner: Record<string, unknown> = JSON.parse(String(outer.param))
      expect(inner.cmd).toBe("getbindroom")
      expect(inner.account).toBe("20260001")
      expect(inner.timestamp).toBe(ts)

      return encryptedResponse({
        code_: 0,
        result_: "true",
        body: JSON.stringify({
          result: "0",
          roomfullname: "测试校区_一组团A座_1层_101房间",
          roomverify: "rv-101",
          account_num: "20260001",
        }),
      })
    })

    const room = await new MeterClient("20260001", http).getRoom()
    expect(room).toEqual({
      roomFullName: "测试校区_一组团A座_1层_101房间",
      roomverify: "rv-101",
      accountNum: "20260001",
    })
  })

  it("getRoom: treats result != 0 as unbound (null)", async () => {
    sendMock.mockResolvedValue(
      encryptedResponse(
        {
          code_: 0,
          result_: "true",
          body: JSON.stringify({ result: "-20003", message: "账号不存在" }),
        },
        RES_TS_EVEN
      )
    )
    await expect(new MeterClient("x", http).getRoom()).resolves.toBeNull()
  })

  it("throws MeterError with server message_ when envelope code_ != 0", async () => {
    sendMock.mockResolvedValue(
      encryptedResponse({ code_: 500, result_: "false", message_: "系统繁忙", body: "" })
    )
    const err = await new MeterClient("x", http).getRoom().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MeterError)
    if (err instanceof MeterError) {
      expect(err.code).toBe(500)
      expect(err.message).toBe("系统繁忙")
    }
  })

  it("throws MeterError on non-200 HTTP status", async () => {
    sendMock.mockResolvedValue({
      status: 502,
      headers: {},
      url: "",
      text: async () => "",
      arrayBuffer: async () => new ArrayBuffer(0),
    })
    await expect(new MeterClient("x", http).getRoom()).rejects.toThrow("HTTP 502")
  })

  it("getDailyUse: sends account and businesstype=0 and normalizes numeric strings", async () => {
    sendMock.mockImplementation(async (req) => {
      const form = new URLSearchParams(String(req.body))
      const outer: Record<string, unknown> = JSON.parse(
        new TextDecoder().decode(
          aes128EcbDecrypt(
            deriveKey(form.get("timestamp")!, form.get("randomStr")!),
            base64ToBytes(form.get("encryptData")!)
          )
        )
      )
      const inner: Record<string, unknown> = JSON.parse(String(outer.param))
      expect(inner.cmd).toBe("gettimeusedetail")
      expect(inner.account).toBe("20260001")
      expect(inner.businesstype).toBe("0")
      return encryptedResponse({
        code_: 0,
        result_: "true",
        body: JSON.stringify({ result: "0", dayuselist: [{ date: "2026-08-15", use: "0.01" }] }),
      })
    })
    const daily = await new MeterClient("20260001", http).getDailyUse(
      "rv-101",
      "2026-08-15",
      "2026-08-22"
    )
    expect(daily).toEqual([{ date: "2026-08-15", use: 0.01 }])
  })

  it("fetchMeterData: orchestrates getbindroom followed by parallel overview, daily, and recharge calls", async () => {
    sendMock.mockImplementation(async (req) => {
      const form = new URLSearchParams(String(req.body))
      const method = form.get("method")
      if (method === "getbindroom") {
        return encryptedResponse({
          code_: 0,
          body: JSON.stringify({
            result: "0",
            roomfullname: "东校区_A1_302",
            roomverify: "rv-302",
            account_num: "30200",
          }),
        })
      }
      if (method === "h5_getstuindexpage") {
        return encryptedResponse({
          code_: 0,
          body: JSON.stringify({
            result: "0",
            roomfullname: "东校区_A1_302",
            roomnum: "302",
            modlist: [
              {
                devicename: "空调表",
                odd: "42.5",
                todayuse: "1.2",
                price: "0.52",
                monthuselist: [{ yearmonth: "2026.11", monthuse: "18.4" }],
                linestatus: [{ desc: "第一路:送电" }],
              },
            ],
          }),
        })
      }
      if (method === "gettimeusedetail") {
        return encryptedResponse({
          code_: 0,
          body: JSON.stringify({
            result: "0",
            dayuselist: [{ date: "2026-11-18", use: "1.2" }],
          }),
        })
      }
      return encryptedResponse({
        code_: 0,
        body: JSON.stringify({
          result: "0",
          list: [
            {
              dayrechargelist: [
                { daytime: "2026-11-01 09:00", name: "微信购电", sumbuy: "100", sumbuyfare: "52" },
              ],
            },
          ],
        }),
      })
    })

    const data = await fetchMeterData("20260001", http)
    expect(data.room.roomverify).toBe("rv-302")
    expect(data.overview?.meters[0]).toMatchObject({
      deviceName: "空调表",
      remaining: 42.5,
      todayUse: 1.2,
      price: 0.52,
      lineDesc: "第一路:送电",
    })
    expect(data.daily).toEqual([{ date: "2026-11-18", use: 1.2 }])
    expect(data.recharges).toEqual([
      { time: "2026-11-01 09:00", name: "微信购电", amount: 100, fare: 52 },
    ])
  })
})
