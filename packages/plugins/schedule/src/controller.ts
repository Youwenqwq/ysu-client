import {
  buildScheduleWidgetSnapshot,
  getAcademicClock,
  isCourseActiveInWeek,
  parseAcademicDateTime,
  periodIsInUse,
  resolveAcademicWeek,
  scheduleDate,
  type ScheduleWidgetSettings,
} from "@orahako/academic-kit"
import {
  hasSlice,
  supportsPlugin,
  type ClassPeriod,
  type Course,
  type CurrentWeek,
  type ProviderRuntimeService,
  type QuerySnapshot,
  type SessionService,
  type TermCalendar,
} from "@orahako/academic-sdk"
import {
  loadNativeCapabilities,
  WIDGETS_GENERIC_CAPABILITY,
  WIDGETS_SCHEDULE_CAPABILITY,
  type ObservableSource,
  type PluginNativeService,
  type PluginWidgetService,
  type WidgetSettings,
  type WidgetSnapshot,
} from "@orahako/sdk"
import {
  computeEffectiveScheduleSnapshot,
  type SchedulePatchesStoreInstance,
  type ScheduleSettingsStoreInstance,
} from "./stores"

export const NOTIFICATIONS_CORE_CAPABILITY = "notifications.core@1"
export const REMINDERS_CLASSES_CAPABILITY = "reminders.classes@1"
export const SCHEDULE_WIDGET_IDS = ["schedule", "tomorrow"] as const
export type ScheduleWidgetId = (typeof SCHEDULE_WIDGET_IDS)[number]

export { WIDGETS_GENERIC_CAPABILITY, WIDGETS_SCHEDULE_CAPABILITY }

export interface ClassAlarmConfig {
  alarmId: string
  alarmTime: number
  courseName: string
  classroom: string
  startTime: string
  remindMinutes: number
  liveUpdateEnabled?: boolean
  vibrationEnabled?: boolean
  conflictCount?: number
  endTime?: string
  endAt?: number
}

function parseClockToMinutes(timeStr: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(timeStr.trim())
  if (!match) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : undefined
}

function mergeUniqueText(current: string, extra: string): string {
  const part = extra.trim()
  if (!part) return current
  const parts = current ? current.split(" / ") : []
  if (parts.includes(part)) return current
  return current ? `${current} / ${part}` : part
}

