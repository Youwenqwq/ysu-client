import {
  formatWeekList,
  resolveSchedulePatches,
  resolveScheduleTerm,
  schedulePatchDependents,
  type CourseOverride,
  type ScheduleDrop,
  type ScheduleIssue,
  type ScheduleOccurrence,
  type SchedulePatch,
  type ScheduleTrace,
} from "@orahako/academic-kit"
import type {
  Course,
  CurrentWeek,
  ProviderRuntimeSnapshot,
  SessionSnapshot,
  TermCalendar,
} from "@orahako/academic-sdk"
import { defineStore, type ScheduleDeliveryMode, type ScheduleEntry } from "@orahako/sdk"

export interface WidgetAssistantPosition {
  readonly x: number
  readonly y: number
}

export interface ScheduleSettingsState {
  readonly compactMode: boolean
  readonly widgetSyncReminderHours: number
  readonly widgetShowNextDaySchedule: boolean
  readonly widgetAssistantHidden: boolean
  readonly widgetAssistantPosition: WidgetAssistantPosition | null
  readonly classReminderEnabled: boolean
  readonly classReminderMinutes: number
  readonly classLiveUpdateEnabled: boolean
  readonly classVibrationEnabled: boolean
  readonly classReminderDays: number
  readonly calendarSyncEnabled: boolean
  readonly calendarSyncIncludeExams: boolean
  readonly calendarSyncWriteReminders: boolean
  readonly webcalEnabled: boolean
  readonly webcalIncludeExams: boolean
  readonly webcalWriteReminders: boolean
  readonly webcalReadToken: string | null
  readonly webcalWriteToken: string | null
  readonly webcalLastSyncedAt: number | null
  readonly webcalLastSyncedCount: number | null
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

export const scheduleSettingsStore = defineStore({
  init: (): ScheduleSettingsState => ({
    compactMode: false,
    widgetSyncReminderHours: 24,
    widgetShowNextDaySchedule: false,
    widgetAssistantHidden: false,
    widgetAssistantPosition: null,
    classReminderEnabled: false,
    classReminderMinutes: 15,
    classLiveUpdateEnabled: false,
    classVibrationEnabled: false,
    classReminderDays: 7,
    calendarSyncEnabled: false,
    calendarSyncIncludeExams: true,
    calendarSyncWriteReminders: false,
    webcalEnabled: false,
    webcalIncludeExams: true,
    webcalWriteReminders: true,
    webcalReadToken: null,
    webcalWriteToken: null,
    webcalLastSyncedAt: null,
    webcalLastSyncedCount: null,
  }),
  persist: {
    key: "schedule-settings",
    mode: "local",
    version: 1,
  },
  actions: {
    setCompactMode(ctx, compactMode: boolean) {
      ctx.set((prev) => (prev.compactMode === compactMode ? prev : { ...prev, compactMode }))
    },
    setWidgetSyncReminderHours(ctx, hours: number) {
      const clamped = clampInt(hours, 0, 168, 24)
      ctx.set((prev) =>
        prev.widgetSyncReminderHours === clamped
          ? prev
          : { ...prev, widgetSyncReminderHours: clamped }
      )
    },
    setWidgetShowNextDaySchedule(ctx, showNextDay: boolean) {
      ctx.set((prev) =>
        prev.widgetShowNextDaySchedule === showNextDay
          ? prev
          : { ...prev, widgetShowNextDaySchedule: showNextDay }
      )
    },
    setWidgetAssistantHidden(ctx, hidden: boolean) {
      ctx.set((prev) =>
        prev.widgetAssistantHidden === hidden ? prev : { ...prev, widgetAssistantHidden: hidden }
      )
    },
    setWidgetAssistantPosition(ctx, position: WidgetAssistantPosition | null) {
      ctx.set((prev) => ({ ...prev, widgetAssistantPosition: position }))
    },
    setClassReminderEnabled(ctx, enabled: boolean) {
      ctx.set((prev) =>
        prev.classReminderEnabled === enabled ? prev : { ...prev, classReminderEnabled: enabled }
      )
    },
    setClassReminderMinutes(ctx, minutes: number) {
      const clamped = clampInt(minutes, 1, 120, 15)
      ctx.set((prev) =>
        prev.classReminderMinutes === clamped ? prev : { ...prev, classReminderMinutes: clamped }
      )
    },
    setClassLiveUpdateEnabled(ctx, enabled: boolean) {
      ctx.set((prev) =>
        prev.classLiveUpdateEnabled === enabled
          ? prev
          : { ...prev, classLiveUpdateEnabled: enabled }
      )
    },
    setClassVibrationEnabled(ctx, enabled: boolean) {
      ctx.set((prev) =>
        prev.classVibrationEnabled === enabled ? prev : { ...prev, classVibrationEnabled: enabled }
      )
    },
    setClassReminderDays(ctx, days: number) {
      const clamped = clampInt(days, 1, 14, 7)
      ctx.set((prev) =>
        prev.classReminderDays === clamped ? prev : { ...prev, classReminderDays: clamped }
      )
    },
    setCalendarSyncEnabled(ctx, enabled: boolean) {
      ctx.set((prev) =>
        prev.calendarSyncEnabled === enabled ? prev : { ...prev, calendarSyncEnabled: enabled }
      )
    },
    setCalendarSyncIncludeExams(ctx, includeExams: boolean) {
      ctx.set((prev) =>
        prev.calendarSyncIncludeExams === includeExams
          ? prev
          : { ...prev, calendarSyncIncludeExams: includeExams }
      )
    },
    setCalendarSyncWriteReminders(ctx, writeReminders: boolean) {
      ctx.set((prev) =>
        prev.calendarSyncWriteReminders === writeReminders
          ? prev
          : { ...prev, calendarSyncWriteReminders: writeReminders }
      )
    },
    setWebcalIncludeExams(ctx, includeExams: boolean) {
      ctx.set((prev) =>
        prev.webcalIncludeExams === includeExams
          ? prev
          : { ...prev, webcalIncludeExams: includeExams }
      )
    },
    setWebcalWriteReminders(ctx, writeReminders: boolean) {
      ctx.set((prev) =>
        prev.webcalWriteReminders === writeReminders
          ? prev
          : { ...prev, webcalWriteReminders: writeReminders }
      )
    },
    setWebcalPublished(
      ctx,
      payload: {
        readonly readToken: string
        readonly writeToken: string
        readonly count: number
        readonly syncedAt: number
      }
    ) {
      ctx.set((prev) => ({
        ...prev,
        webcalEnabled: true,
        webcalReadToken: payload.readToken,
        webcalWriteToken: payload.writeToken,
        webcalLastSyncedCount: payload.count,
        webcalLastSyncedAt: payload.syncedAt,
      }))
    },
    clearWebcal(ctx) {
      ctx.set((prev) => ({
        ...prev,
        webcalEnabled: false,
        webcalReadToken: null,
        webcalWriteToken: null,
        webcalLastSyncedCount: null,
        webcalLastSyncedAt: null,
      }))
    },
    reset(ctx) {
      ctx.reset()
    },
  },
})

export type ScheduleSettingsStoreInstance = ReturnType<typeof scheduleSettingsStore.create>

export type SchedulePatchDraft = Omit<SchedulePatch, "id" | "createdAt" | "enabled">

export interface SchedulePatchesState {
  readonly byScope: Readonly<Record<string, readonly SchedulePatch[]>>
}

const EMPTY_PATCHES: readonly SchedulePatch[] = []
const EMPTY_OCCURRENCES: readonly ScheduleOccurrence[] = []
const EMPTY_TRACES: readonly ScheduleTrace[] = []
const EMPTY_ISSUES: readonly ScheduleIssue[] = []

export const BLOCKING_SCHEDULE_ISSUES: Readonly<Partial<Record<ScheduleIssue["reason"], true>>> = {
  invalidDate: true,
  invalidSections: true,
  missingDependency: true,
  dependencyCycle: true,
  targetChanged: true,
  patchConflict: true,
}

const SCHEDULE_PATCHES_VERSION = 2

function normalizePatchScopeKey(scopeKey: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(scopeKey)
  } catch {
    return null
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every((part) => typeof part === "string" && part.length > 0)
  ) {
    return null
  }
  if (parsed.length === 3) return scopeKey
  if (parsed.length !== 4) return null
  return JSON.stringify([parsed[0], parsed[2], parsed[3]])
}

