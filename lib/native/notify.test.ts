import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClassAlarmConfig } from "./notify"
import type { Course } from "@/providers/types"

const native = vi.hoisted(() => ({
  alarms: [] as ClassAlarmConfig[],
  polling: null as Record<string, unknown> | null,
  castgc: "",
  expired: false,
  granted: true,
  getAuthToken: vi.fn(),
  schedule: vi.fn(),
  requestPermissions: vi.fn(),
}))

vi.mock("./platform", () => ({ isCapacitor: () => true }))
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
vi.mock("./notify-plugin", () => ({
  NotifyPlugin: {
    setServerConfig: async () => {},
    setProviderIdentity: async () => {},
    setCastgc: async ({ castgc }: { castgc: string }) => {
      native.castgc = castgc
      native.expired = false
    },
    clearCastgc: async () => {
      native.castgc = ""
    },
    startPolling: async (options: Record<string, unknown>) => {
      native.polling = options
    },
    stopPolling: async () => {
      native.polling = null
    },
    executeOnce: async () => {},
    checkPermissions: async () => ({ granted: native.granted }),
    requestPermissions: native.requestPermissions,
    cancelClassAlarms: async () => {
      native.alarms = []
    },
    scheduleClassAlarms: native.schedule,
  },
}))

let notify: typeof import("./notify")
let auth: typeof import("../stores/auth").useAuthStore
let settings: typeof import("../stores/settings").useSettingsStore
let unsubscribe: () => void
const week = { week: 1, weekday: 1 }
const periods = [{ section: 1, startTime: "10:00", isInUse: true }]
const course: Course = {
  name: "Math",
  classroom: "A101",
  weekDay: 2,
  startSection: 1,
  endSection: 2,
  weekList: [1, 2, 3],
}

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 7, 8))
  native.alarms = []
  native.polling = null
  native.castgc = ""
  native.expired = false
  native.granted = true
  native.getAuthToken.mockReset().mockResolvedValue("fresh-token")
  native.requestPermissions.mockReset().mockResolvedValue({ granted: false })
  native.schedule.mockReset().mockImplementation(async ({ alarmsJson }: { alarmsJson: string }) => {
    native.alarms = JSON.parse(alarmsJson)
  })
  notify = await import("./notify")
  auth = (await import("../stores/auth")).useAuthStore
  settings = (await import("../stores/settings")).useSettingsStore
  auth.setState(auth.getInitialState(), true)
  settings.setState(settings.getInitialState(), true)
  unsubscribe = notify.observeNativeNotifications(
    {
      getAuthToken: native.getAuthToken,
      getServerConfig: () => ({}),
    },
    "ysu"
  )
  await notify.syncNativeNotifications()
})

afterEach(() => {
  unsubscribe()
  vi.useRealTimers()
})

