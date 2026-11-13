/**
 * 成绩/考试发布通知模块
 *
 * 通知由原生 Android WorkManager 后台轮询驱动（NotifyWorker），
 * 使用 CASTGC 建立 JWXT 会话，拉取成绩/考试后 diff 并发送系统通知。
 *
 * 上课提醒由 AlarmManager 在指定时间触发 ClassAlarmReceiver。
 */
import { useSettingsStore } from "../stores/settings"
import { useAuthStore } from "../stores/auth"
import { isCapacitor } from "./platform"
import { NotifyPlugin } from "./notify-plugin"
import { isCourseActiveInWeek } from "@orahako/academic/schedule-utils"
import { getAcademicClock, resolveAcademicWeek } from "@/lib/academic/academic-time"
import { scheduleDate } from "@/lib/academic/schedule-patches"
import { parseAcademicDateTime } from "@/lib/academic/time"
import type {
  Course,
  CurrentWeek,
  ClassPeriod,
  ProviderNativeNotification,
  TermCalendar,
} from "@/providers/types"

// Native mutations share one queue. Revisions invalidate work waiting on a token
// or permission prompt before logout/disable can be undone by its completion.
let nativeQueue: Promise<void> = Promise.resolve()
let pollingSync: Promise<void> = Promise.resolve()
let alarmSync: Promise<void> = Promise.resolve()
let pollingRevision = 0
let alarmRevision = 0
let lifecycleRevision = 0
let stopped = false
let notificationProvider: ProviderNativeNotification | undefined
let notificationProviderId: string | undefined
let lastPollingHash = ""
let lastCastgc = ""
let pendingTokenRefresh = false
let pendingCheck = false
const permissionRevisions = { polling: 0, classes: 0 }

function enqueueNative(operation: () => Promise<void>): Promise<void> {
  const result = nativeQueue.then(operation)
  nativeQueue = result.catch((error) => {
    console.warn("Failed to sync native notifications", error)
  })
  return result
}

function hashNotifyAccount(providerId: string, username: string): string {
  let hash = 2166136261
  const input = `${providerId}:${username}`
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

async function syncProviderToNative(
  nativeNotification: ProviderNativeNotification,
  providerId: string,
  username: string
): Promise<void> {
  await NotifyPlugin.setServerConfig({
    configJson: JSON.stringify(nativeNotification.getServerConfig()),
  })
  await NotifyPlugin.setProviderIdentity({
    providerId,
    accountHash: hashNotifyAccount(providerId, username),
  })
}

async function readCastgc(
  nativeNotification: ProviderNativeNotification
): Promise<string | undefined> {
  let castgc: string | undefined

  // 1. 优先由当前 provider 提供认证 token。
  try {
    const token = await nativeNotification.getAuthToken()
    if (token) castgc = token
  } catch {
    // ignore
  }

  // 2. fallback：从 CapacitorHttp cookie store 读取。
  if (!castgc) {
    const authCookieUrl = nativeNotification.getAuthCookieUrl?.()
    if (authCookieUrl) {
      try {
        const { CapacitorCookies } = await import("@capacitor/core")
        const cookies = await CapacitorCookies.getCookies({
          url: authCookieUrl,
        })
        castgc = cookies?.CASTGC
      } catch {
        // ignore
      }
    }
  }

  return castgc
}

/** Bind the single control source; React cleanup only removes subscriptions. */
export function observeNativeNotifications(
  nativeNotification: ProviderNativeNotification | undefined,
  providerId: string
): () => void {
  if (!isCapacitor()) return () => {}
  if (notificationProviderId && notificationProviderId !== providerId) stopNotify()
  notificationProvider = nativeNotification
  notificationProviderId = providerId
  stopped = !useAuthStore.getState().isAuthenticated

  const sync = () => {
    void syncNativeNotifications().catch(() => {})
    void refreshClassAlarms().catch(() => {})
  }
  const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
    if (
      state.hasHydrated !== previous.hasHydrated ||
      state.notifyEnabled !== previous.notifyEnabled ||
      state.notifyCheckInterval !== previous.notifyCheckInterval ||
      state.notifyGrades !== previous.notifyGrades ||
      state.notifyExams !== previous.notifyExams ||
      state.notifyNetworkError !== previous.notifyNetworkError
    ) {
      void syncNativeNotifications(state.notifyEnabled && !previous.notifyEnabled).catch(() => {})
    }
    if (
      state.hasHydrated !== previous.hasHydrated ||
      state.classReminderEnabled !== previous.classReminderEnabled ||
      state.classReminderMinutes !== previous.classReminderMinutes ||
      state.classLiveUpdateEnabled !== previous.classLiveUpdateEnabled ||
      state.classVibrationEnabled !== previous.classVibrationEnabled ||
      state.classReminderDays !== previous.classReminderDays
    ) {
      void refreshClassAlarms().catch(() => {})
    }
  })
  const unsubscribeAuth = useAuthStore.subscribe((state, previous) => {
    if (
      (previous.isAuthenticated && !state.isAuthenticated) ||
      state.username !== previous.username
    ) {
      stopNotify()
    }
    if (
      state.isAuthenticated &&
      (!previous.isAuthenticated || state.username !== previous.username)
    ) {
      stopped = false
    }
    if (
      state.isAuthenticated !== previous.isAuthenticated ||
      state.username !== previous.username ||
      state.credential !== previous.credential ||
      state.sessionExpired !== previous.sessionExpired ||
      state.hasHydrated !== previous.hasHydrated
    )
      sync()
  })
  sync()
  return () => {
    unsubscribeSettings()
    unsubscribeAuth()
  }
}

