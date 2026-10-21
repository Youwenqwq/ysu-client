import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Course } from "@/providers/types"

// Module-level `stopped` and the platform gate require a fresh import per case.
vi.mock("./platform", () => ({ isCapacitor: () => false }))
vi.mock("./macos", () => ({ isMacOSNative: () => true }))
vi.mock("./macos-notify", () => ({
  MacNotify: {
    checkPermissions: vi.fn(async () => ({ granted: true })),
    requestPermissions: vi.fn(async () => ({ granted: true })),
    scheduleClassAlarms: vi.fn(async () => {}),
    cancelClassAlarms: vi.fn(async () => {}),
  },
}))
vi.mock("./notify-plugin", () => ({
  NotifyPlugin: {
    stopPolling: vi.fn(async () => {}),
    clearCastgc: vi.fn(async () => {}),
    cancelClassAlarms: vi.fn(async () => {}),
    scheduleClassAlarms: vi.fn(async () => {}),
    checkPermissions: vi.fn(async () => ({ granted: false })),
    requestPermissions: vi.fn(async () => ({ granted: false })),
  },
}))
vi.mock("../stores/auth", async () => {
  const { createStore } = await import("zustand/vanilla")
  return {
    useAuthStore: createStore(() => ({
      isAuthenticated: true,
      hasHydrated: true,
      username: "student",
      credential: "credential",
      sessionExpired: false,
    })),
  }
})
vi.mock("../stores/settings", async () => {
  const { createStore } = await import("zustand/vanilla")
  return {
    useSettingsStore: createStore((set) => ({
      hasHydrated: true,
      notifyEnabled: false,
      notifyCheckInterval: 60,
      notifyGrades: true,
      notifyExams: true,
      notifyNetworkError: false,
      classReminderEnabled: false,
      classReminderMinutes: 15,
      classReminderDays: 7,
      setNotifyEnabled: (notifyEnabled: boolean) => set({ notifyEnabled }),
      setClassReminderEnabled: (classReminderEnabled: boolean) => set({ classReminderEnabled }),
    })),
  }
})

const week = { week: 1, weekday: 1, date: "2026-09-07", semester: "2026-2027-1" }
const periods = [{ section: 1, startTime: "10:00", isInUse: true }]
const course: Course = {
  name: "Math",
  classroom: "A101",
  weekDay: 2,
  startSection: 1,
  endSection: 2,
  weekList: [1, 2, 3],
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-07T08:00:00+08:00"))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("macOS class reminder backend", () => {
  it("schedules through MacNotify and never starts Capacitor polling", async () => {
    const notify = await import("./notify")
    const { MacNotify } = await import("./macos-notify")
    const { NotifyPlugin } = await import("./notify-plugin")

    const unsubscribe = notify.observeNativeNotifications(undefined, "ysu")
    expect(await notify.setNotificationEnabled("classes", true)).toBe(true)
    await notify.syncClassAlarmsToNative([course], week, periods)
    await notify.syncNativeNotifications()

    const scheduled = vi.mocked(MacNotify.scheduleClassAlarms).mock.calls
    expect(scheduled).toHaveLength(1)
    const alarms = JSON.parse(scheduled[0]![0].alarmsJson) as { alarmId: string }[]
    expect(alarms).toHaveLength(1)
    expect(alarms[0]?.alarmId).toContain("Math")
    expect(NotifyPlugin.scheduleClassAlarms).not.toHaveBeenCalled()
    expect(NotifyPlugin.stopPolling).not.toHaveBeenCalled()
    expect(NotifyPlugin.checkPermissions).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("cancels macOS alarms when reminders are disabled", async () => {
    const notify = await import("./notify")
    const { MacNotify } = await import("./macos-notify")
    const { useSettingsStore } = await import("../stores/settings")

    const unsubscribe = notify.observeNativeNotifications(undefined, "ysu")
    useSettingsStore.setState({ classReminderEnabled: true })
    await notify.syncClassAlarmsToNative([course], week, periods)
    await notify.setNotificationEnabled("classes", false)
    expect(MacNotify.cancelClassAlarms).toHaveBeenCalled()
    unsubscribe()
  })
})