function mergePatchLists(
  left: readonly SchedulePatch[],
  right: readonly SchedulePatch[]
): readonly SchedulePatch[] {
  const byId = new Map<string, SchedulePatch>()
  for (const patch of left) {
    byId.set(patch.id, patch)
  }
  for (const patch of right) {
    const existing = byId.get(patch.id)
    if (existing === undefined || Date.parse(patch.createdAt) >= Date.parse(existing.createdAt)) {
      byId.set(patch.id, patch)
    }
  }
  return Array.from(byId.values())
}

function migrateSchedulePatchesState(persisted: unknown): SchedulePatchesState {
  if (typeof persisted !== "object" || persisted === null || !("byScope" in persisted)) {
    return { byScope: {} }
  }
  const rawByScope = persisted.byScope
  if (typeof rawByScope !== "object" || rawByScope === null || Array.isArray(rawByScope)) {
    return { byScope: {} }
  }
  const byScope: Record<string, readonly SchedulePatch[]> = {}
  for (const [scopeKey, patches] of Object.entries(rawByScope)) {
    if (!Array.isArray(patches)) continue
    const scope = normalizePatchScopeKey(scopeKey)
    if (!scope) continue
    const retained = patches as readonly SchedulePatch[]
    byScope[scope] = mergePatchLists(byScope[scope] ?? [], retained)
  }
  return { byScope }
}

