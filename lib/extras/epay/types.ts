/**
 * 燕山大学在线综合支付平台（epay.ysu.edu.cn）领域模型与原始 JSON 转换。
 *
 * 接口：POST /pay/queryPayCode.html（学号+姓名，无会话/验证码），返回
 * `{D:{payCodeData:{names:{...}, rowCount, rows:[[...],...]}}}`。
 * names 的 value 是字段在行数组中的下标（1 起），因此解析时以 names
 * 动态映射，字段顺序变化也不受影响。结构来自脚本探测（scripts/probe-epay*）。
 */

function rawStr(v: unknown): string {
  if (typeof v === "string") return v
  if (v === null || v === undefined) return ""
  return String(v)
}

/**
 * 该平台返回“宽松 JSON”（key 不带引号），严格 JSON.parse 会失败。
 * 实现抽到 lib/cookie（传输层），此处 re-export 保持 extras 便捷引用。
 * (实测: {D:{root:"",...}})
 */
export { parseLooseJson } from "@/lib/cookie"

function rawNum(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {}
}

/** 一条缴费记录（一次支付码对应一笔待缴/已缴项目） */
export interface EpayBill {
  /** names 映射行号，可能为空 */
  id: string
  /** 人员编号（学号） */
  userId: string
  userName: string
  /** 缴费项目名，如 "2025-2026学年学费" */
  payName: string
  /** 16 位支付码（0-9A-F） */
  code: string
  /** 金额（元） */
  amount: number
  /** 状态原文，网页端以 "未支付" 判断 */
  payStatus: string
}

export interface EpayBillsData {
  /** 0 表示查无支付信息 */
  rowCount: number
  bills: EpayBill[]
}

/**
 * 解析 queryPayCode.html 响应。传入接口返回的原始 JSON（已是对象）。
 * names 缺失或为空时返回空清单。
 */
export function toEpayBills(body: unknown): EpayBillsData {
  const d = asRecord(body).D as unknown
  const payCodeData = asRecord(d).payCodeData as unknown
  const pcd = asRecord(payCodeData)
  const names = asRecord(pcd.names)
  const rows = Array.isArray(pcd.rows) ? pcd.rows : []

  const idxOf = (key: string): number | null => {
    const v = names[key]
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN
    // names 的 value 是 1 基下标（网页端 n[3] 对应 payName:4），
    // 转成 JS 0 基数组下标需减 1。
    return Number.isInteger(n) && n > 0 ? n - 1 : null
  }

  const bills: EpayBill[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    const at = (key: string): unknown => {
      const i = idxOf(key)
      return i === null ? undefined : (row as unknown[])[i]
    }
    const payName = rawStr(at("payName"))
    if (!payName) continue
    bills.push({
      id: rawStr(at("id")),
      userId: rawStr(at("userId")),
      userName: rawStr(at("userName")),
      payName,
      code: rawStr(at("paypassword")),
      amount: rawNum(at("amount")),
      payStatus: rawStr(at("payStatus")),
    })
  }
  return { rowCount: rawNum(pcd.rowCount), bills }
}

/** 未支付状态判定。网页端直接比对中文字样；兼容其他常见表述。 */
export function isUnpaid(status: string): boolean {
  const s = status.trim()
  return s === "" ? false : /未支付|未缴|待缴|未完成|unpaid/i.test(s)
}