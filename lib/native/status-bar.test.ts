import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClassPeriod, Course, CurrentWeek } from "@/providers/types"
import { computeStatusBarClasses } from "./status-bar"

const NOW = Date.parse("2026-09-07T08:00:00+08:00")
const week: CurrentWeek = { week: 1, weekday: 1, date: "2026-09-07", semester: "2026-2027-1" }
const periods: ClassPeriod[] = [
  { section: 1, startTime: "10:00", endTime: "10:45", isInUse: true },
  { section: 2, startTime: "10:55", endTime: "11:40", isInUse: true },
]
const course: Course = {
  name: "高等数学",
  classroom: "A101",
  weekDay: 2,
  startSection: 1,
  endSection: 2,
  weekList: [1, 2, 3],
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("status bar class forecast", () => {
  it("expands the next teaching day into concrete start and end times", () => {
    const classes = computeStatusBarClasses([course], week, periods, undefined, NOW)
    expect(classes).toEqual([
      {
        name: "高等数学",
        classroom: "A101",
        startsAt: Date.parse("2026-09-08T10:00:00+08:00"),
        endsAt: Date.parse("2026-09-08T11:40:00+08:00"),
      },
    ])
  })

  it("drops classes that already ended and weeks that are not active", () => {
    const endedMonday: Course = { ...course, name: "早课", weekDay: 1 }
    const nextWeek: Course = { ...course, name: "下周课", weekList: [2] }
    const classes = computeStatusBarClasses(
      [endedMonday, nextWeek],
      { ...week, week: 1 },
      periods,
      undefined,
      NOW + 4 * 3_600_000
    )
    expect(classes.map((entry) => entry.name)).not.toContain("早课")
    expect(classes.map((entry) => entry.name)).not.toContain("下周课")
  })

  it("returns no entries without periods or a resolved week", () => {
    expect(computeStatusBarClasses([course], week, [], undefined, NOW)).toEqual([])
    expect(computeStatusBarClasses([course], null, periods, undefined, NOW)).toEqual([])
  })
})

describe("status bar bridge", () => {
  // The bridge gate is evaluated at import time from NEXT_PUBLIC_MACOS_APP.
  it("pushes classes once per change and clears on demand", async () => {
    vi.resetModules()
    vi.stubEnv("NEXT_PUBLIC_MACOS_APP", "1")
    const calls: { operation: string; payload: unknown }[] = []
    const appWindow: Record<string, unknown> = {
      location: { origin: "http://127.0.0.1:17346" },
      webkit: {
        messageHandlers: {
          ysuNative: {
            postMessage(message: { operation: string; payload: unknown }) {
              calls.push(message)
              return Promise.resolve({ updated: 1 })
            },
          },
        },
      },
    }
    appWindow.top = appWindow
    vi.stubGlobal("window", appWindow)
    vi.stubGlobal("localStorage", { getItem: () => null })

    const statusBar = await import("./status-bar")
    await statusBar.syncStatusBarClasses([course], week, periods)
    await statusBar.syncStatusBarClasses([course], week, periods)
    await statusBar.clearStatusBarClasses()

    expect(calls.map((call) => call.operation)).toEqual([
      "status.setClasses",
      "status.clear",
    ])
    const pushed = calls[0]?.payload
    if (!pushed || typeof pushed !== "object" || !("classes" in pushed) || !Array.isArray(pushed.classes)) {
      throw new Error("missing pushed classes")
    }
    expect(pushed.classes).toHaveLength(1)
  })
})
