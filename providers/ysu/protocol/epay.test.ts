import { describe, expect, it } from "vitest"
import { toEpayRecords, toLastPay, toRecordStatus } from "./epay"

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
      ["9152380", "0", "1", "0", "2026年住宿费缴费 ", "2026年", "000000000001", "测试学生", "人民币元[CNY]", "870.0", "870.00", "870.00", "0.00", "0", "2026-09-01", "2026-09-01 11:05:16", "", "0", "", "0", ""],
      ["8859530", "0", "1", "0", "2026学年学费缴费 ", "2026年", "000000000001", "测试学生", "人民币元[CNY]", "10000.0", "10,000.00", "10,000.00", "0.00", "0", "2026-08-31", "2026-09-01 11:04:42", "", "0", "", "0", ""],
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
    expect(toRecordStatus({ overTime: "2026-09-01 11:05:16", expired: "0", status: "1" } as never)).toBe("paid")
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
})

describe("toLastPay", () => {
  it("从 {D:{lastPay}} 提取", () => {
    const body = {
      D: { lastPay: { amount: "870.00", rid: "6216649", payTime: "2026-09-01 11:05:16", payName: "2026年住宿费缴费", currencyTypeShow: "人民币元[CNY]" } },
    }
    const lp = toLastPay(body)
    expect(lp).not.toBeNull()
    expect(lp!.amount).toBe("870.00")
    expect(lp!.payName).toContain("住宿费")
  })
})