export const schedulePatchesStore = defineStore({
  init: (): SchedulePatchesState => ({
    byScope: {},
  }),
  persist: {
    key: "schedule-patches",
    mode: "secure",
    version: SCHEDULE_PATCHES_VERSION,
    migrate: migrateSchedulePatchesState,
  },
  actions: {
    add(ctx, scope: string, patch: SchedulePatch) {
      if (!scope) {
        throw new Error("scheduleEditor.notReady")
      }
      ctx.set((state) => ({
        byScope: {
          ...state.byScope,
          [scope]: [...(state.byScope[scope] ?? EMPTY_PATCHES), patch],
        },
      }))
    },
    remove(ctx, scope: string, id: string) {
      if (!scope) return
      ctx.set((state) => {
        const patches = state.byScope[scope] ?? EMPTY_PATCHES
        if (patches.length === 0) return state
        const removed = new Set([id, ...schedulePatchDependents(patches, id)])
        const next = patches.filter((patch) => !removed.has(patch.id))
        if (next.length === patches.length) return state
        return {
          byScope: {
            ...state.byScope,
            [scope]: next,
          },
        }
      })
    },
    setEnabled(ctx, scope: string, id: string, enabled: boolean) {
      if (!scope) return
      ctx.set((state) => {
        const patches = state.byScope[scope] ?? EMPTY_PATCHES
        const target = patches.find((patch) => patch.id === id)
        if (!target) return state
        if (
          enabled &&
          target.dependsOn.some(
            (dependency) => !patches.some((patch) => patch.id === dependency && patch.enabled)
          )
        ) {
          throw new Error("scheduleEditor.issue_missingDependency")
        }
        const affected = new Set(enabled ? [id] : [id, ...schedulePatchDependents(patches, id)])
        return {
          byScope: {
            ...state.byScope,
            [scope]: patches.map((patch) =>
              affected.has(patch.id) ? { ...patch, enabled } : patch
            ),
          },
        }
      })
    },
    clearScope(ctx, scope: string) {
      if (!scope) return
      ctx.set((state) => {
        if (!(scope in state.byScope)) return state
        const nextByScope = { ...state.byScope }
        delete nextByScope[scope]
        return { byScope: nextByScope }
      })
    },
    reset(ctx) {
      ctx.reset()
    },
  },
})

export type SchedulePatchesStoreInstance = ReturnType<typeof schedulePatchesStore.create>

export type CustomScheduleKind = "course" | "event"
export type CustomScheduleTimeMode = "section" | "time"
export type CustomScheduleRecurrence = "once" | "weekly" | "academic-weeks"

