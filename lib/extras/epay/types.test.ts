import { describe, expect, it } from "vitest"
import { isUnpaid, parseLooseJson, toEpayBills } from "./types"

/** 真实探测到的响应结构（假数据：rowCount 0、names 1..7、无 rows） */
const EMPTY_BODY = {
  D: {
    root: "",
    modelNameTag: "model",
    modelName: "queryPayCode",
    offcampusHasAndType: "true",
    servletName: "pay",
    payCodeData: {
      names: {
        id: 1,
        userId: 2,
        userName: 3,
        payName: 4,
        paypassword: 5,
        amount: 6,
        payStatus: 7,
      },
      rowCount: 0,
      rows: [],
    },
  },
}

describe("toEpayBills", () => {
  it("空清单：rowCount 0、无 rows", () => {
    const data = toEpayBills(EMPTY_BODY)
    expect(data.rowCount).toBe(0)
    expect(data.bills).toEqual([])
  })

  it("按 names 动态映射解析整行（含金额/状态混合类型）", () => {
    const body = {
      D: {
        payCodeData: {
          names: {
            id: 1,
            userId: 2,
            userName: 3,
            payName: 4,
            paypassword: 5,
            amount: 6,
            payStatus: 7,
          },
          rowCount: 1,
          rows: [
            ["1", "202000000001", "张三", "2025-2026学年学费", "AB12CD34EF567890", "5500", "未支付"],
          ],
        },
      },
    }
    const data = toEpayBills(body)
    expect(data.rowCount).toBe(1)
    expect(data.bills).toHaveLength(1)
    const b = data.bills[0]!
    expect(b.id).toBe("1")
    expect(b.userId).toBe("202000000001")
    expect(b.userName).toBe("张三")
    expect(b.payName).toBe("2025-2026学年学费")
    expect(b.code).toBe("AB12CD34EF567890")
    expect(b.amount).toBe(5500)
    expect(b.payStatus).toBe("未支付")
  })

  it("金额为数字时不强制转字符串", () => {
    const body = {
      D: {
        payCodeData: {
          names: { amount: 6, payName: 4, paypassword: 5, payStatus: 7 },
          rowCount: 1,
          rows: [[undefined, undefined, undefined, "住宿费", "0000000000000001", 800.5, "未支付"]],
        },
      },
    }
    const data = toEpayBills(body)
    expect(data.bills[0]!.amount).toBe(800.5)
  })

  it("names 下标变化时仍能解析（动态映射的意义）", () => {
    const body = {
      D: {
        payCodeData: {
          names: { payName: 1, paypassword: 2, amount: 3, payStatus: 4 },
          rowCount: 1,
          rows: [["重修费", "ABCDEF0123456789", "200", "已支付"]],
        },
      },
    }
    const b = toEpayBills(body).bills[0]!
    expect(b.payName).toBe("重修费")
    expect(b.code).toBe("ABCDEF0123456789")
    expect(b.amount).toBe(200)
    expect(b.payStatus).toBe("已支付")
  })

  it("无 payName 的行跳过", () => {
    const body = {
      D: {
        payCodeData: {
          names: { payName: 1 },
          rowCount: 2,
          rows: [
            ["学费"],
            [""],
          ],
        },
      },
    }
    expect(toEpayBills(body).bills).toHaveLength(1)
  })

  it("异常结构容错", () => {
    expect(toEpayBills(null)).toEqual({ rowCount: 0, bills: [] })
    expect(toEpayBills({ D: {} })).toEqual({ rowCount: 0, bills: [] })
    expect(toEpayBills({ D: { payCodeData: null } })).toEqual({ rowCount: 0, bills: [] })
  })
})

describe("isUnpaid", () => {
  it("网页端 '未支付'", () => {
    expect(isUnpaid("未支付")).toBe(true)
  })
  it("已支付/空值为 false", () => {
    expect(isUnpaid("已支付")).toBe(false)
    expect(isUnpaid("")).toBe(false)
  })
})

describe("parseLooseJson（平台返回宽松 JSON，key 不带引号）", () => {
  it("真实应答形态可解析", () => {
    const raw =
      '{D:{root:"",modelNameTag:"model",modelName:"queryPayCode","offcampusHasAndType":"true",servletName:"pay",payCodeData:{names:{"id":1,"userId":2,"userName":3,"payName":4,"paypassword":5,"amount":6,"payStatus":7},rowCount:0,rows:[]}}}'
    const parsed = parseLooseJson(raw) as { D: { payCodeData: { rowCount: number } } }
    expect(parsed.D.payCodeData.rowCount).toBe(0)
  })

  it("严格 JSON 也能解析（向后兼容）", () => {
    const strict = '{"D":{"payCodeData":{"rowCount":1,"rows":[]}}}'
    expect(parseLooseJson(strict)).toEqual({ D: { payCodeData: { rowCount: 1, rows: [] } } })
  })

  it("超长输入被拒（防止超大 payload）", () => {
    const huge = "x".repeat(2 * 1024 * 1024 + 1)
    expect(() => parseLooseJson(huge)).toThrow()
  })

  it("非字符串输入被拒", () => {
    // @ts-expect-error 故意传非字符串测试
    expect(() => parseLooseJson(null)).toThrow()
  })
})

describe("toEpayBills 端到端（宽松 JSON 响应）", () => {
  it("真实形态 + 有记录：解析出未缴/已缴", () => {
    const raw =
      '{D:{payCodeData:{names:{"id":1,"userId":2,"userName":3,"payName":4,"paypassword":5,"amount":6,"payStatus":7},rowCount:1,rows:[["1","202000000001","张三","2025-2026学年学费","AB12CD34EF567890","5500","未支付"]]}}}'
    const data = toEpayBills(parseLooseJson(raw))
    expect(data.bills).toHaveLength(1)
    const b = data.bills[0]!
    expect(b.payName).toBe("2025-2026学年学费")
    expect(b.amount).toBe(5500)
    expect(b.payStatus).toBe("未支付")
    expect(b.code).toBe("AB12CD34EF567890")
    expect(isUnpaid(b.payStatus)).toBe(true)
  })
})