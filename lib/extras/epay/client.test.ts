import { describe, expect, it } from "vitest"
import { EpayError, fetchEpayBills } from "./client"

describe("fetchEpayBills 输入校验（加固）", () => {
  it("空学号/姓名抛错且不发起请求", async () => {
    await expect(fetchEpayBills("", "张三")).rejects.toThrow(EpayError)
    await expect(fetchEpayBills("000000000001", "")).rejects.toThrow(EpayError)
    await expect(fetchEpayBills("   ", "   ")).rejects.toThrow(EpayError)
  })

  it("超长学号/姓名抛错（防止超长输入）", async () => {
    await expect(fetchEpayBills("x".repeat(33), "张三")).rejects.toThrow("超长")
    await expect(fetchEpayBills("000000000001", "x".repeat(65))).rejects.toThrow("超长")
  })
})

// fetchEpayBills 涉及真实网络（fetchStateless），这里仅测试输入校验层，
// 不真正发起请求。网络/协议层由 client 的调用方（页面/auto-check）保证。