export interface CustomScheduleItem {
  readonly id: string
  readonly kind: CustomScheduleKind
  readonly title: string
  readonly location?: string
  readonly teacher?: string
  readonly deliveryMode?: ScheduleDeliveryMode
  readonly note?: string
  readonly remindable?: boolean
  readonly timeMode: CustomScheduleTimeMode
  readonly startSection?: number
  readonly endSection?: number
  readonly startMinute?: number
  readonly endMinute?: number
  readonly recurrence: CustomScheduleRecurrence
  readonly date?: string
  readonly weekDay?: number
  readonly weekList?: readonly number[]
  /** Academic scope key when scoped to a school/user/semester; null/undefined means global personal item. */
  readonly semesterScope?: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ScheduleCustomizationsState {
  readonly overridesByScope: Readonly<Record<string, readonly CourseOverride[]>>
  readonly customItems: readonly CustomScheduleItem[]
}

const EMPTY_OVERRIDES: readonly CourseOverride[] = []
const EMPTY_CUSTOM_ITEMS: readonly CustomScheduleItem[] = []
const EMPTY_CUSTOMIZATIONS: ScheduleCustomizationsState = {
  overridesByScope: {},
  customItems: EMPTY_CUSTOM_ITEMS,
}

export const scheduleCustomizationsStore = defineStore({
  init: (): ScheduleCustomizationsState => ({
    overridesByScope: {},
    customItems: [],
  }),
  persist: {
    key: "schedule-customizations",
    mode: "secure",
    version: 1,
  },
  actions: {
    upsertOverride(ctx, scope: string, override: CourseOverride) {
      if (!scope) return
      ctx.set((state) => {
        const current = state.overridesByScope[scope] ?? EMPTY_OVERRIDES
        const idx = current.findIndex((item) => item.courseKey === override.courseKey)
        const nextList =
          idx >= 0
            ? current.map((item, i) => (i === idx ? override : item))
            : [...current, override]
        return {
          ...state,
          overridesByScope: {
            ...state.overridesByScope,
            [scope]: nextList,
          },
        }
      })
    },
    removeOverride(ctx, scope: string, courseKey: string) {
      if (!scope) return
      ctx.set((state) => {
        const current = state.overridesByScope[scope] ?? EMPTY_OVERRIDES
        const nextList = current.filter((item) => item.courseKey !== courseKey)
        if (nextList.length === current.length) return state
        return {
          ...state,
          overridesByScope: {
            ...state.overridesByScope,
            [scope]: nextList,
          },
        }
      })
    },
    upsertCustomItem(ctx, item: CustomScheduleItem) {
      ctx.set((state) => {
        const idx = state.customItems.findIndex((existing) => existing.id === item.id)
        const nextItems =
          idx >= 0
            ? state.customItems.map((existing, i) => (i === idx ? item : existing))
            : [...state.customItems, item]
        return { ...state, customItems: nextItems }
      })
    },
    removeCustomItem(ctx, id: string) {
      ctx.set((state) => {
        const nextItems = state.customItems.filter((item) => item.id !== id)
        if (nextItems.length === state.customItems.length) return state
        return { ...state, customItems: nextItems }
      })
    },
    reset(ctx) {
      ctx.reset()
    },
  },
})

export type ScheduleCustomizationsStoreInstance = ReturnType<
  typeof scheduleCustomizationsStore.create
>

export function isCustomItemActiveInScope(item: CustomScheduleItem, scope: string | null): boolean {
  if (!item.semesterScope) return true
  return scope !== null && item.semesterScope === scope
}

export function customItemToCourse(item: CustomScheduleItem, totalWeeks: number): Course | null {
  if (item.timeMode !== "section") return null
  const startSection = item.startSection ?? 1
  const endSection = Math.max(startSection, item.endSection ?? startSection)
  const weekDay = item.weekDay ?? 1
  if (!Number.isInteger(weekDay) || weekDay < 1 || weekDay > 7) return null

  const maxWeeks = Math.max(1, totalWeeks || 20)
  const weekList =
    item.recurrence === "academic-weeks" && item.weekList && item.weekList.length > 0
      ? [...new Set(item.weekList.filter((w) => Number.isInteger(w) && w >= 1))].sort(
          (a, b) => a - b
        )
      : Array.from({ length: maxWeeks }, (_, i) => i + 1)

  return {
    name: item.title,
    classroom: item.location,
    teacher: item.teacher,
    weekDay,
    startSection,
    endSection,
    weekList,
    weeks: formatWeekList(weekList),
    scheduleId: `custom:${item.id}`,
    ...(item.deliveryMode ? { deliveryMode: item.deliveryMode } : {}),
    ...(item.note ? { note: item.note } : {}),
  }
}

export function customItemToOverlayEntry(
  item: CustomScheduleItem,
  pluginId: string
): ScheduleEntry | null {
  if (item.timeMode === "section" && item.recurrence !== "once") {
    return null
  }
  const parsedDateWeekday = item.date ? parseIsoWeekday(item.date) : null
  const weekDay =
    item.recurrence === "once" ? (parsedDateWeekday ?? item.weekDay ?? 1) : (item.weekDay ?? 1)
  if (!Number.isInteger(weekDay) || weekDay < 1 || weekDay > 7) return null

  const sections =
    item.timeMode === "section" && item.startSection
      ? {
          startSection: item.startSection,
          endSection: Math.max(item.startSection, item.endSection ?? item.startSection),
        }
      : undefined
  const time =
    item.timeMode === "time" &&
    typeof item.startMinute === "number" &&
    typeof item.endMinute === "number" &&
    item.endMinute > item.startMinute
      ? { startMinute: item.startMinute, endMinute: item.endMinute }
      : undefined
  if (!sections && !time) return null

  return {
    id: `custom:${item.id}`,
    seriesId: `custom:${item.id}`,
    sourceId: "personal",
    sourcePluginId: pluginId,
    category: item.kind === "course" ? "custom" : "personal",
    title: item.title,
    ...(item.location ? { location: item.location } : {}),
    ...(item.teacher ? { subtitle: item.teacher } : {}),
    ...(item.deliveryMode ? { deliveryMode: item.deliveryMode } : {}),
    ...(item.note ? { note: item.note } : {}),
    ...(item.recurrence === "once" && item.date ? { date: item.date } : {}),
    weekDay,
    ...(item.recurrence === "academic-weeks" && item.weekList && item.weekList.length > 0
      ? { weekList: item.weekList }
      : {}),
    ...(sections ? { sections } : {}),
    ...(time ? { time } : {}),
    remindable: item.remindable !== false,
    metadata: { customItemId: item.id, customKind: item.kind },
  }
}

function parseIsoWeekday(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(isoDate)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)
  if (Number.isNaN(date.getTime())) return null
  const day = date.getDay()
  return day === 0 ? 7 : day
}

