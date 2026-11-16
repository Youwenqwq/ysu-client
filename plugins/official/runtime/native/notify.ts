/**
 * 成绩/考试发布通知模块
 *
 * 通知由通用 `academic.polling` capability 调度：JavaScript 只下发
 * interval 与不透明的 handler payload（provider 会话、provider 身份、检查项），
 * provider 的官方 BackgroundTaskHandler 负责建立会话、拉取数据、diff 并发布通知。
 *
 * 上课提醒由 `reminders.classes` capability 通过 AlarmManager 与前台服务投递。
 * 权限、精确闹钟与电池优化统一走 `notifications.core` capability。
 *
 * This module is the official companion wrapper over those generic capabilities;
 * provider identity, its native polling adapter id and the enabled channels are
 * supplied by the caller at observe time.
 */
import { useSettingsStore } from "@/plugins/official/shell/stores/settings"
import { useAuthStore } from "@/plugins/official/runtime/session-store"
import {
  invokeNativeCapability,
  isCapacitor,
  loadNativeCapabilities,
  nativeCapabilities,
} from "@orahako/plugin-sdk/native"
import { isCourseActiveInWeek } from "@orahako/academic/schedule-utils"
import { scheduleDate } from "@orahako/academic/schedule-patches"
import { getAcademicClock, resolveAcademicWeek } from "@orahako/academic/academic-time"
import { parseAcademicDateTime } from "@orahako/academic/time"
import type {
  Course,
  CurrentWeek,
  ClassPeriod,
  ProviderNativeNotification,
  TermCalendar,
} from "@orahako/plugin-sdk/academic"

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
let notificationHandlerId: string | undefined
let notificationFeatures: NativeNotificationFeatures = {
  grades: true,
  exams: true,
  schedule: true,
}
let lastPollingHash = ""
let pendingTokenRefresh = false
let pendingCheck = false
const permissionRevisions = { polling: 0, classes: 0 }

/** Channels the active provider can publish; disabled channels never schedule. */
export interface NativeNotificationFeatures {
  grades: boolean
  exams: boolean
  schedule: boolean
}

/** Caller-supplied provider binding; nothing here assumes a particular school. */
export interface NativeNotificationBinding {
  /** Provider-native adapter exposing the session token and server config. */
  provider?: ProviderNativeNotification
  /** Provider identity used for the account hash and the polling payload. */
  providerId: string
  /**
   * Native background-task adapter id registered by this provider's companion.
   * Defaults to `providerId` when the companion registers one adapter per provider.
   */
  handlerId?: string
  /** Channels enabled for this provider; all are enabled when omitted. */
  features?: NativeNotificationFeatures
}

const POLLING_CAPABILITY = "academic.polling"
const NOTIFICATIONS_CAPABILITY = "notifications.core"
const REMINDERS_CAPABILITY = "reminders.classes"

/**
 * The describe call is asynchronous, so every capability check awaits the
 * cached descriptor list first; a missing capability is then a deterministic
 * no-op instead of a race.
 */
async function capabilityAvailable(id: string): Promise<boolean> {
  if (!isCapacitor()) return false
  await loadNativeCapabilities()
  return nativeCapabilities.has(id)
}

async function callPolling<T>(method: string, payload: Record<string, unknown> = {}) {
  if (!(await capabilityAvailable(POLLING_CAPABILITY))) return undefined
  return invokeNativeCapability<T>(POLLING_CAPABILITY, method, payload)
}

async function callNotifications<T>(method: string, payload: Record<string, unknown> = {}) {
  if (!(await capabilityAvailable(NOTIFICATIONS_CAPABILITY))) return undefined
  return invokeNativeCapability<T>(NOTIFICATIONS_CAPABILITY, method, payload)
}

/** Cancels the bound adapter only; without a binding the capability clears all. */
async function stopPolling(handlerId: string | undefined) {
  return callPolling("stop", handlerId ? { handlerId } : {})
}

/** Current notification permission, `false` when the capability is absent. */
export async function checkNotificationPermission(): Promise<boolean> {
  const result = await callNotifications<{ granted: boolean }>("checkPermissions")
  return result?.granted === true
}

/** Requests the permission when needed; `false` when the capability is absent. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (await checkNotificationPermission()) return true
  const result = await callNotifications<{ granted: boolean }>("requestPermissions")
  return result?.granted === true
}

export async function checkBatteryOptimization(): Promise<{ ignored: boolean }> {
  const result = await callNotifications<{ ignored: boolean }>("checkBatteryOptimization")
  return { ignored: result?.ignored === true }
}

export async function requestBatteryOptimizationExemption(): Promise<boolean> {
  const result = await callNotifications<{ ignored: boolean }>(
    "requestIgnoreBatteryOptimization"
  )
  return result?.ignored === true
}

export interface NativePollingState {
  providerId?: string
  hasSession?: boolean
  sessionExpired?: boolean
  gradesBaseline?: boolean
  examsBaseline?: boolean
  failures?: number
  cachedGrades?: unknown[]
  cachedExams?: unknown[]
}

/** Handler diagnostics for the debug screen; `null` when nothing is bound. */
export async function inspectNativePolling(
  handlerId: string | undefined = notificationHandlerId
): Promise<NativePollingState | null> {
  if (!handlerId) return null
  const result = await callPolling<{ state: NativePollingState }>("inspect", { handlerId })
  return result?.state ?? null
}

/** Debug builds only: schedule one real class reminder through the native path. */
export async function debugClassReminder(options?: {
  courseName?: string
  classroom?: string
  startInMinutes?: number
  liveUpdateEnabled?: boolean
  vibrationEnabled?: boolean
}): Promise<{ posted: boolean }> {
  if (!(await capabilityAvailable(REMINDERS_CAPABILITY))) return { posted: false }
  return invokeNativeCapability<{ posted: boolean }>(REMINDERS_CAPABILITY, "debug", options ?? {})
}

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

