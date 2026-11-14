import { describe, expect, it, vi } from "vitest"
import { YSUProvider } from "./ysu-provider"

describe("YSUProvider evaluation tasks", () => {
  it("只查询有待办任务的评教类型", async () => {
    const provider = Object.create(YSUProvider.prototype) as YSUProvider
    provider.getEvaluationTypes = vi.fn().mockResolvedValue([
      { name: "学生评教", code: "01", count: 0 },
      { name: "督导评教", code: "02", count: 2 },
    ])
    provider.getPendingEvaluations = vi.fn().mockResolvedValue([{ name: "任务" }])

    await expect(provider.getEvaluationTasks()).resolves.toEqual([{ name: "任务" }])
    expect(provider.getPendingEvaluations).toHaveBeenCalledExactlyOnceWith("02", undefined)
  })
})