/** Also called after relogin, even when isAuthenticated remained true. */
export function syncNativeNotifications(checkNow = false, refreshToken = false): Promise<void> {
  const revision = ++pollingRevision
  pendingTokenRefresh ||= refreshToken
  pendingCheck ||= checkNow
  return (pollingSync = enqueueNative(async () => {
    if (!isCapacitor() || revision !== pollingRevision) return
    const auth = useAuthStore.getState()
    const settings = useSettingsStore.getState()
    if (!auth.hasHydrated || !settings.hasHydrated) return
    const provider = notificationProvider
    const providerId = notificationProviderId
    const valid = () =>
      revision === pollingRevision && !stopped && useAuthStore.getState().isAuthenticated
    if (
      !valid() ||
      (!settings.notifyEnabled && !pendingTokenRefresh) ||
      auth.sessionExpired ||
      !provider ||
      !providerId ||
      !auth.username
    ) {
      await NotifyPlugin.stopPolling()
      lastPollingHash = ""
      return
    }
    const hash = JSON.stringify([
      providerId,
      auth.username,
      auth.credential,
      settings.notifyCheckInterval,
      settings.notifyGrades,
      settings.notifyExams,
      settings.notifyNetworkError,
    ])
    if (hash === lastPollingHash && !pendingTokenRefresh && !pendingCheck) return
    const castgc = await readCastgc(provider)
    if (!valid()) return
    if (!castgc) {
      await NotifyPlugin.stopPolling()
      lastPollingHash = ""
      return
    }
    await syncProviderToNative(provider, providerId, auth.username)
    if (!valid()) return
    if (castgc !== lastCastgc || pendingTokenRefresh) {
      await NotifyPlugin.setCastgc({ castgc })
      if (!valid()) return
      lastCastgc = castgc
      pendingTokenRefresh = false
    }
    if (!valid()) return
    if (!settings.notifyEnabled) {
      pendingCheck = false
      await NotifyPlugin.stopPolling()
      lastPollingHash = ""
      return
    }
    const { granted } = await NotifyPlugin.checkPermissions()
    if (!valid()) return
    if (!granted) {
      settings.setNotifyEnabled(false)
      return
    }
    await NotifyPlugin.startPolling({
      intervalMinutes: settings.notifyCheckInterval,
      checkGrades: settings.notifyGrades,
      checkExams: settings.notifyExams,
      notifyNetworkError: settings.notifyNetworkError,
    })
    if (!valid()) return
    lastPollingHash = hash
    if (pendingCheck) {
      pendingCheck = false
      await NotifyPlugin.executeOnce()
    }
  }))
}