async function readCastgc(
  nativeNotification: ProviderNativeNotification
): Promise<string | undefined> {
  try {
    return (await nativeNotification.getAuthToken()) ?? undefined
  } catch {
    return undefined
  }
}

/** Bind the single control source; React cleanup only removes subscriptions. */
export function observeNativeNotifications(binding: NativeNotificationBinding): () => void {
  if (!isCapacitor()) return () => {}
  const providerId = binding.providerId
  if (notificationProviderId && notificationProviderId !== providerId) stopNotify()
  notificationProvider = binding.provider
  notificationProviderId = providerId
  notificationHandlerId = binding.handlerId ?? providerId
  notificationFeatures = binding.features ?? { grades: true, exams: true, schedule: true }
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
    const handlerId = notificationHandlerId
    const checkGrades = settings.notifyGrades && notificationFeatures.grades
    const checkExams = settings.notifyExams && notificationFeatures.exams
    const valid = () =>
      revision === pollingRevision && !stopped && useAuthStore.getState().isAuthenticated
    if (
      !valid() ||
      (!settings.notifyEnabled && !pendingTokenRefresh) ||
      (!checkGrades && !checkExams && !settings.notifyNetworkError) ||
      auth.sessionExpired ||
      !provider ||
      !providerId ||
      !handlerId ||
      !auth.username
    ) {
      await stopPolling(handlerId)
      lastPollingHash = ""
      return
    }
    const castgc = await readCastgc(provider)
    if (!valid()) return
    if (!castgc) {
      await stopPolling(handlerId)
      lastPollingHash = ""
      return
    }
    // Session and provider configuration travel as an opaque handler payload;
    // the scheduler itself never interprets them.
    const hash = JSON.stringify([
      providerId,
      auth.username,
      castgc,
      settings.notifyCheckInterval,
      checkGrades,
      checkExams,
      settings.notifyNetworkError,
    ])
    if (hash === lastPollingHash && !pendingTokenRefresh && !pendingCheck) return
    if (!settings.notifyEnabled) {
      pendingCheck = false
      await stopPolling(handlerId)
      lastPollingHash = ""
      return
    }
    if (!(await checkNotificationPermission())) {
      if (!valid()) return
      settings.setNotifyEnabled(false)
      return
    }
    if (!valid()) return
    await callPolling("configure", {
      handlerId,
      intervalMinutes: settings.notifyCheckInterval,
      payload: {
        serverConfig: provider.getServerConfig(),
        providerId,
        accountHash: hashNotifyAccount(providerId, auth.username),
        castgc,
        checkGrades,
        checkExams,
        notifyNetworkError: settings.notifyNetworkError,
      },
    })
    if (!valid()) return
    lastPollingHash = hash
    pendingTokenRefresh = false
    if (pendingCheck) {
      pendingCheck = false
      await callPolling("runNow", { handlerId })
    }
  }))
}

export async function checkExactAlarmPermission(): Promise<{ granted: boolean }> {
  const result = await callNotifications<{ granted: boolean }>("checkExactAlarmPermission")
  return { granted: result?.granted === true }
}

export async function requestExactAlarmPermission(): Promise<{ granted: boolean }> {
  const result = await callNotifications<{ granted: boolean }>("requestExactAlarmPermission")
  return { granted: result?.granted === true }
}

/** Permission is requested by user interaction, independently for both features. */
export async function setNotificationEnabled(
  kind: "polling" | "classes",
  enabled: boolean
): Promise<boolean> {
  if (
    enabled &&
    ((kind === "classes" && !notificationFeatures.schedule) ||
      (kind === "polling" && !notificationFeatures.grades && !notificationFeatures.exams))
  ) {
    return false
  }
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
  let permission = await checkNotificationPermission()
  if (!permission) permission = await requestNotificationPermission()
  if (
    !permission ||
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
  const handlerId = notificationHandlerId
  stopped = true
  lifecycleRevision++
  pollingRevision++
  alarmRevision++
  lastPollingHash = ""
  pendingTokenRefresh = false
  pendingCheck = false
  lastAlarmHash = ""
  latestAlarmSchedule = null
  void enqueueNative(async () => {
    if (!isCapacitor()) return
    const results = await Promise.allSettled([
      stopPolling(handlerId),
      (await capabilityAvailable(REMINDERS_CAPABILITY))
        ? invokeNativeCapability(REMINDERS_CAPABILITY, "cancel")
        : undefined,
      callNotifications("cancelAll"),
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
    if (!valid() || !settings.classReminderEnabled || !notificationFeatures.schedule) {
      if (await capabilityAvailable(REMINDERS_CAPABILITY))
        await invokeNativeCapability(REMINDERS_CAPABILITY, "cancel")
      lastAlarmHash = ""
      return
    }
    const schedule = latestAlarmSchedule
    if (!schedule) return
    if (!(await checkNotificationPermission())) {
      if (!valid()) return
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
      if (await capabilityAvailable(REMINDERS_CAPABILITY))
        await invokeNativeCapability(REMINDERS_CAPABILITY, "cancel")
      lastAlarmHash = hash
      return
    }
    lastAlarmHash = ""
    if (!valid()) return
    if (await capabilityAvailable(REMINDERS_CAPABILITY)) {
      await invokeNativeCapability(REMINDERS_CAPABILITY, "schedule", { alarms })
      if (!valid()) return
    }
    lastAlarmHash = hash
  }))
}