export function computeSchedulePatchScope(options: {
  readonly providerSnapshot: ProviderRuntimeSnapshot
  readonly sessionSnapshot: SessionSnapshot
  readonly semester: string | undefined
}): string | null {
  const { providerSnapshot, sessionSnapshot, semester } = options
  if (
    providerSnapshot.status !== "ready" ||
    !providerSnapshot.provider ||
    !sessionSnapshot.hasHydrated ||
    !sessionSnapshot.isAuthenticated ||
    !sessionSnapshot.username ||
    !semester
  ) {
    return null
  }
  return JSON.stringify([providerSnapshot.provider.id, sessionSnapshot.username, semester])
}

export function validateCandidatePatches(options: {
  readonly id: string
  readonly candidate: readonly SchedulePatch[]
  readonly baseline: readonly SchedulePatch[]
  readonly rawCourses: readonly Course[]
  readonly termStartDate: string
  readonly totalWeeks: number
  readonly overrides?: readonly CourseOverride[]
  readonly customCourses?: readonly Course[]
}): void {
  const {
    id,
    candidate,
    baseline,
    rawCourses,
    termStartDate,
    totalWeeks,
    overrides,
    customCourses,
  } = options
  const resolveOpts =
    overrides?.length || customCourses?.length ? { overrides, customCourses } : undefined
  const resolved = resolveSchedulePatches(
    rawCourses,
    termStartDate,
    totalWeeks,
    candidate,
    resolveOpts
  )
  const blocked = resolved.issues.find(
    (issue) => issue.patchId === id && BLOCKING_SCHEDULE_ISSUES[issue.reason]
  )
  if (blocked) {
    throw new Error(`scheduleEditor.issue_${blocked.reason}`)
  }

  const baselineResolved = resolveSchedulePatches(
    rawCourses,
    termStartDate,
    totalWeeks,
    baseline,
    resolveOpts
  )
  if (
    resolved.issues.some(
      (issue) =>
        issue.patchId !== id &&
        BLOCKING_SCHEDULE_ISSUES[issue.reason] &&
        !baselineResolved.issues.some(
          (old) => old.patchId === issue.patchId && old.reason === issue.reason
        )
    )
  ) {
    throw new Error("scheduleEditor.issue_patchConflict")
  }

  const patch = candidate.find((item) => item.id === id)
  if (
    patch &&
    ((patch.source.length === 0 && patch.mode !== "clear") ||
      (patch.kind === "course" && patch.source.length !== 1) ||
      new Set(patch.source.map((item) => item.occurrenceId)).size !== patch.source.length)
  ) {
    throw new Error("scheduleEditor.issue_sourceAmbiguous")
  }
}

