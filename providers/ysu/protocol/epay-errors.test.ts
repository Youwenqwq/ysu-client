import { describe, expect, it, vi } from "vitest"
import type { HttpResponse } from "@/lib/cookie"

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  getCredentialApplied: vi.fn(),
  isAuthenticated: vi.fn(),
  fetchWithJar: vi.fn<(jar: unknown, req: unknown) => Promise<HttpResponse>>(),
}))

vi.mock("@/lib/cookie", () => ({
  SimpleCookieJar: class {
    async getAllCookies() {
      return []
    }
  },
  fetchWithJar: mocks.fetchWithJar,
  parseLooseJson: vi.fn(),
}))
vi.mock("./cas", () => ({
  authorize: mocks.authorize,
  getCredentialApplied: mocks.getCredentialApplied,
  isAuthenticated: mocks.isAuthenticated,
}))
vi.mock("../auth-transition", () => ({
  waitForAuthTransition: vi.fn().mockResolvedValue(undefined),
  withAuthTransition: <T>(operation: () => Promise<T>) => operation(),
}))

import { getEpayStatus } from "./epay"

function response(text: string): HttpResponse {
  return {
    status: 200,
    headers: {},
    url: "https://epay.ysu.edu.cn/pay/allPay.html",
    text: async () => text,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

describe("getEpayStatus 主记录查询", () => {
  it("allPay 响应缺少数据块时抛错而不是返回空记录", async () => {
    mocks.authorize.mockResolvedValue(undefined)
    mocks.getCredentialApplied.mockResolvedValue(undefined)
    mocks.isAuthenticated.mockResolvedValue(true)
    mocks.fetchWithJar.mockResolvedValue(response("<html>unexpected response</html>"))

    await expect(getEpayStatus()).rejects.toThrow("invalid allPay response")
  })
})
