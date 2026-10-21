import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The bridge gate is evaluated at module load from NEXT_PUBLIC_MACOS_APP, so each case
// must import the adapter after stubbing the environment.
const calls: { operation: string; payload: unknown }[] = []
let reply: Promise<unknown>

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv("NEXT_PUBLIC_MACOS_APP", "1")
  calls.length = 0
  reply = Promise.resolve({ granted: true })
  const appWindow: Record<string, unknown> = {
    location: { origin: "http://127.0.0.1:17346" },
    webkit: {
      messageHandlers: {
        ysuNative: {
          postMessage(message: { operation: string; payload: unknown }) {
            calls.push(message)
            return reply
          },
        },
      },
    },
  }
  appWindow.top = appWindow
  vi.stubGlobal("window", appWindow)
  vi.stubGlobal("localStorage", { getItem: () => null })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("macOS class notifications", () => {
  it("maps timetable alarms to final notification content", async () => {
    const { MacNotify } = await import("./macos-notify")
    await MacNotify.scheduleClassAlarms({
      alarmsJson: JSON.stringify([
        {
          alarmId: "高等数学|2026-09-07|1",
          alarmTime: 1_800_000_000_500,
          courseName: "高等数学",
          classroom: "A101",
          startTime: "08:00",
          remindMinutes: 15,
        },
      ]),
    })

    expect(calls).toEqual([
      {
        operation: "notify.scheduleClassAlarms",
        payload: {
          alarms: [
            {
              id: "高等数学|2026-09-07|1",
              title: "高等数学",
              body: "08:00 · A101",
              timeMs: 1_800_000_000_500,
            },
          ],
        },
      },
    ])
  })

  it("falls back to localized course and reminder text", async () => {
    const { MacNotify } = await import("./macos-notify")
    await MacNotify.scheduleClassAlarms({
      alarmsJson: JSON.stringify([
        { alarmId: "a", alarmTime: 1_800_000_000_000, remindMinutes: 20 },
      ]),
    })

    expect(calls[0]?.payload).toEqual({
      alarms: [{ id: "a", title: "课程", body: "20 分钟前上课", timeMs: 1_800_000_000_000 }],
    })
  })

  it.each([
    ["a non-array payload", JSON.stringify({ alarmId: "a", alarmTime: 1 })],
    ["a duplicate alarm", JSON.stringify([
      { alarmId: "a", alarmTime: 1_800_000_000_000 },
      { alarmId: "a", alarmTime: 1_800_000_001_000 },
    ])],
    ["a non-numeric time", JSON.stringify([{ alarmId: "a", alarmTime: "soon" }])],
    ["an empty alarm id", JSON.stringify([{ alarmId: "", alarmTime: 1_800_000_000_000 }])],
  ])("rejects %s before reaching the bridge", async (_label, alarmsJson) => {
    const { MacNotify } = await import("./macos-notify")
    await expect(MacNotify.scheduleClassAlarms({ alarmsJson })).rejects.toThrow(
      "Invalid class alarm"
    )
    expect(calls).toEqual([])
  })

  it("forwards permission checks and requests", async () => {
    const { MacNotify } = await import("./macos-notify")
    await expect(MacNotify.checkPermissions()).resolves.toEqual({ granted: true })
    reply = Promise.resolve({ granted: false })
    await expect(MacNotify.requestPermissions()).resolves.toEqual({ granted: false })

    await MacNotify.cancelClassAlarms()
    expect(calls.map((call) => call.operation)).toEqual([
      "notify.permission",
      "notify.requestPermission",
      "notify.cancelClassAlarms",
    ])
  })
})