export function createValidatedSchedulePatch(options: {
  readonly draft: SchedulePatchDraft
  readonly stored: readonly SchedulePatch[]
  readonly rawCourses: readonly Course[]
  readonly termStartDate: string
  readonly totalWeeks: number
  readonly overrides?: readonly CourseOverride[]
  readonly customCourses?: readonly Course[]
  readonly generateId?: () => string
  readonly nowMs?: number
}): SchedulePatch {
  const {
    draft,
    stored,
    rawCourses,
    termStartDate,
    totalWeeks,
    overrides,
    customCourses,
    generateId = () => crypto.randomUUID(),
    nowMs = Date.now(),
  } = options
  const timestamp = Math.max(nowMs, ...stored.map((item) => Date.parse(item.createdAt) + 1))
  const patch: SchedulePatch = structuredClone({
    ...draft,
    id: generateId(),
    createdAt: new Date(timestamp).toISOString(),
    enabled: true,
    dependsOn: [
      ...new Set([
        ...draft.dependsOn,
        ...draft.source.flatMap((item) => item.patchIds),
        ...draft.replaced.flatMap((item) => item.patchIds),
      ]),
    ],
  })
  validateCandidatePatches({
    id: patch.id,
    candidate: [...stored, patch],
    baseline: stored,
    rawCourses,
    termStartDate,
    totalWeeks,
    overrides,
    customCourses,
  })
  return patch
}

export interface EffectiveScheduleSnapshot {
  readonly scope: string | null
  readonly ready: boolean
  readonly courses: readonly ScheduleOccurrence[]
  readonly traces: readonly ScheduleTrace[]
  readonly issues: readonly ScheduleIssue[]
  readonly patches: readonly SchedulePatch[]
  readonly overrides: readonly CourseOverride[]
  readonly customCourses: readonly Course[]
  readonly customItems: readonly CustomScheduleItem[]
  readonly termStartDate: string
  readonly totalWeeks: number
}

export function computeEffectiveScheduleSnapshot(options: {
  readonly rawCourses: readonly Course[] | undefined
  readonly calendar: TermCalendar | undefined
  readonly currentWeek: CurrentWeek | null
  readonly requestedSemester?: string
  readonly providerSnapshot: ProviderRuntimeSnapshot
  readonly sessionSnapshot: SessionSnapshot
  readonly patchesState: SchedulePatchesState
  readonly patchesHydrated: boolean
  readonly customizationsState?: ScheduleCustomizationsState
  readonly customizationsHydrated?: boolean
}): EffectiveScheduleSnapshot {
  const term = resolveScheduleTerm(options.calendar, options.currentWeek, options.requestedSemester)
  const scope = computeSchedulePatchScope({
    providerSnapshot: options.providerSnapshot,
    sessionSnapshot: options.sessionSnapshot,
    semester: term?.semester,
  })
  const customizations = options.customizationsState ?? EMPTY_CUSTOMIZATIONS
  const customizationsHydrated = options.customizationsHydrated ?? true
  const patches = scope ? (options.patchesState.byScope[scope] ?? EMPTY_PATCHES) : EMPTY_PATCHES
  const overrides = scope
    ? (customizations.overridesByScope[scope] ?? EMPTY_OVERRIDES)
    : EMPTY_OVERRIDES
  const scopedCustomItems = customizations.customItems.filter((item) =>
    isCustomItemActiveInScope(item, scope)
  )
  const customCourses = scopedCustomItems
    .filter((item) => item.timeMode === "section" && item.recurrence !== "once")
    .map((item) => customItemToCourse(item, term?.totalWeeks ?? 20))
    .filter((course): course is Course => course !== null)

  const ready =
    Boolean(scope) &&
    options.patchesHydrated &&
    customizationsHydrated &&
    options.rawCourses !== undefined
  const resolved =
    ready && term && options.rawCourses
      ? resolveSchedulePatches(options.rawCourses, term.termStartDate, term.totalWeeks, patches, {
          overrides,
          customCourses,
        })
      : {
          courses: EMPTY_OCCURRENCES,
          traces: EMPTY_TRACES,
          issues: EMPTY_ISSUES,
        }

  return {
    scope,
    ready,
    courses: resolved.courses,
    traces: resolved.traces,
    issues: resolved.issues,
    patches,
    overrides,
    customCourses,
    customItems: scopedCustomItems,
    termStartDate: term?.termStartDate ?? "",
    totalWeeks: term?.totalWeeks ?? 0,
  }
}

