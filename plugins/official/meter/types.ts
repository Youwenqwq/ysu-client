/**
 * 17wanxiao 智能水电协议的领域模型与原始 JSON 转换。
 * 字段名/结构来自抓包实测（docs 见 ~/test/17wanxiao 逆向笔记）；
 * 数值字段服务端字符串/数字混发，统一 rawNum/rawStr 收敛。
 */

function rawStr(v: unknown): string {
  if (typeof v === "string") return v
  if (v === null || v === undefined) return ""
  return String(v)
}

function rawNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {}
}

function asList(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.map(asRecord) : []
}

/** getbindroom：学号绑定的宿舍/电表户 */
export interface MeterRoom {
  roomFullName: string
  roomverify: string
  accountNum: string
}

export function toRoomBind(body: unknown): MeterRoom | null {
  const d = asRecord(body)
  if (rawStr(d.result) !== "0") return null
  const roomverify = rawStr(d.roomverify)
  if (!roomverify) return null
  return {
    roomFullName: rawStr(d.roomfullname),
    roomverify,
    accountNum: rawStr(d.account_num),
  }
}

/** h5_getstuindexpage：modlist 中每个元素一路电表 */
export interface MeterDevice {
  deviceName: string
  /** 剩余电量（度） */
  remaining: number
  /** 今日用量（度） */
  todayUse: number
  /** 电价（元/度，modlist 内直接下发） */
  price: number
  /** 月度用量，yearmonth 形如 "2026.08" */
  monthUse: { month: string; use: number }[]
  /** 线路状态描述，如 "第一路:第一路一般送电" */
  lineDesc: string
}

export interface MeterOverview {
  roomFullName: string
  roomNum: string
  meters: MeterDevice[]
}

export function toMeterOverview(body: unknown): MeterOverview | null {
  const d = asRecord(body)
  if (rawStr(d.result) !== "0") return null
  return {
    roomFullName: rawStr(d.roomfullname),
    roomNum: rawStr(d.roomnum),
    meters: asList(d.modlist).map((m) => ({
      deviceName: rawStr(m.devicename),
      remaining: rawNum(m.odd),
      todayUse: rawNum(m.todayuse),
      price: rawNum(m.price),
      monthUse: asList(m.monthuselist).map((e) => ({
        month: rawStr(e.yearmonth),
        use: rawNum(e.monthuse),
      })),
      lineDesc: rawStr(asRecord(asList(m.linestatus)[0]).desc),
    })),
  }
}

/** gettimeusedetail：日用量明细，date 形如 "2026-08-15" */
export interface DayUse {
  date: string
  use: number
}

export function toDayUseList(body: unknown): DayUse[] {
  const d = asRecord(body)
  if (rawStr(d.result) !== "0") return []
  return asList(d.dayuselist).map((e) => ({
    date: rawStr(e.date),
    use: rawNum(e.use),
  }))
}

/** h5_getrechargelist：按月分组下发，拍平为按时间倒序的记录列表 */
export interface RechargeRecord {
  /** 形如 "2026-07-12 12:12" */
  time: string
  name: string
  /** 充值电量（度） */
  amount: number
  /** 充值金额（元；补电等非支付账单为 0） */
  fare: number
}

export function toRechargeRecords(body: unknown): RechargeRecord[] {
  const d = asRecord(body)
  if (rawStr(d.result) !== "0") return []
  return asList(d.list).flatMap((month) =>
    asList(month.dayrechargelist).map((r) => ({
      time: rawStr(r.daytime),
      name: rawStr(r.name),
      amount: rawNum(r.sumbuy),
      fare: rawNum(r.sumbuyfare),
    }))
  )
}
