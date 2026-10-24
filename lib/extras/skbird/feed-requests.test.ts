import { describe, expect, it } from "vitest"
import { SkbirdFeedRequests } from "./feed-requests"

describe("SkbirdFeedRequests", () => {
  it("切换筛选立即启动新请求，旧响应和结束回调不能覆盖新状态", async () => {
    const requests = new SkbirdFeedRequests()
    const state = { results: "", cursor: "0", loading: true, error: "" }
    let resolveOld!: (value: string) => void
    const oldResponse = new Promise<string>((resolve) => {
      resolveOld = resolve
    })
    const old = requests.begin(false)!
    const oldTask = oldResponse.then((value) => {
      if (requests.isCurrent(old)) {
        state.results = value
        state.cursor = "old-cursor"
        state.loading = false
      }
      requests.finish(old)
    })

    const current = requests.begin(false)!
    resolveOld("旧栏目")
    await oldTask
    expect(state).toEqual({ results: "", cursor: "0", loading: true, error: "" })
    expect(requests.isCurrent(current)).toBe(true)

    if (requests.isCurrent(current)) {
      state.results = "新栏目"
      state.cursor = "new-cursor"
      state.loading = false
      requests.finish(current)
    }
    expect(state).toMatchObject({ results: "新栏目", cursor: "new-cursor", loading: false })
  })

  it("加载期间阻止重复触底请求，完成后允许下一页", () => {
    const requests = new SkbirdFeedRequests()
    const initial = requests.begin(false)!
    expect(requests.begin(true)).toBeNull()
    requests.finish(initial)
    const page = requests.begin(true)!
    expect(page).not.toBeNull()
    expect(requests.begin(true)).toBeNull()
    requests.finish(page)
    expect(requests.begin(true)).not.toBeNull()
  })

  it("离开页面或更换筛选后忽略旧错误，新请求不会复用旧标识", async () => {
    const requests = new SkbirdFeedRequests()
    let rejectOld!: (error: Error) => void
    const response = new Promise<never>((_, reject) => {
      rejectOld = reject
    })
    const old = requests.begin(false)!
    let error = ""
    const task = response.catch((e: Error) => {
      if (requests.isCurrent(old)) error = e.message
    })
    requests.invalidate()
    const current = requests.begin(false)!
    rejectOld(new Error("旧请求失败"))
    await task
    expect(error).toBe("")
    expect(current).not.toBe(old)
    expect(requests.isCurrent(current)).toBe(true)
    requests.invalidate()
    expect(requests.isCurrent(current)).toBe(false)
  })
})