export interface SchedulePatchMutationContext {
  readonly expectedScope: string | null
  readonly rawCourses: readonly Course[] | undefined
  readonly termStartDate: string
  readonly totalWeeks: number
  readonly overrides?: readonly CourseOverride[]
  readonly customCourses?: readonly Course[]
}

export interface SchedulePatchMutators {
  addPatch(ctx: SchedulePatchMutationContext, draft: SchedulePatchDraft): string
  removePatch(ctx: SchedulePatchMutationContext, id: string): void
  setPatchEnabled(ctx: SchedulePatchMutationContext, id: string, enabled: boolean): void
}

export function createSchedulePatchMutators(deps: {
  readonly patchesStore: SchedulePatchesStoreInstance
  readonly getProviderSnapshot: () => ProviderRuntimeSnapshot
  readonly getSessionSnapshot: () => SessionSnapshot
}): SchedulePatchMutators {
  const assertReady = (
    mutationCtx: SchedulePatchMutationContext
  ): {
    readonly scope: string
    readonly rawCourses: readonly Course[]
    readonly termStartDate: string
    readonly totalWeeks: number
  } => {
    const hydrated = deps.patchesStore.hydrated.getSnapshot()
    const providerSnap = deps.getProviderSnapshot()
    const sessionSnap = deps.getSessionSnapshot()
    if (
      !hydrated ||
      !mutationCtx.expectedScope ||
      mutationCtx.rawCourses === undefined ||
      !mutationCtx.termStartDate ||
      mutationCtx.totalWeeks < 1 ||
      providerSnap.status !== "ready" ||
      !providerSnap.provider ||
      !sessionSnap.hasHydrated ||
      !sessionSnap.isAuthenticated ||
      !sessionSnap.username
    ) {
      throw new Error("scheduleEditor.notReady")
    }
    const parsed: unknown = JSON.parse(mutationCtx.expectedScope)
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 3 ||
      parsed[0] !== providerSnap.provider.id ||
      parsed[1] !== sessionSnap.username ||
      typeof parsed[2] !== "string" ||
      parsed[2].length === 0
    ) {
      throw new Error("scheduleEditor.notReady")
    }
    return {
      scope: mutationCtx.expectedScope,
      rawCourses: mutationCtx.rawCourses,
      termStartDate: mutationCtx.termStartDate,
      totalWeeks: mutationCtx.totalWeeks,
    }
  }

  return {
    addPatch(mutationCtx, draft) {
      const ready = assertReady(mutationCtx)
      const stored = deps.patchesStore.source.getSnapshot().byScope[ready.scope] ?? EMPTY_PATCHES
      const patch = createValidatedSchedulePatch({
        draft,
        stored,
        rawCourses: ready.rawCourses,
        termStartDate: ready.termStartDate,
        totalWeeks: ready.totalWeeks,
        overrides: mutationCtx.overrides,
        customCourses: mutationCtx.customCourses,
      })
      deps.patchesStore.actions.add(ready.scope, patch)
      return patch.id
    },
    removePatch(mutationCtx, id) {
      const ready = assertReady(mutationCtx)
      deps.patchesStore.actions.remove(ready.scope, id)
    },
    setPatchEnabled(mutationCtx, id, enabled) {
      const ready = assertReady(mutationCtx)
      if (enabled) {
        const stored = deps.patchesStore.source.getSnapshot().byScope[ready.scope] ?? EMPTY_PATCHES
        validateCandidatePatches({
          id,
          candidate: stored.map((patch) => (patch.id === id ? { ...patch, enabled } : patch)),
          baseline: stored,
          rawCourses: ready.rawCourses,
          termStartDate: ready.termStartDate,
          totalWeeks: ready.totalWeeks,
          overrides: mutationCtx.overrides,
          customCourses: mutationCtx.customCourses,
        })
      }
      deps.patchesStore.actions.setEnabled(ready.scope, id, enabled)
    },
  }
}

