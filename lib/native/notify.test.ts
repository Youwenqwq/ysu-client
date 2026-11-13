import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClassAlarmConfig } from "./notify"
import type { Course, TermCalendar } from "@/providers/types"

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
      classLiveUpdateEnabled: false,
      classVibrationEnabled: false,
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

beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-09-07T08:00:00+08:00"))
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

  it("replaces changed locations and start times even with identical alarm IDs", async () => {
    settings.setState({ classReminderEnabled: true })
    await notify.syncClassAlarmsToNative([course], week, periods)
    const original = native.alarms[0]!
    await notify.syncClassAlarmsToNative([{ ...course, classroom: "B202" }], week, [
      { ...periods[0]!, startTime: "11:00" },
    ])
    expect(native.alarms[0]).toEqual({
      ...original,
      classroom: "B202",
      startTime: "11:00",
      remindMinutes: 15,
      alarmTime: original.alarmTime + 60 * 60_000,
    })
  })

  it("resyncs independent Live Update and vibration choices without another schedule fetch", async () => {
    settings.setState({ classReminderEnabled: true })
    await notify.syncClassAlarmsToNative([course], week, periods)
    const original = native.alarms[0]!
    expect(original).toMatchObject({
      liveUpdateEnabled: false,
      vibrationEnabled: false,
      remindMinutes: 15,
      alarmTime: Date.parse("2026-09-08T09:45:00+08:00"),
    })

    settings.setState({ classLiveUpdateEnabled: true })
    await notify.syncNativeNotifications()
    expect(native.alarms[0]).toEqual({ ...original, liveUpdateEnabled: true })

    settings.setState({ classLiveUpdateEnabled: false, classVibrationEnabled: true })
    await notify.syncNativeNotifications()
    expect(native.alarms[0]).toEqual({ ...original, vibrationEnabled: true })

    settings.setState({ classLiveUpdateEnabled: true })
    await notify.syncNativeNotifications()
    expect(native.alarms[0]).toEqual({
      ...original,
      liveUpdateEnabled: true,
      vibrationEnabled: true,
    })
  })

  it("reschedules a changed reminder lead without moving the actual class start", async () => {
    settings.setState({ classReminderEnabled: true, classReminderMinutes: 30 })
    await notify.syncClassAlarmsToNative([course], week, periods)
    expect(native.alarms[0]?.alarmTime).toBe(Date.parse("2026-09-08T09:30:00+08:00"))

    settings.setState({ classReminderMinutes: 5, classVibrationEnabled: true })
    await notify.syncNativeNotifications()
    const alarm = native.alarms[0]!
    expect(alarm.alarmTime).toBe(Date.parse("2026-09-08T09:55:00+08:00"))
    expect(alarm.alarmTime + alarm.remindMinutes * 60_000).toBe(
      Date.parse("2026-09-08T10:00:00+08:00")
    )
    expect(alarm.vibrationEnabled).toBe(true)

    settings.setState({ classReminderMinutes: 120 })
    await notify.syncNativeNotifications()
    expect(native.alarms[0]?.alarmTime).toBe(Date.parse("2026-09-08T08:00:00+08:00"))
  })

  it("reschedules cached full courses across weeks when days change, without another schedule fetch", async () => {
    settings.setState({ classReminderEnabled: true })
    await notify.syncClassAlarmsToNative([{ ...course, weekList: [2] }], week, periods)
    expect(native.alarms).toEqual([])
    settings.setState({ classReminderDays: 14 })
    await notify.syncNativeNotifications()
    expect(native.alarms.map((alarm) => alarm.alarmTime)).toEqual([
      new Date("2026-09-15T09:45:00+08:00").getTime(),
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

describe("school-time class alarms", () => {
  const calendar: TermCalendar = {
    semester: week.semester,
    startDate: "2026-09-07",
    totalWeeks: 2,
    teachingWeeks: 3,
    isInUse: true,
  }

  it("uses Shanghai's date and class time when the device is still on Sunday", () => {
    vi.setSystemTime(new Date("2026-09-06T17:00:00Z"))
    const alarms = notify.computeClassAlarms([{ ...course, weekDay: 1 }], week, periods, 1)
    expect(alarms.map(({ alarmId, alarmTime }) => ({ alarmId, alarmTime }))).toEqual([
      {
        alarmId: "2026-09-07|1",
        alarmTime: Date.parse("2026-09-07T01:45:00Z"),
      },
    ])
  })

  it("keeps a sports class without a classroom until its real end time", () => {
    const sports = { ...course, name: "体育Ⅰ", classroom: undefined, weekDay: 1 }
    const times = [
      { section: 1, startTime: "10:00", endTime: "10:45", isInUse: true },
      { section: 2, startTime: "10:50", endTime: "11:35", isInUse: true },
    ]
    vi.setSystemTime(new Date("2026-09-07T10:10:00+08:00"))
    expect(notify.computeClassAlarms([sports], week, times, 1)).toEqual([
      {
        alarmId: "2026-09-07|1",
        alarmTime: Date.parse("2026-09-07T09:45:00+08:00"),
        courseName: "体育Ⅰ",
        classroom: "",
        startTime: "10:00",
        remindMinutes: 15,
        endTime: "11:35",
        endAt: Date.parse("2026-09-07T11:35:00+08:00"),
      },
    ])
    vi.setSystemTime(new Date("2026-09-07T11:35:00+08:00"))
    expect(notify.computeClassAlarms([sports], week, times, 1)).toEqual([])
  })

  it("keeps missing end times start-only instead of serializing an invalid end timestamp", () => {
    const times = [
      { section: 1, startTime: "10:00", isInUse: true },
      { section: 2, endTime: "待定", isInUse: true },
    ]
    vi.setSystemTime(new Date("2026-09-07T09:59:00+08:00"))
    const alarms = notify.computeClassAlarms([{ ...course, weekDay: 1 }], week, times, 1)
    expect(alarms[0]).toMatchObject({
      courseName: "Math",
      alarmTime: Date.parse("2026-09-07T09:45:00+08:00"),
    })
    expect(alarms[0]).not.toHaveProperty("endAt")
    expect(alarms[0]).not.toHaveProperty("endTime")
    vi.setSystemTime(new Date("2026-09-07T10:00:00+08:00"))
    expect(notify.computeClassAlarms([{ ...course, weekDay: 1 }], week, times, 1)).toEqual([])
  })

  it("does not treat a dated offline snapshot as the current week at first sync", async () => {
    vi.setSystemTime(new Date("2026-09-14T08:00:00+08:00"))
    settings.setState({ classReminderEnabled: true })
    await notify.syncClassAlarmsToNative([{ ...course, weekList: [2] }], week, periods)
    expect(native.alarms.map((alarm) => alarm.alarmTime)).toEqual([
      Date.parse("2026-09-15T01:45:00Z"),
    ])
  })

  it("derives a stale anchor again when permissions refresh after a week rollover", async () => {
    await notify.syncClassAlarmsToNative([{ ...course, weekList: [2] }], week, periods)
    vi.setSystemTime(new Date("2026-09-14T08:00:00+08:00"))
    await notify.setNotificationEnabled("classes", true)
    expect(native.alarms.map((alarm) => alarm.alarmTime)).toEqual([
      Date.parse("2026-09-15T01:45:00Z"),
    ])
  })

  it("does not invent week one without a dated anchor", () => {
    expect(notify.computeClassAlarms([course], null, periods)).toEqual([])
    expect(notify.computeClassAlarms([course], { week: 1, weekday: 1 }, periods)).toEqual([])
  })

  it("uses a calendar anchor but excludes alarms beyond its final week", () => {
    vi.setSystemTime(new Date("2026-09-20T08:00:00+08:00"))
    const courses = [
      { ...course, weekDay: 7 },
      { ...course, weekDay: 1 },
    ]
    expect(
      notify.computeClassAlarms(courses, null, periods, 7, calendar).map((alarm) => alarm.alarmTime)
    ).toEqual([Date.parse("2026-09-20T01:45:00Z")])
  })

  it("stops polling and cancels alarms when their plugins become unavailable", async () => {
    await notify.startNativePolling()
    settings.setState({ classReminderEnabled: true })
    await notify.syncClassAlarmsToNative([course], week, periods)
    expect(native.polling).not.toBeNull()
    expect(native.alarms).not.toEqual([])

    unsubscribe()
    unsubscribe = notify.observeNativeNotifications(
      {
        getAuthToken: native.getAuthToken,
        getServerConfig: () => ({}),
      },
      "ysu",
      { grades: false, exams: false, schedule: false }
    )
    await notify.syncNativeNotifications()
    await notify.syncClassAlarmsToNative([course], week, periods)
    expect(native.polling).toBeNull()
    expect(native.alarms).toEqual([])
    expect(settings.getState().classReminderEnabled).toBe(true)
  })
})
