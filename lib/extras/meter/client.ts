/**
 * 17wanxiao 智能水电（空调电表）查询客户端。
 * 协议：POST SWAEEncryptServlet，整体 JSON 经 AES-128-ECB/PKCS7 加密，
 * key = timestamp 截 6 位 + randomStr（ts 为奇数取前 6 位，否则后 6 位）。
 * 接口无会话鉴权，凭据即学工号；详见逆向笔记（docs 未入库）。
 */

import { fetchStateless } from "@/lib/cookie";
import { aes128EcbDecrypt, aes128EcbEncrypt, base64ToBytes, bytesToBase64 } from "./crypto";
import {
  toDayUseList,
  toMeterOverview,
  toRechargeRecords,
  toRoomBind,
  type DayUse,
  type MeterOverview,
  type MeterRoom,
  type RechargeRecord,
} from "./types";

const API_URL = "https://xqh5.17wanxiao.com/smartWaterAndElectricityService/SWAEEncryptServlet";
/** 燕山大学 customerCode（抓包固定值） */
const CUSTOMER_CODE = "2036";
const RANDOM_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** 与官方微信 H5 一致，避免上游 UA 过滤 */
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 16; PHY110 Build/UKQ1.231108.001; wv) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.181 " +
  "Mobile Safari/537.36 XWEB/1500047 MMWEBSDK/20260502 MicroMessenger/8.0.72.3100";
const REFERER = "https://xqh5.17wanxiao.com/userwaterelecmini/index.html";

export class MeterError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "MeterError";
  }
}

function randomStr(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let s = "";
  for (const b of bytes) s += RANDOM_ALPHABET[b % RANDOM_ALPHABET.length];
  return s;
}

/** key = timestamp 截 6 位 + randomStr（16 字节 ASCII）。ts 奇数取前 6 位，否则后 6 位 */
function deriveKey(ts: string, rs: string): Uint8Array {
  const part = Number(ts) % 2 === 1 ? ts.slice(0, 6) : ts.slice(-6);
  return new TextEncoder().encode(part + rs);
}

export class MeterClient {
  /** account 即学工号 */
  constructor(private readonly account: string) {}

  private async call(cmd: string, params: Record<string, string>): Promise<unknown> {
    const ts = String(Date.now());
    const rs = randomStr();
    const outer = JSON.stringify({
      param: JSON.stringify({ cmd, ...params, timestamp: ts }),
      customercode: CUSTOMER_CODE,
      method: cmd,
      command: "OWNWaterElecService",
    });
    const encryptData = bytesToBase64(aes128EcbEncrypt(deriveKey(ts, rs), new TextEncoder().encode(outer)));

    const res = await fetchStateless({
      method: "POST",
      url: API_URL,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": USER_AGENT,
        referer: REFERER,
        origin: "https://xqh5.17wanxiao.com",
        "x-requested-with": "com.tencent.mm",
      },
      body: new URLSearchParams({ encryptData, randomStr: rs, timestamp: ts, method: cmd }).toString(),
      redirect: "manual",
    });
    if (res.status !== 200) throw new MeterError(-1, `HTTP ${res.status}`);

    const j = JSON.parse(await res.text()) as Record<string, unknown>;
    if (typeof j.encryptData !== "string" || typeof j.randomStr !== "string") {
      throw new MeterError(-1, "接口异常响应");
    }
    const plain = JSON.parse(
      new TextDecoder().decode(
        aes128EcbDecrypt(deriveKey(String(j.timestamp), j.randomStr), base64ToBytes(j.encryptData)),
      ),
    ) as Record<string, unknown>;
    if (Number(plain.code_) !== 0) {
      throw new MeterError(Number(plain.code_), String(plain.message_ ?? "查询失败"));
    }
    return JSON.parse(String(plain.body ?? "{}"));
  }

  /** 学号 → 绑定房间（含 roomverify，后续查询的钥匙） */
  async getRoom(): Promise<MeterRoom | null> {
    return toRoomBind(await this.call("getbindroom", { account: this.account }));
  }

  async getOverview(roomverify: string): Promise<MeterOverview | null> {
    return toMeterOverview(
      await this.call("h5_getstuindexpage", { roomverify, account: this.account }),
    );
  }

  /** 日用量明细。实测需要 account 参数，日期格式 yyyy-MM-dd */
  async getDailyUse(roomverify: string, startDate: string, endDate: string): Promise<DayUse[]> {
    return toDayUseList(
      await this.call("gettimeusedetail", {
        roomverify,
        businesstype: "0",
        startdate: startDate,
        enddate: endDate,
        account: this.account,
      }),
    );
  }

  async getRecharges(roomverify: string): Promise<RechargeRecord[]> {
    return toRechargeRecords(
      await this.call("h5_getrechargelist", { roomverify, account: this.account }),
    );
  }
}

export interface MeterData {
  room: MeterRoom;
  overview: MeterOverview | null;
  daily: DayUse[];
  recharges: RechargeRecord[];
}

/** 一次拉齐页面所需全部数据：先 getbindroom 拿 roomverify，其余并行 */
export async function fetchMeterData(account: string): Promise<MeterData> {
  const client = new MeterClient(account);
  const room = await client.getRoom();
  if (!room) throw new MeterError(1, "NOT_BOUND");
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 24 * 3600 * 1000);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const [overview, daily, recharges] = await Promise.all([
    client.getOverview(room.roomverify),
    client.getDailyUse(room.roomverify, fmt(start), fmt(end)),
    client.getRecharges(room.roomverify),
  ]);
  return { room, overview, daily, recharges };
}