/** Permission is requested by user interaction, independently for both features. */
export async function setNotificationEnabled(
  kind: "polling" | "classes",
  enabled: boolean
): Promise<boolean> {
  const revision = ++permissionRevisions[kind]
  const lifecycle = lifecycleRevision
  const auth = useAuthStore.getState()
  const setEnabled =
    kind === "polling"
      ? useSettingsStore.getState().setNotifyEnabled
      : useSettingsStore.getState().setClassReminderEnabled
  if (!enabled) {
    setEnabled(false)
    await (kind === "polling" ? pollingSync : alarmSync)
    return true
  }
  if (!isCapacitor() || stopped || !auth.isAuthenticated) return false
  let permission = await NotifyPlugin.checkPermissions()
  if (!permission.granted) permission = await NotifyPlugin.requestPermissions()
  if (
    !permission.granted ||
    revision !== permissionRevisions[kind] ||
    lifecycle !== lifecycleRevision ||
    stopped ||
    !useAuthStore.getState().isAuthenticated ||
    useAuthStore.getState().username !== auth.username
  )
    return false
  setEnabled(true)
  await (kind === "polling" ? pollingSync : alarmSync)
  return true
}

/** Debug actions change the same state as the settings screen. */
export async function startNativePolling(): Promise<void> {
  const alreadyEnabled = useSettingsStore.getState().notifyEnabled
  if (!(await setNotificationEnabled("polling", true))) {
    throw new Error("Notification permission not granted")
  }
  if (alreadyEnabled) await syncNativeNotifications(true)
}

export async function stopNativePolling(): Promise<void> {
  await setNotificationEnabled("polling", false)
  await pollingSync
}

/** Invalidate synchronously, then clear native state behind any in-flight call. */
export function stopNotify(): void {
  stopped = true
  lifecycleRevision++
  pollingRevision++
  alarmRevision++
  lastPollingHash = ""
  lastCastgc = ""
  pendingTokenRefresh = false
  pendingCheck = false
  lastAlarmHash = ""
  latestAlarmSchedule = null
  void enqueueNative(async () => {
    if (!isCapacitor()) return
    const results = await Promise.allSettled([
      NotifyPlugin.stopPolling(),
      NotifyPlugin.clearCastgc(),
      NotifyPlugin.cancelClassAlarms(),
    ])
    for (const result of results) {
      if (result.status === "rejected")
        console.warn("Failed to stop native notifications", result.reason)
    }
  }).catch(() => {})
}

// ─── Class Alarm ────────────────────────────────────────────────────────────

export interface ClassAlarmConfig {
  alarmId: string
  alarmTime: number
  courseName: string
  classroom: string
  startTime: string
  remindMinutes: number
  liveUpdateEnabled?: boolean
  vibrationEnabled?: boolean
  /** 同一时段合并的课程数量，>1 表示时间冲突。 */
  conflictCount?: number
  /** 下课时间（HH:mm）与时间戳，用于课后倒计时和连堂提示。 */
  endTime?: string
  endAt?: number
}

function parseTimeToMinutes(timeStr: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(timeStr.trim())
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : undefined
}

/** 用 " / " 合并去重，冲突课程共用一条提醒时展示全部名称/教室。 */
function mergeUnique(current: string, extra: string): string {
  const part = extra.trim()
  if (!part) return current
  const parts = current ? current.split(" / ") : []
  if (parts.includes(part)) return current
  return current ? `${current} / ${part}` : part
}

