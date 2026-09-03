import { describe, expect, it } from "vitest"
import { toEcardBalance } from "./ecard"

/** 真实抓包结构（余额 18.55，学号已脱敏） */
const REAL = {
  id: "000000000001",
  datas: {
    DM: "1",
    KYXQ: "2029-08-31",
    KH: "000000000001",
    KNYE: 18.55,
    MC: "在用",
    SFRZH: "000000000001",
  },
  status: 200,
  cardstatuscode: "1",
  cardnum: "000000000001",
  availdate: "2029-08-31",
  remining: "18.55",
  code: 200,
  yearMonths: ["2026-09", "2026-08", "2026-07"],
  cardstatusname: "在用",
}

describe("toEcardBalance", () => {
  it("真实结构解析（顶层字段优先）", () => {
    const b = toEcardBalance(REAL)
    expect(b).not.toBeNull()
    expect(b!.balance).toBeCloseTo(18.55)
    expect(b!.cardNum).toBe("000000000001")
    expect(b!.availableDate).toBe("2029-08-31")
    expect(b!.cardStatusName).toBe("在用")
    expect(b!.months).toEqual(["2026-09", "2026-08", "2026-07"])
  })

  it("datas 字段兜底（顶层缺失时）", () => {
    const body = { datas: { KNYE: "5.00", KYXQ: "2025-01-01", MC: "在用", KH: "123" } }
    const b = toEcardBalance(body)
    expect(b!.balance).toBe(5)
    expect(b!.availableDate).toBe("2025-01-01")
    expect(b!.cardStatusName).toBe("在用")
    expect(b!.cardNum).toBe("123")
  })

  it("无余额字段返回 null", () => {
    expect(toEcardBalance({})).toBeNull()
    expect(toEcardBalance({ datas: {} })).toBeNull()
    expect(toEcardBalance(null)).toBeNull()
  })
})