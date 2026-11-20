/**
 * Domain models and raw JSON mappers for the 17wanxiao smart water & electricity protocol.
 * Upstream endpoints mix string and numeric fields, so all raw inputs are normalized safely.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function rawStr(value: unknown): string {
  if (typeof value === "string") return value
  if (value === null || value === undefined) return ""
  return String(value)
}

function rawNum(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value)
  return Number.isFinite(num) ? num : 0
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function asList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

/** `getbindroom`: dormitory/meter account bound to a student/staff ID. */
export interface MeterRoom {
  readonly roomFullName: string
  readonly roomverify: string
  readonly accountNum: string
}

export function toRoomBind(body: unknown): MeterRoom | null {
  const data = asRecord(body)
  if (rawStr(data.result) !== "0") return null
  const roomverify = rawStr(data.roomverify)
  if (!roomverify) return null
  return {
    roomFullName: rawStr(data.roomfullname),
    roomverify,
    accountNum: rawStr(data.account_num),
  }
}

/** `h5_getstuindexpage`: each element in `modlist` represents one meter circuit. */
export interface MeterDevice {
  readonly deviceName: string
  /** Remaining electricity (kWh). */
  readonly remaining: number
  /** Today's electricity usage (kWh). */
  readonly todayUse: number
  /** Electricity unit price (CNY / kWh). */
  readonly price: number
  /** Monthly usage entries (`month` formatted like `"2026.08"`). */
  readonly monthUse: readonly { readonly month: string; readonly use: number }[]
  /** Circuit status description, e.g. `"第一路:第一路一般送电"`. */
  readonly lineDesc: string
}

export interface MeterOverview {
  readonly roomFullName: string
  readonly roomNum: string
  readonly meters: readonly MeterDevice[]
}

export function toMeterOverview(body: unknown): MeterOverview | null {
  const data = asRecord(body)
  if (rawStr(data.result) !== "0") return null
  return {
    roomFullName: rawStr(data.roomfullname),
    roomNum: rawStr(data.roomnum),
    meters: asList(data.modlist).map((meter) => ({
      deviceName: rawStr(meter.devicename),
      remaining: rawNum(meter.odd),
      todayUse: rawNum(meter.todayuse),
      price: rawNum(meter.price),
      monthUse: asList(meter.monthuselist).map((entry) => ({
        month: rawStr(entry.yearmonth),
        use: rawNum(entry.monthuse),
      })),
      lineDesc: rawStr(asRecord(asList(meter.linestatus)[0]).desc),
    })),
  }
}

/** `gettimeusedetail`: daily usage detail (`date` formatted as `"YYYY-MM-DD"`). */
export interface DayUse {
  readonly date: string
  readonly use: number
}

export function toDayUseList(body: unknown): DayUse[] {
  const data = asRecord(body)
  if (rawStr(data.result) !== "0") return []
  return asList(data.dayuselist).map((entry) => ({
    date: rawStr(entry.date),
    use: rawNum(entry.use),
  }))
}

/** `h5_getrechargelist`: flattened recharge records ordered newest first. */
export interface RechargeRecord {
  /** Timestamp string such as `"2026-07-12 12:12"`. */
  readonly time: string
  readonly name: string
  /** Recharged electricity (kWh). */
  readonly amount: number
  /** Paid amount (CNY; 0 for non-payment adjustments). */
  readonly fare: number
}

export function toRechargeRecords(body: unknown): RechargeRecord[] {
  const data = asRecord(body)
  if (rawStr(data.result) !== "0") return []
  return asList(data.list).flatMap((month) =>
    asList(month.dayrechargelist).map((record) => ({
      time: rawStr(record.daytime),
      name: rawStr(record.name),
      amount: rawNum(record.sumbuy),
      fare: rawNum(record.sumbuyfare),
    }))
  )
}
