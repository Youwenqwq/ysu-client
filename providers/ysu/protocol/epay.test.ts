import { describe, expect, it } from "vitest"
import {
  mergeRecords,
  toEpayRecords,
  toLastPay,
  toRecordStatus,
  toUnpaidRecords,
  type EpayRecord,
} from "./epay"

/** 真实探测到的 allPay 数据块（D 对象值），敏感值保留以验证字段映射 */
const D = {
  root: "",
  modelNameTag: "model",
  modelName: "allPay",
  queryResult: {
    names: {
      id: 1,
      hasLinkId: 2,
      status: 3,
      expired: 4,
      payName: 5,
      chargeYear: 6,
      userId: 7,
      userName: 8,
      currencyTypeShow: 9,
      amountN: 10,
      amount: 11,
      payAmount: 12,
      refundAmount: 13,
      payFlag: 14,
      startTime: 15,
      overTime: 16,
      opt: 17,
      isByUserBW: 18,
      merchantCode: 19,
      systemFlag: 20,
      agentPayer: 21,
    },
    rowCount: 5,
    rows: [
      [
        "9152380",
        "0",
        "1",
        "0",
        "2026年住宿费缴费 ",
        "2026年",
        "000000000001",
        "测试学生",
        "人民币元[CNY]",
        "870.0",
        "870.00",
        "870.00",
        "0.00",
        "0",
        "2026-09-01",
        "2026-09-01 11:05:16",
        "",
        "0",
        "",
        "0",
        "",
      ],
      [
        "8859530",
        "0",
        "1",
        "0",
        "2026学年学费缴费 ",
        "2026年",
        "000000000001",
        "测试学生",
        "人民币元[CNY]",
        "10000.0",
        "10,000.00",
        "10,000.00",
        "0.00",
        "0",
        "2026-08-31",
        "2026-09-01 11:04:42",
        "",
        "0",
        "",
        "0",
        "",
      ],
    ],
    pageNum: 0,
    pageSize: 15,
    searchName: "pay.list.normal.search",
    totalCount: 5,
    hasNextPage: 0,
  },
  currentUserId: "000000000001",
  servletName: "pay",
  userType: "normal",
}

describe("toEpayRecords", () => {
  it("按 names 1 基下标解析两条真实记录", () => {
    const records = toEpayRecords(D)
    expect(records).toHaveLength(2)
    const r0 = records[0]!
    expect(r0.payName).toContain("住宿费")
    expect(r0.chargeYear).toBe("2026年")
    expect(r0.amountN).toBe(870)
    expect(r0.amount).toBe("870.00")
    expect(r0.payAmount).toBe("870.00")
    expect(r0.overTime).toBe("2026-09-01 11:05:16")
    const r1 = records[1]!
    expect(r1.payName).toContain("学费")
    expect(r1.amountN).toBe(10000)
    expect(r1.amount).toBe("10,000.00")
  })

  it("空 queryResult 返回空数组", () => {
    expect(toEpayRecords({})).toEqual([])
    expect(toEpayRecords({ queryResult: null })).toEqual([])
    expect(toEpayRecords(null)).toEqual([])
  })
})

describe("toRecordStatus", () => {
  it("有 overTime → paid", () => {
    expect(
      toRecordStatus({ overTime: "2026-09-01 11:05:16", expired: "0", status: "1" } as never)
    ).toBe("paid")
  })
  it("expired=1 → expired", () => {
    expect(toRecordStatus({ overTime: "", expired: "1", status: "1" } as never)).toBe("expired")
  })
  it("status=0 且无 time → closed", () => {
    expect(toRecordStatus({ overTime: "", expired: "0", status: "0" } as never)).toBe("closed")
  })
  it("空 overTime 且 status=1 → unpaid", () => {
    expect(toRecordStatus({ overTime: "", expired: "0", status: "1" } as never)).toBe("unpaid")
  })
  it("未知或缺失状态不判定为未缴", () => {
    expect(toRecordStatus({ overTime: "", expired: "", status: "" } as never)).toBe("unknown")
    expect(toRecordStatus({ overTime: "", expired: "0", status: "2" } as never)).toBe("unknown")
  })
})

describe("toLastPay", () => {
  it("从 {D:{lastPay}} 提取", () => {
    const body = {
      D: {
        lastPay: {
          amount: "870.00",
          rid: "6216649",
          payTime: "2026-09-01 11:05:16",
          payName: "2026年住宿费缴费",
          currencyTypeShow: "人民币元[CNY]",
        },
      },
    }
    const lp = toLastPay(body)
    expect(lp).not.toBeNull()
    expect(lp!.amount).toBe("870.00")
    expect(lp!.payName).toContain("住宿费")
  })
})

describe("mergeRecords（allPay 已缴 + index 待缴 双源合并）", () => {
  const mk = (id: string, overTime: string): EpayRecord => ({
    id,
    payName: `费用${id}`,
    chargeYear: "2026年",
    currencyTypeShow: "人民币元[CNY]",
    amountN: 100,
    amount: "100.00",
    payAmount: "",
    refundAmount: "0.00",
    status: "1",
    expired: "0",
    startTime: "",
    overTime,
  })

  it("allPay 已缴 + index 待缴合并后都保留", () => {
    const history = [mk("1", "2026-09-01")]
    const pending = [mk("2", "")]
    const merged = mergeRecords(history, pending)
    expect(merged).toHaveLength(2)
    const ids = merged.map((r) => r.id)
    expect(ids).toContain("1")
    expect(ids).toContain("2")
  })

  it("同一 id 只保留一份（去重）", () => {
    const history = [mk("1", "2026-09-01")]
    const pending = [mk("1", "")]
    const merged = mergeRecords(history, pending)
    expect(merged).toHaveLength(1)
  })

  it("只有待缴(无历史)也能识别为未缴", () => {
    const merged = mergeRecords([], [mk("9", "")])
    expect(merged).toHaveLength(1)
    expect(toRecordStatus(merged[0]!)).toBe("unpaid")
  })
})

describe("toUnpaidRecords（待缴以 index 官方口径为准）", () => {
  const mk = (id: string, opts: Partial<EpayRecord> = {}): EpayRecord => ({
    id,
    payName: `费用${id}`,
    chargeYear: "2026年",
    currencyTypeShow: "人民币元[CNY]",
    amountN: 100,
    amount: "100.00",
    payAmount: "",
    refundAmount: "0.00",
    status: "1",
    expired: "0",
    startTime: "",
    overTime: "",
    ...opts,
  })

  it("有效未支付(overTime空,status1,expired0) 记为待缴", () => {
    const unpaid = toUnpaidRecords([mk("1")])
    expect(unpaid).toHaveLength(1)
    expect(unpaid[0]!.id).toBe("1")
  })

  it("已支付的(overTime 非空) 不记待缴", () => {
    expect(toUnpaidRecords([mk("1", { overTime: "2026-09-01 10:00:00" })])).toHaveLength(0)
  })

  it("已过期的(expired=1) 不记待缴", () => {
    expect(toUnpaidRecords([mk("2", { expired: "1" })])).toHaveLength(0)
  })

  it("已关闭的(status=0) 不记待缴", () => {
    expect(toUnpaidRecords([mk("3", { status: "0" })])).toHaveLength(0)
  })

  it("混合列表只保留有效待缴", () => {
    const pending = [
      mk("a"),
      mk("b", { overTime: "2026-09-01" }),
      mk("c", { expired: "1" }),
      mk("d", { status: "0" }),
    ]
    const unpaid = toUnpaidRecords(pending)
    expect(unpaid.map((r) => r.id)).toEqual(["a"])
  })
})