export function computeClassAlarms(
  courses: Course[],
  currentWeek: CurrentWeek | null,
  periods: ClassPeriod[],
  days: number = 7,
  calendar?: TermCalendar,
  remindMinutes: number = 15
): ClassAlarmConfig[] {
  const alarms: ClassAlarmConfig[] = []
  const now = new Date()
  const periodMap = new Map(periods.map((p) => [p.section, p]))
  const today = getAcademicClock(now).date

  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const date = scheduleDate(today, 1, dayOffset + 1)
    const targetWeek = resolveAcademicWeek(currentWeek, calendar, date, currentWeek?.semester)
    if (!targetWeek) continue
    const dayStart = parseAcademicDateTime(`${date}T00:00:00`)?.getTime()
    if (dayStart === undefined) continue
    const dayCourses = courses.filter(
      (c) => c.weekDay === targetWeek.weekday && isCourseActiveInWeek(c, targetWeek.week)
    )

    for (const course of dayCourses) {
      const startSection = course.startSection
      const startPeriod = periodMap.get(startSection)
      const startTime = startPeriod?.startTime
      if (!startTime) continue

      const startMinutes = parseTimeToMinutes(startTime)
      if (startMinutes === undefined) continue
      const endPeriod = periodMap.get(course.endSection)
      const endMinutes = endPeriod?.endTime ? parseTimeToMinutes(endPeriod.endTime) : undefined
      const endAt =
        endMinutes !== undefined && endMinutes > startMinutes
          ? dayStart + endMinutes * 60_000
          : undefined
      const alarmTime = dayStart + (startMinutes - remindMinutes) * 60_000
      const expiresAt = endAt ?? dayStart + startMinutes * 60_000
      if (!Number.isFinite(alarmTime) || expiresAt <= now.getTime()) continue

      // 按「日期 + 起始节次」排钟：同一时段的多门课（课程冲突）合并成一条提醒。
      const alarmId = `${date}|${startSection}`
      const existing = alarms.find((alarm) => alarm.alarmId === alarmId)
      if (existing) {
        const before = existing.courseName
        existing.courseName = mergeUnique(existing.courseName, course.name)
        existing.classroom = mergeUnique(existing.classroom, course.classroom || "")
        if (existing.courseName !== before) {
          existing.conflictCount = (existing.conflictCount ?? 1) + 1
        }
        if (endAt !== undefined && (existing.endAt === undefined || endAt > existing.endAt)) {
          existing.endAt = endAt
          existing.endTime = endPeriod?.endTime
        }
        continue
      }
      alarms.push({
        alarmId,
        alarmTime,
        courseName: course.name,
        classroom: course.classroom || "",
        startTime,
        remindMinutes,
        ...(endAt !== undefined ? { endAt, endTime: endPeriod?.endTime } : {}),
      })
    }
  }

  return alarms
}

let lastAlarmHash = ""
let latestAlarmSchedule: {
  courses: Course[]
  currentWeek: CurrentWeek | null
  periods: ClassPeriod[]
  calendar?: TermCalendar
} | null = null

export function syncClassAlarmsToNative(
  courses: Course[],
  currentWeek: CurrentWeek | null,
  periods: ClassPeriod[],
  calendar?: TermCalendar
): Promise<void> {
  if (!isCapacitor() || stopped || !useAuthStore.getState().isAuthenticated)
    return Promise.resolve()
  latestAlarmSchedule = { courses, currentWeek, periods, calendar }
  return refreshClassAlarms()
}

function refreshClassAlarms(): Promise<void> {
  const revision = ++alarmRevision
  return (alarmSync = enqueueNative(async () => {
    if (!isCapacitor() || revision !== alarmRevision) return
    const auth = useAuthStore.getState()
    const settings = useSettingsStore.getState()
    if (!auth.hasHydrated || !settings.hasHydrated) return
    const valid = () =>
      revision === alarmRevision && !stopped && useAuthStore.getState().isAuthenticated
    if (!valid() || !settings.classReminderEnabled) {
      await NotifyPlugin.cancelClassAlarms()
      lastAlarmHash = ""
      return
    }
    const schedule = latestAlarmSchedule
    if (!schedule) return
    const { granted } = await NotifyPlugin.checkPermissions()
    if (!valid()) return
    if (!granted) {
      settings.setClassReminderEnabled(false)
      return
    }
    const alarms = computeClassAlarms(
      schedule.courses,
      schedule.currentWeek,
      schedule.periods,
      settings.classReminderDays,
      schedule.calendar,
      settings.classReminderMinutes
    )
    for (const alarm of alarms) {
      alarm.liveUpdateEnabled = settings.classLiveUpdateEnabled
      alarm.vibrationEnabled = settings.classVibrationEnabled
    }
    alarms.sort((a, b) => a.alarmId.localeCompare(b.alarmId) || a.alarmTime - b.alarmTime)
    const hash = JSON.stringify(alarms)
    if (hash === lastAlarmHash) return
    if (alarms.length === 0) {
      await NotifyPlugin.cancelClassAlarms()
      lastAlarmHash = hash
      return
    }
    lastAlarmHash = ""
    if (!valid()) return
    if (alarms.length > 0) {
      await NotifyPlugin.scheduleClassAlarms({ alarmsJson: hash })
      if (!valid()) return
    }
    lastAlarmHash = hash
  }))
}
