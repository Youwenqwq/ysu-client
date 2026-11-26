/**
 * 17wanxiao smart water & electricity (dormitory AC meter) HTTP client.
 * Protocol: POST `SWAEEncryptServlet` with AES-128-ECB/PKCS7 payload encryption.
 * Key = 6 digits of timestamp (first 6 if odd, last 6 if even) + 10-char `randomStr`.
 */

import {
  aes128EcbDecrypt,
  aes128EcbEncrypt,
  base64ToBytes,
  bytesToBase64,
  type PluginHttpService,
} from "@orahako/sdk"
import {
  isRecord,
  toDayUseList,
  toMeterOverview,
  toRechargeRecords,
  toRoomBind,
  type DayUse,
  type MeterOverview,
  type MeterRoom,
  type RechargeRecord,
} from "./types"

const API_URL = "https://xqh5.17wanxiao.com/smartWaterAndElectricityService/SWAEEncryptServlet"
/** YSU customerCode in 17wanxiao protocol. */
const CUSTOMER_CODE = "2036"
const RANDOM_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
/** Matches official WeChat H5 WebView UA to avoid upstream UA filtering. */
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 16; PHY110 Build/UKQ1.231108.001; wv) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 " +
  "Mobile Safari/537.36 XWEB/1500047 MMWEBSDK/20260502 MicroMessenger/8.0.72.3100"
const REFERER = "https://xqh5.17wanxiao.com/userwaterelecmini/index.html"

export class MeterError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
    this.name = "MeterError"
  }
}

function randomStr(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10))
  let out = ""
  for (const byte of bytes) {
    out += RANDOM_ALPHABET[byte % RANDOM_ALPHABET.length]
  }
  return out
}

/** 16-byte ASCII key: 6 digits of `ts` (first 6 if odd, last 6 if even) + `rs`. */
function deriveKey(ts: string, rs: string): Uint8Array {
  const part = Number(ts) % 2 === 1 ? ts.slice(0, 6) : ts.slice(-6)
  return new TextEncoder().encode(part + rs)
}

/** Public stateless HTTP surface required by `MeterClient`; plugins pass `ctx.http`. */
export type MeterHttp = Pick<PluginHttpService, "send">

export class MeterClient {
  constructor(
    private readonly account: string,
    private readonly http: MeterHttp
  ) {}

  private async call(cmd: string, params: Record<string, string>): Promise<unknown> {
    const ts = String(Date.now())
    const rs = randomStr()
    const outer = JSON.stringify({
      param: JSON.stringify({ cmd, ...params, timestamp: ts }),
      customercode: CUSTOMER_CODE,
      method: cmd,
      command: "OWNWaterElecService",
    })
    const encryptData = bytesToBase64(
      aes128EcbEncrypt(deriveKey(ts, rs), new TextEncoder().encode(outer))
    )

    const res = await this.http.send({
      method: "POST",
      url: API_URL,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": USER_AGENT,
        referer: REFERER,
        origin: "https://xqh5.17wanxiao.com",
        "x-requested-with": "com.tencent.mm",
      },
      body: new URLSearchParams({
        encryptData,
        randomStr: rs,
        timestamp: ts,
        method: cmd,
      }).toString(),
      redirect: "manual",
    })
    if (res.status !== 200) {
      throw new MeterError(-1, `HTTP ${res.status}`)
    }

    const rawOuter: unknown = JSON.parse(await res.text())
    if (
      !isRecord(rawOuter) ||
      typeof rawOuter.encryptData !== "string" ||
      typeof rawOuter.randomStr !== "string"
    ) {
      throw new MeterError(-1, "接口异常响应")
    }

    const decryptedText = new TextDecoder().decode(
      aes128EcbDecrypt(
        deriveKey(String(rawOuter.timestamp), rawOuter.randomStr),
        base64ToBytes(rawOuter.encryptData)
      )
    )
    const plain: unknown = JSON.parse(decryptedText)
    if (!isRecord(plain)) {
      throw new MeterError(-1, "接口异常响应")
    }
    if (Number(plain.code_) !== 0) {
      throw new MeterError(Number(plain.code_), String(plain.message_ ?? "查询失败"))
    }
    return JSON.parse(String(plain.body ?? "{}"))
  }

  /** Resolves the bound room (`roomverify`) for `this.account`. */
  async getRoom(): Promise<MeterRoom | null> {
    return toRoomBind(await this.call("getbindroom", { account: this.account }))
  }

  async getOverview(roomverify: string): Promise<MeterOverview | null> {
    return toMeterOverview(
      await this.call("h5_getstuindexpage", {
        roomverify,
        account: this.account,
      })
    )
  }

  /** Daily electricity usage (`startDate` and `endDate` formatted as `YYYY-MM-DD`). */
  async getDailyUse(roomverify: string, startDate: string, endDate: string): Promise<DayUse[]> {
    return toDayUseList(
      await this.call("gettimeusedetail", {
        roomverify,
        businesstype: "0",
        startdate: startDate,
        enddate: endDate,
        account: this.account,
      })
    )
  }

  async getRecharges(roomverify: string): Promise<RechargeRecord[]> {
    return toRechargeRecords(
      await this.call("h5_getrechargelist", {
        roomverify,
        account: this.account,
      })
    )
  }
}

export interface MeterData {
  readonly room: MeterRoom
  readonly overview: MeterOverview | null
  readonly daily: readonly DayUse[]
  readonly recharges: readonly RechargeRecord[]
}

export function createMeterClient(account: string, http: MeterHttp): MeterClient {
  return new MeterClient(account, http)
}

/** Fetches room binding first, then overview, 30-day daily usage, and recharge records in parallel. */
export async function fetchMeterData(account: string, http: MeterHttp): Promise<MeterData> {
  const client = createMeterClient(account, http)
  const room = await client.getRoom()
  if (!room) {
    throw new MeterError(1, "NOT_BOUND")
  }
  const end = new Date()
  const start = new Date(end.getTime() - 29 * 24 * 3600 * 1000)
  const fmt = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  const [overview, daily, recharges] = await Promise.all([
    client.getOverview(room.roomverify),
    client.getDailyUse(room.roomverify, fmt(start), fmt(end)),
    client.getRecharges(room.roomverify),
  ])
  return { room, overview, daily, recharges }
}