export interface PendingScheduleDrop {
  readonly scope: string
  readonly drop: ScheduleDrop
}

export interface ActivePatchManager {
  readonly scope: string
  readonly id: string | null
}

export interface PendingPatchUndo {
  readonly scope: string
  readonly id: string
  readonly remove: boolean
}

export interface ScheduleViewState {
  readonly weekOverride: number | null
  readonly termInput: string
  readonly queriedTerm: string
  readonly filterDrawerOpen: boolean
  readonly editScope: string | null
  readonly showOriginal: boolean
  readonly pendingDrop: PendingScheduleDrop | null
  readonly manager: ActivePatchManager | null
  readonly undo: PendingPatchUndo | null
  readonly createRequestNonce: number
}

export const scheduleViewStore = defineStore({
  init: (): ScheduleViewState => ({
    weekOverride: null,
    termInput: "",
    queriedTerm: "",
    filterDrawerOpen: false,
    editScope: null,
    showOriginal: false,
    pendingDrop: null,
    manager: null,
    undo: null,
    createRequestNonce: 0,
  }),
  actions: {
    setWeekOverride(ctx, weekOverride: number | null) {
      ctx.set((prev) => (prev.weekOverride === weekOverride ? prev : { ...prev, weekOverride }))
    },
    setTermInput(ctx, termInput: string) {
      ctx.set((prev) => (prev.termInput === termInput ? prev : { ...prev, termInput }))
    },
    commitQueriedTerm(ctx, queriedTerm: string) {
      ctx.set((prev) => ({
        ...prev,
        queriedTerm,
        weekOverride: null,
        filterDrawerOpen: false,
      }))
    },
    setFilterDrawerOpen(ctx, open: boolean) {
      ctx.set((prev) =>
        prev.filterDrawerOpen === open ? prev : { ...prev, filterDrawerOpen: open }
      )
    },
    enterEditor(ctx, scope: string, clampedWeek: number) {
      ctx.set((prev) => ({
        ...prev,
        weekOverride: clampedWeek,
        showOriginal: false,
        filterDrawerOpen: false,
        editScope: scope,
      }))
    },
    finishEditing(ctx) {
      ctx.set((prev) => ({
        ...prev,
        editScope: null,
        pendingDrop: null,
      }))
    },
    setShowOriginal(ctx, showOriginal: boolean) {
      ctx.set((prev) => ({
        ...prev,
        showOriginal,
        ...(showOriginal ? { manager: null } : {}),
      }))
    },
    setPendingDrop(ctx, pendingDrop: PendingScheduleDrop | null) {
      ctx.set((prev) => ({ ...prev, pendingDrop }))
    },
    setManager(ctx, manager: ActivePatchManager | null) {
      ctx.set((prev) => ({ ...prev, manager }))
    },
    setUndo(ctx, undo: PendingPatchUndo | null) {
      ctx.set((prev) => ({ ...prev, undo }))
    },
    requestCreate(ctx) {
      ctx.set((prev) => ({
        ...prev,
        filterDrawerOpen: false,
        createRequestNonce: prev.createRequestNonce + 1,
      }))
    },
    reset(ctx) {
      ctx.reset()
    },
  },
})

export type ScheduleViewStoreInstance = ReturnType<typeof scheduleViewStore.create>