export function computeClassAlarms(
  courses: readonly Course[],
  currentWeek: CurrentWeek | null,
  periods: readonly ClassPeriod[],
  days = 7,
  calendar?: TermCalendar,
  remindMinutes = 15,
  now = new Date()
): ClassAlarmConfig[] {
  const alarms: ClassAlarmConfig[] = []
  const periodMap = new Map(periods.map((period) => [period.section, period]))
  const today = getAcademicClock(now).date

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const date = scheduleDate(today, 1, dayOffset + 1)
    const targetWeek = resolveAcademicWeek(currentWeek, calendar, date, currentWeek?.semester)
    if (!targetWeek) continue
    const dayStart = parseAcademicDateTime(`${date}T00:00:00`)?.getTime()
    if (dayStart === undefined) continue
    const dayCourses = courses.filter(
      (course) =>
        course.weekDay === targetWeek.weekday && isCourseActiveInWeek(course, targetWeek.week)
    )

    for (const course of dayCourses) {
      const startSection = course.startSection
      const startPeriod = periodMap.get(startSection)
      const startTime = startPeriod?.startTime
      if (!startTime) continue

      const startMinutes = parseClockToMinutes(startTime)
      if (startMinutes === undefined) continue
      const endPeriod = periodMap.get(course.endSection)
      const endMinutes = endPeriod?.endTime ? parseClockToMinutes(endPeriod.endTime) : undefined
      const endAt =
        endMinutes !== undefined && endMinutes > startMinutes
          ? dayStart + endMinutes * 60_000
          : undefined
      const alarmTime = dayStart + (startMinutes - remindMinutes) * 60_000
      const expiresAt = endAt ?? dayStart + startMinutes * 60_000
      if (!Number.isFinite(alarmTime) || expiresAt <= now.getTime()) continue

      const alarmId = `${date}|${startSection}`
      const existing = alarms.find((alarm) => alarm.alarmId === alarmId)
      if (existing) {
        const before = existing.courseName
        existing.courseName = mergeUniqueText(existing.courseName, course.name)
        existing.classroom = mergeUniqueText(existing.classroom, course.classroom || "")
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

export interface ScheduleSyncInput {
  readonly courses: readonly Course[]
  readonly currentWeek: CurrentWeek | null
  readonly periods: readonly ClassPeriod[]
  readonly calendar?: TermCalendar
}

export interface ClassReminderAndWidgetControllerOptions {
  readonly pluginId: string
  readonly settingsStore: ScheduleSettingsStoreInstance
  readonly patchesStore: SchedulePatchesStoreInstance
  readonly provider: ProviderRuntimeService
  readonly session: SessionService
  readonly native: PluginNativeService
  readonly widgets: PluginWidgetService
  readonly scheduleSource?: ObservableSource<QuerySnapshot<Course[]>>
  readonly currentWeekSource?: ObservableSource<QuerySnapshot<CurrentWeek>>
  readonly termCalendarSource?: ObservableSource<QuerySnapshot<TermCalendar>>
  readonly periodsSource?: ObservableSource<QuerySnapshot<ClassPeriod[]>>
  readonly loadCapabilities?: () => Promise<unknown>
  readonly now?: () => Date
}

function toWidgetSnapshotRecord(
  snapshot: ReturnType<typeof buildScheduleWidgetSnapshot>
): WidgetSnapshot {
  return {
    courses: snapshot.courses,
    week: snapshot.week,
  }
}

function toWidgetSettingsRecord(settings: ScheduleWidgetSettings): WidgetSettings {
  return {
    syncReminderHours: settings.syncReminderHours,
    showNextDaySchedule: settings.showNextDaySchedule,
  }
}

export class ClassReminderAndWidgetController {
  private readonly pluginId: string
  private readonly settingsStore: ScheduleSettingsStoreInstance
  private readonly patchesStore: SchedulePatchesStoreInstance
  private readonly provider: ProviderRuntimeService
  private readonly session: SessionService
  private readonly native: PluginNativeService
  private readonly widgets: PluginWidgetService
  private readonly scheduleSource: ObservableSource<QuerySnapshot<Course[]>> | undefined
  private readonly currentWeekSource: ObservableSource<QuerySnapshot<CurrentWeek>> | undefined
  private readonly termCalendarSource: ObservableSource<QuerySnapshot<TermCalendar>> | undefined
  private readonly periodsSource: ObservableSource<QuerySnapshot<ClassPeriod[]>> | undefined
  private readonly ensureCapabilitiesLoaded: () => Promise<unknown>
  private readonly now: () => Date

  private nativeQueue: Promise<void> = Promise.resolve()
  private alarmSync: Promise<void> = Promise.resolve()
  private widgetSync: Promise<void> = Promise.resolve()
  private alarmRevision = 0
  private widgetRevision = 0
  private lifecycleRevision = 0
  private permissionRevision = 0
  private stopped = false
  private channelActive = false
  private disposed = false
  private lastAlarmHash = ""
  private lastWidgetHash = ""
  private latestExplicitSchedule: ScheduleSyncInput | null = null

  private previousSettings: {
    readonly classReminderEnabled: boolean
    readonly classReminderMinutes: number
    readonly classLiveUpdateEnabled: boolean
    readonly classVibrationEnabled: boolean
    readonly classReminderDays: number
    readonly widgetSyncReminderHours: number
    readonly widgetShowNextDaySchedule: boolean
  }
  private previousSession: {
    readonly isAuthenticated: boolean
    readonly username: string | null
    readonly hasHydrated: boolean
  }
  private readonly unsubscribers: Array<() => void> = []

  constructor(options: ClassReminderAndWidgetControllerOptions) {
    this.pluginId = options.pluginId
    this.settingsStore = options.settingsStore
    this.patchesStore = options.patchesStore
    this.provider = options.provider
    this.session = options.session
    this.native = options.native
    this.widgets = options.widgets
    this.scheduleSource = options.scheduleSource
    this.currentWeekSource = options.currentWeekSource
    this.termCalendarSource = options.termCalendarSource
    this.periodsSource = options.periodsSource
    this.ensureCapabilitiesLoaded = options.loadCapabilities ?? loadNativeCapabilities
    this.now = options.now ?? (() => new Date())

    const initialSession = this.session.getSnapshot()
    this.stopped = !initialSession.isAuthenticated
    this.previousSession = {
      isAuthenticated: initialSession.isAuthenticated,
      username: initialSession.username,
      hasHydrated: initialSession.hasHydrated,
    }

    const initialSettings = this.settingsStore.source.getSnapshot()
    this.previousSettings = {
      classReminderEnabled: initialSettings.classReminderEnabled,
      classReminderMinutes: initialSettings.classReminderMinutes,
      classLiveUpdateEnabled: initialSettings.classLiveUpdateEnabled,
      classVibrationEnabled: initialSettings.classVibrationEnabled,
      classReminderDays: initialSettings.classReminderDays,
      widgetSyncReminderHours: initialSettings.widgetSyncReminderHours,
      widgetShowNextDaySchedule: initialSettings.widgetShowNextDaySchedule,
    }

    this.attachSubscriptions()
    void this.refreshAlarms()
    void this.refreshWidgets()
  }

  private isFeatureSupported(): boolean {
    const activeProvider = this.provider.getSnapshot().provider
    if (!activeProvider) return false
    return (
      supportsPlugin(activeProvider.supportedPlugins, this.pluginId) &&
      hasSlice(activeProvider, "timetable")
    )
  }

  private resolveQueryScheduleInput(): ScheduleSyncInput | null {
    if (!this.scheduleSource) return null
    const scheduleSnap = this.scheduleSource.getSnapshot()
    if (scheduleSnap.data === undefined) return null

    const rawWeek = this.currentWeekSource?.getSnapshot().data ?? null
    const rawCalendar = this.termCalendarSource?.getSnapshot().data
    const rawPeriods = this.periodsSource?.getSnapshot().data ?? []
    const periods = rawPeriods.filter(periodIsInUse).sort((a, b) => a.section - b.section)
    const calendar =
      rawWeek?.semester && rawCalendar?.semester && rawWeek.semester !== rawCalendar.semester
        ? undefined
        : rawCalendar

    const effective = computeEffectiveScheduleSnapshot({
      rawCourses: scheduleSnap.data,
      calendar,
      currentWeek: rawWeek,
      providerSnapshot: this.provider.getSnapshot(),
      sessionSnapshot: this.session.getSnapshot(),
      patchesState: this.patchesStore.source.getSnapshot(),
      patchesHydrated: this.patchesStore.hydrated.getSnapshot(),
    })

    const nowDate = getAcademicClock(this.now()).date
    const liveWeek = resolveAcademicWeek(rawWeek, calendar, nowDate, rawWeek?.semester)
    if (!effective.ready && liveWeek) {
      return null
    }

    return {
      courses: effective.ready ? effective.courses : scheduleSnap.data,
      currentWeek: liveWeek ?? rawWeek,
      periods,
      calendar,
    }
  }

  private resolveCurrentScheduleInput(): ScheduleSyncInput | null {
    return this.latestExplicitSchedule ?? this.resolveQueryScheduleInput()
  }

  syncScheduleData(input: ScheduleSyncInput): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.latestExplicitSchedule = input
    const alarms = this.refreshAlarms({ propagateError: true })
    const widgets = this.refreshWidgets()
    return Promise.all([alarms, widgets]).then(() => undefined)
  }

  syncWidgetSettings(): Promise<void> {
    if (this.disposed || !this.native.isNative) return Promise.resolve()
    const settingsState = this.settingsStore.source.getSnapshot()
    const payload = toWidgetSettingsRecord({
      syncReminderHours: settingsState.widgetSyncReminderHours,
      showNextDaySchedule: settingsState.widgetShowNextDaySchedule,
    })
    return this.enqueueNative(async () => {
      if (this.disposed || !this.native.isNative) return
      await Promise.allSettled(
        SCHEDULE_WIDGET_IDS.map((widgetId) => this.widgets.updateSettings(widgetId, payload))
      )
    })
  }

  async checkNotificationPermission(): Promise<boolean> {
    if (!this.native.isNative) return false
    if (!(await this.capabilityAvailable(NOTIFICATIONS_CORE_CAPABILITY))) return false
    const result = await this.native.capabilities.invoke<{ granted?: boolean }>(
      NOTIFICATIONS_CORE_CAPABILITY,
      "checkPermissions"
    )
    return result?.granted === true
  }

  async checkExactAlarmPermission(): Promise<boolean> {
    if (!this.native.isNative) return false
    if (!(await this.capabilityAvailable(NOTIFICATIONS_CORE_CAPABILITY))) return false
    const result = await this.native.capabilities.invoke<{ granted?: boolean }>(
      NOTIFICATIONS_CORE_CAPABILITY,
      "checkExactAlarmPermission"
    )
    return result?.granted === true
  }

  async setClassReminderEnabled(enabled: boolean): Promise<boolean> {
    if (this.disposed) return false
    if (enabled && !this.isFeatureSupported()) {
      return false
    }
    const revision = ++this.permissionRevision
    const lifecycle = this.lifecycleRevision
    const sessionBefore = this.session.getSnapshot()

    if (!enabled) {
      this.settingsStore.actions.setClassReminderEnabled(false)
      await this.alarmSync
      return true
    }

    if (!this.native.isNative || this.stopped || !sessionBefore.isAuthenticated) {
      return false
    }
    if (!(await this.capabilityAvailable(REMINDERS_CLASSES_CAPABILITY))) {
      return false
    }

    const granted = await this.native.requestNotificationPermission()
    const sessionAfter = this.session.getSnapshot()
    if (
      !granted ||
      this.disposed ||
      revision !== this.permissionRevision ||
      lifecycle !== this.lifecycleRevision ||
      this.stopped ||
      !sessionAfter.isAuthenticated ||
      sessionAfter.username !== sessionBefore.username
    ) {
      return false
    }

    this.settingsStore.actions.setClassReminderEnabled(true)
    await this.alarmSync
    return true
  }

  refreshAlarms(options: { propagateError?: boolean } = {}): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const revision = ++this.alarmRevision

    const task = this.enqueueNative(
      async () => {
        if (this.disposed || !this.native.isNative || revision !== this.alarmRevision) return
        const sessionSnap = this.session.getSnapshot()
        const settingsHydrated = this.settingsStore.hydrated.getSnapshot()
        if (!sessionSnap.hasHydrated || !settingsHydrated) return

        const settings = this.settingsStore.source.getSnapshot()
        const isValid = (): boolean =>
          !this.disposed &&
          revision === this.alarmRevision &&
          !this.stopped &&
          this.channelActive &&
          this.session.getSnapshot().isAuthenticated

        if (!isValid() || !settings.classReminderEnabled || !this.isFeatureSupported()) {
          await this.cancelNativeAlarms()
          this.lastAlarmHash = ""
          return
        }

        const schedule = this.resolveCurrentScheduleInput()
        if (!schedule) return

        if (!(await this.checkNotificationPermission())) {
          if (!isValid()) return
          this.settingsStore.actions.setClassReminderEnabled(false)
          await this.cancelNativeAlarms()
          this.lastAlarmHash = ""
          return
        }
        if (!isValid()) return

        const alarms = computeClassAlarms(
          schedule.courses,
          schedule.currentWeek,
          schedule.periods,
          settings.classReminderDays,
          schedule.calendar,
          settings.classReminderMinutes,
          this.now()
        )
        for (const alarm of alarms) {
          alarm.liveUpdateEnabled = settings.classLiveUpdateEnabled
          alarm.vibrationEnabled = settings.classVibrationEnabled
        }
        alarms.sort((a, b) => a.alarmId.localeCompare(b.alarmId) || a.alarmTime - b.alarmTime)

        const hash = JSON.stringify(alarms)
        if (hash === this.lastAlarmHash) return

        if (alarms.length === 0) {
          await this.cancelNativeAlarms()
          this.lastAlarmHash = hash
          return
        }

        this.lastAlarmHash = ""
        if (!isValid()) return
        if (await this.capabilityAvailable(REMINDERS_CLASSES_CAPABILITY)) {
          await this.native.capabilities.invoke(REMINDERS_CLASSES_CAPABILITY, "schedule", {
            alarms,
          })
          if (!isValid()) return
        }
        this.lastAlarmHash = hash
      },
      options.propagateError === true
    )

    this.alarmSync = task.catch(() => {})
    return task
  }

  refreshWidgets(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const revision = ++this.widgetRevision

    const task = this.enqueueNative(async () => {
      if (this.disposed || !this.native.isNative || revision !== this.widgetRevision) return
      const sessionSnap = this.session.getSnapshot()
      const settingsHydrated = this.settingsStore.hydrated.getSnapshot()
      if (!sessionSnap.hasHydrated || !settingsHydrated) return

      if (
        this.stopped ||
        !this.channelActive ||
        !sessionSnap.isAuthenticated ||
        !this.isFeatureSupported()
      ) {
        return
      }

      const schedule = this.resolveCurrentScheduleInput()
      if (!schedule) return

      const settings = this.settingsStore.source.getSnapshot()
      const snapshot = buildScheduleWidgetSnapshot(
        schedule.courses,
        schedule.currentWeek,
        schedule.periods,
        schedule.calendar,
        this.now()
      )
      const widgetSettings: ScheduleWidgetSettings = {
        syncReminderHours: settings.widgetSyncReminderHours,
        showNextDaySchedule: settings.widgetShowNextDaySchedule,
      }
      const hash = JSON.stringify([snapshot, widgetSettings])
      if (hash === this.lastWidgetHash) return

      const snapshotRecord = toWidgetSnapshotRecord(snapshot)
      const settingsRecord = toWidgetSettingsRecord(widgetSettings)

      await Promise.allSettled(
        SCHEDULE_WIDGET_IDS.map((widgetId) =>
          this.widgets.update(widgetId, snapshotRecord, settingsRecord)
        )
      )
      if (!this.disposed && revision === this.widgetRevision && !this.stopped) {
        this.lastWidgetHash = hash
      }
    })

    this.widgetSync = task
    return this.widgetSync
  }

  handleChannelDisabled(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.channelActive = false
    return this.clearAlarmsAndWidgets()
  }

  handleChannelEnabled(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.channelActive = true
    return Promise.all([this.refreshAlarms(), this.refreshWidgets()]).then(() => undefined)
  }

  clearAlarmsAndWidgets(): Promise<void> {
    this.lifecycleRevision += 1
    this.alarmRevision += 1
    this.widgetRevision += 1
    this.lastAlarmHash = ""
    this.lastWidgetHash = ""

    return this.enqueueNative(async () => {
      if (!this.native.isNative) return
      await Promise.allSettled([
        this.cancelNativeAlarms(),
        ...SCHEDULE_WIDGET_IDS.map((widgetId) => this.widgets.clear(widgetId)),
      ])
    })
  }

  dispose(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe()
    }
    this.stopped = true
    this.latestExplicitSchedule = null
    const cleanup = this.clearAlarmsAndWidgets()
    this.disposed = true
    return cleanup
  }

  private attachSubscriptions(): void {
    this.unsubscribers.push(
      this.settingsStore.source.subscribe(() => {
        const current = this.settingsStore.source.getSnapshot()
        const prev = this.previousSettings
        const alarmChanged =
          current.classReminderEnabled !== prev.classReminderEnabled ||
          current.classReminderMinutes !== prev.classReminderMinutes ||
          current.classLiveUpdateEnabled !== prev.classLiveUpdateEnabled ||
          current.classVibrationEnabled !== prev.classVibrationEnabled ||
          current.classReminderDays !== prev.classReminderDays
        const widgetSettingsChanged =
          current.widgetSyncReminderHours !== prev.widgetSyncReminderHours ||
          current.widgetShowNextDaySchedule !== prev.widgetShowNextDaySchedule

        this.previousSettings = {
          classReminderEnabled: current.classReminderEnabled,
          classReminderMinutes: current.classReminderMinutes,
          classLiveUpdateEnabled: current.classLiveUpdateEnabled,
          classVibrationEnabled: current.classVibrationEnabled,
          classReminderDays: current.classReminderDays,
          widgetSyncReminderHours: current.widgetSyncReminderHours,
          widgetShowNextDaySchedule: current.widgetShowNextDaySchedule,
        }

        if (alarmChanged) {
          void this.refreshAlarms()
        }
        if (widgetSettingsChanged) {
          if (this.resolveCurrentScheduleInput()) {
            void this.refreshWidgets()
          } else {
            void this.syncWidgetSettings()
          }
        }
      }),
      this.settingsStore.hydrated.subscribe(() => {
        void this.refreshAlarms()
        void this.refreshWidgets()
      }),
      this.patchesStore.source.subscribe(() => {
        if (this.latestExplicitSchedule === null) {
          void this.refreshAlarms()
          void this.refreshWidgets()
        }
      }),
      this.patchesStore.hydrated.subscribe(() => {
        if (this.latestExplicitSchedule === null) {
          void this.refreshAlarms()
          void this.refreshWidgets()
        }
      }),
      this.provider.state.subscribe(() => {
        if (!this.isFeatureSupported()) {
          this.latestExplicitSchedule = null
          void this.clearAlarmsAndWidgets()
          return
        }
        void this.refreshAlarms()
        void this.refreshWidgets()
      }),
      this.session.state.subscribe(() => {
        const current = this.session.getSnapshot()
        const prev = this.previousSession
        const loggedOutOrSwitchedUser =
          (prev.isAuthenticated && !current.isAuthenticated) || current.username !== prev.username

        this.previousSession = {
          isAuthenticated: current.isAuthenticated,
          username: current.username,
          hasHydrated: current.hasHydrated,
        }

        if (loggedOutOrSwitchedUser) {
          this.stopped = !current.isAuthenticated
          this.latestExplicitSchedule = null
          void this.clearAlarmsAndWidgets()
        }
        if (
          current.isAuthenticated &&
          (!prev.isAuthenticated || current.username !== prev.username)
        ) {
          this.stopped = false
        }
        if (
          current.isAuthenticated !== prev.isAuthenticated ||
          current.username !== prev.username ||
          current.hasHydrated !== prev.hasHydrated
        ) {
          void this.refreshAlarms()
          void this.refreshWidgets()
        }
      })
    )

    if (this.native.isNative) {
      const onDataChange = (): void => {
        this.latestExplicitSchedule = null
        void this.refreshAlarms()
        void this.refreshWidgets()
      }
      if (this.scheduleSource) {
        this.unsubscribers.push(this.scheduleSource.subscribe(onDataChange))
      }
      if (this.currentWeekSource) {
        this.unsubscribers.push(this.currentWeekSource.subscribe(onDataChange))
      }
      if (this.termCalendarSource) {
        this.unsubscribers.push(this.termCalendarSource.subscribe(onDataChange))
      }
      if (this.periodsSource) {
        this.unsubscribers.push(this.periodsSource.subscribe(onDataChange))
      }
    }
  }

  private resolveRemindersCancelMethod(): string {
    const descriptor = this.native.capabilities
      .list()
      .find((item) => item.id === "reminders.classes" || item.id === REMINDERS_CLASSES_CAPABILITY)
    if (
      descriptor &&
      descriptor.methods.includes("cancelAll") &&
      !descriptor.methods.includes("cancel")
    ) {
      return "cancelAll"
    }
    return "cancel"
  }

  private async cancelNativeAlarms(): Promise<void> {
    if (!(await this.capabilityAvailable(REMINDERS_CLASSES_CAPABILITY))) return
    const method = this.resolveRemindersCancelMethod()
    await this.native.capabilities.invoke(REMINDERS_CLASSES_CAPABILITY, method)
  }

  private async capabilityAvailable(capabilityId: string): Promise<boolean> {
    if (!this.native.isNative) return false
    await this.ensureCapabilitiesLoaded().catch(() => {})
    return this.native.capabilities.has(capabilityId)
  }

  private enqueueNative(operation: () => Promise<void>, propagateError = false): Promise<void> {
    const next = this.nativeQueue.then(operation)
    this.nativeQueue = next.catch(() => {})
    return propagateError ? next : this.nativeQueue
  }
}