describe("native notification lifecycle", () => {
  it("clears persisted alarms on a fresh disabled controller without a JavaScript hash", async () => {
    native.alarms = [
      {
        alarmId: "old",
        alarmTime: Date.now() + 60_000,
        courseName: "Old course",
        classroom: "",
        startTime: "10:00",
        remindMinutes: 15,
      },
    ]
    unsubscribe()
    unsubscribe = notify.observeNativeNotifications(
      {
        getAuthToken: native.getAuthToken,
        getServerConfig: () => ({}),
      },
      "ysu"
    )
    await notify.syncNativeNotifications()
    expect(native.alarms).toEqual([])
  })

  it("replaces changed locations, start times and reminder offsets even with identical alarm IDs", async () => {
    settings.setState({ classReminderEnabled: true })
    await notify.syncClassAlarmsToNative([course], week, periods)
    const original = native.alarms[0]!
    await notify.syncClassAlarmsToNative([{ ...course, classroom: "B202" }], week, [
      { ...periods[0]!, startTime: "11:00" },
    ])
    settings.setState({ classReminderMinutes: 30 })
    await notify.syncNativeNotifications()
    expect(native.alarms[0]).toEqual({
      ...original,
      classroom: "B202",
      startTime: "11:00",
      remindMinutes: 30,
      alarmTime: original.alarmTime + 45 * 60_000,
    })
  })

  it("reschedules cached full courses across weeks when days change, without another schedule fetch", async () => {
    settings.setState({ classReminderEnabled: true })
    await notify.syncClassAlarmsToNative([{ ...course, weekList: [2] }], week, periods)
    expect(native.alarms).toEqual([])
    settings.setState({ classReminderDays: 14 })
    await notify.syncNativeNotifications()
    expect(native.alarms.map((alarm) => alarm.alarmTime)).toEqual([
      new Date(2026, 8, 15, 9, 45).getTime(),
    ])
  })

  it("cancels on disable, restores unchanged cached alarms on enable, and clears empty schedules", async () => {
    await notify.syncClassAlarmsToNative([course], week, periods)
    await notify.setNotificationEnabled("classes", true)
    const expected = [...native.alarms]
    expect(expected[0]?.courseName).toBe("Math")
    await notify.setNotificationEnabled("classes", false)
    expect(native.alarms).toEqual([])
    await notify.setNotificationEnabled("classes", true)
    expect(native.alarms).toEqual(expected)
    await notify.syncClassAlarmsToNative([], week, periods)
    expect(native.alarms).toEqual([])
  })

  it("does not mark a rejected native schedule successful, allowing the same payload to retry", async () => {
    settings.setState({ classReminderEnabled: true })
    native.schedule.mockRejectedValueOnce(new Error("AlarmManager unavailable"))
    await expect(notify.syncClassAlarmsToNative([course], week, periods)).rejects.toThrow(
      "AlarmManager unavailable"
    )
    await notify.syncClassAlarmsToNative([course], week, periods)
    expect(native.alarms[0]?.courseName).toBe("Math")
  })

  it("applies the latest polling options without restarting with intermediate UI values", async () => {
    await notify.startNativePolling()
    settings.setState({ notifyCheckInterval: 120, notifyGrades: false })
    settings.setState({ notifyExams: false, notifyNetworkError: true })
    await notify.syncNativeNotifications()
    expect(native.polling).toEqual({
      intervalMinutes: 120,
      checkGrades: false,
      checkExams: false,
      notifyNetworkError: true,
    })
  })

  it("refreshes an expired native token after relogin while authentication stays true", async () => {
    await notify.startNativePolling()
    auth.setState({ sessionExpired: true })
    await notify.syncNativeNotifications()
    native.expired = true
    native.getAuthToken.mockResolvedValue("renewed-token")
    auth.setState({ sessionExpired: false })
    await notify.syncNativeNotifications(true, true)
    expect(native.castgc).toBe("renewed-token")
    expect(native.expired).toBe(false)
    expect(native.polling?.intervalMinutes).toBe(60)
  })

  it("cannot restore polling when a token lookup finishes after logout", async () => {
    const token = Promise.withResolvers<string>()
    const started = Promise.withResolvers<void>()
    native.getAuthToken.mockImplementation(() => {
      started.resolve()
      return token.promise
    })
    settings.setState({ notifyEnabled: true })
    await started.promise
    notify.stopNotify()
    auth.setState({ isAuthenticated: false, username: null })
    token.resolve("obsolete-token")
    await notify.syncNativeNotifications()
    expect(native.polling).toBeNull()
    expect(native.castgc).toBe("")
  })

  it("does not enable either feature when notification permission is refused", async () => {
    native.granted = false
    expect(await notify.setNotificationEnabled("classes", true)).toBe(false)
    expect(await notify.setNotificationEnabled("polling", true)).toBe(false)
    expect(settings.getState().classReminderEnabled).toBe(false)
    expect(settings.getState().notifyEnabled).toBe(false)
  })

  it("ignores a granted permission prompt that completes after logout", async () => {
    native.granted = false
    const permission = Promise.withResolvers<{ granted: boolean }>()
    native.requestPermissions.mockReturnValue(permission.promise)
    const enabling = notify.setNotificationEnabled("classes", true)
    await Promise.resolve()
    notify.stopNotify()
    permission.resolve({ granted: true })
    expect(await enabling).toBe(false)
    expect(settings.getState().classReminderEnabled).toBe(false)
    await notify.syncNativeNotifications()
  })
})
