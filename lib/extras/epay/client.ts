/**
 * 燕山大学在线综合支付平台缴费查询客户端。
 *
 * 优先走 SSO：复用教务 CAS 会话（providers/ysu/epay-access）免密拉取
 * 全部付款记录（含已缴）。如会话不可用，回退到无密码的 queryPayCode
 * （学号+姓名查待缴清单，供"待缴提醒"）。
 *
 * 不涉及任何支付操作，仅只读查询。
 */
import { fetchStateless } from "@/lib/cookie"
import {
  isUnpaid,
  parseLooseJson,
  toEpayBills,
  type EpayBillsData,
} from "./types"

const QUERY_API_URL = "https://epay.ysu.edu.cn/pay/queryPayCode.html"
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
const REFERER = "https://epay.ysu.edu.cn/"

/** 学号/姓名的最大长度（防止超长输入）。 */
const MAX_ID_LEN = 32
const MAX_NAME_LEN = 64

export class EpayError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message)
    this.name = "EpayError"
  }
}

export interface EpayBillsResult extends EpayBillsData {
  /** 未缴记录（供提醒/页面高亮） */
  unpaid: EpayBillsData["bills"]
  /** 未缴合计（元） */
  unpaidTotal: number
  /** 查询时间 */
  queriedAt: number
}

/** 学号+姓名 → 缴费清单（无密码接口，查待缴）。 */
export async function fetchEpayBills(studentId: string, name: string): Promise<EpayBillsResult> {
  const id = studentId.trim()
  const nm = name.trim()
  if (!id || !nm) {
    throw new EpayError(-1, "学号或姓名为空")
  }
  if (id.length > MAX_ID_LEN || nm.length > MAX_NAME_LEN) {
    throw new EpayError(-1, "学号或姓名超长")
  }
  const res = await fetchStateless({
    method: "POST",
    url: QUERY_API_URL,
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": USER_AGENT,
      referer: REFERER,
    },
    body: new URLSearchParams({ userId: id, userName: nm }).toString(),
    redirect: "manual",
  })
  if (res.status !== 200) throw new EpayError(-1, `HTTP ${res.status}`)

  let parsed: unknown
  try {
    parsed = parseLooseJson(await res.text())
  } catch {
    throw new EpayError(-2, "返回非 JSON")
  }
  const data = toEpayBills(parsed)
  const unpaid = data.bills.filter((b) => b.code && isUnpaid(b.payStatus))
  const unpaidTotal = unpaid.reduce((s, b) => s + b.amount, 0)
  return { ...data, unpaid, unpaidTotal, queriedAt: Date.now() }
}
