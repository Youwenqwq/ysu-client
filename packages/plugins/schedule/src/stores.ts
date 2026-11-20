import {
  resolveSchedulePatches,
  resolveScheduleTerm,
  schedulePatchDependents,
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
  QuerySnapshot,
  SessionSnapshot,
  TermCalendar,
} from "@orahako/academic-sdk"
import { defineStore, type ObservableSource } from "@orahako/sdk"

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

export const schedulePatchesStore = defineStore({
  init: (): SchedulePatchesState => ({
    byScope: {},
  }),
  persist: {
    key: "schedule-patches",
    mode: "secure",
    version: 1,
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

export function formatProviderScope(providerSnap: ProviderRuntimeSnapshot): string {
  return `${providerSnap.schoolId ?? "none"}:${providerSnap.generation}`
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
  return JSON.stringify([
    providerSnapshot.provider.id,
    formatProviderScope(providerSnapshot),
    sessionSnapshot.username,
    semester,
  ])
}

export function validateCandidatePatches(options: {
  readonly id: string
  readonly candidate: readonly SchedulePatch[]
  readonly baseline: readonly SchedulePatch[]
  readonly rawCourses: readonly Course[]
  readonly termStartDate: string
  readonly totalWeeks: number
}): void {
  const { id, candidate, baseline, rawCourses, termStartDate, totalWeeks } = options
  const resolved = resolveSchedulePatches(rawCourses, termStartDate, totalWeeks, candidate)
  const blocked = resolved.issues.find(
    (issue) => issue.patchId === id && BLOCKING_SCHEDULE_ISSUES[issue.reason]
  )
  if (blocked) {
    throw new Error(`scheduleEditor.issue_${blocked.reason}`)
  }

  const baselineResolved = resolveSchedulePatches(rawCourses, termStartDate, totalWeeks, baseline)
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
  readonly generateId?: () => string
  readonly nowMs?: number
}): SchedulePatch {
  const {
    draft,
    stored,
    rawCourses,
    termStartDate,
    totalWeeks,
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
}): EffectiveScheduleSnapshot {
  const term = resolveScheduleTerm(options.calendar, options.currentWeek, options.requestedSemester)
  const scope = computeSchedulePatchScope({
    providerSnapshot: options.providerSnapshot,
    sessionSnapshot: options.sessionSnapshot,
    semester: term?.semester,
  })
  const patches = scope ? (options.patchesState.byScope[scope] ?? EMPTY_PATCHES) : EMPTY_PATCHES
  const ready = Boolean(scope) && options.patchesHydrated && options.rawCourses !== undefined
  const resolved =
    ready && term && options.rawCourses
      ? resolveSchedulePatches(options.rawCourses, term.termStartDate, term.totalWeeks, patches)
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
    termStartDate: term?.termStartDate ?? "",
    totalWeeks: term?.totalWeeks ?? 0,
  }
}

export interface SchedulePatchMutationContext {
  readonly expectedScope: string | null
  readonly rawCourses: readonly Course[] | undefined
  readonly termStartDate: string
  readonly totalWeeks: number
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
      parsed[0] !== providerSnap.provider.id ||
      parsed[1] !== formatProviderScope(providerSnap) ||
      parsed[2] !== sessionSnap.username
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
    reset(ctx) {
      ctx.reset()
    },
  },
})

export type ScheduleViewStoreInstance = ReturnType<typeof scheduleViewStore.create>

const IDLE_REFRESH = async (): Promise<undefined> => undefined

function createIdleQuerySnapshot<T>(): QuerySnapshot<T> {
  return {
    status: "idle",
    data: undefined,
    error: null,
    isLoading: false,
    isRefreshing: false,
    isStale: false,
    updatedAt: null,
    refresh: IDLE_REFRESH,
  }
}

export function createParameterizedQuerySource<S, K, T>(options: {
  readonly state: ObservableSource<S>
  readonly selectKey: (state: S) => K
  readonly serializeKey: (key: K) => string
  readonly resolveSource: (key: K) => ObservableSource<QuerySnapshot<T>> | null
}): ObservableSource<QuerySnapshot<T>> {
  const idleSnapshot = createIdleQuerySnapshot<T>()
  const subscribers = new Set<() => void>()
  let activeKeySerialized: string | null = null
  let activeInner: ObservableSource<QuerySnapshot<T>> | null = null
  let unsubscribeState: (() => void) | null = null
  let unsubscribeInner: (() => void) | null = null

  const notify = (): void => {
    for (const listener of [...subscribers]) {
      listener()
    }
  }

  const rebind = (shouldNotify: boolean): void => {
    const key = options.selectKey(options.state.getSnapshot())
    const serialized = options.serializeKey(key)
    if (serialized === activeKeySerialized) return

    unsubscribeInner?.()
    unsubscribeInner = null
    activeKeySerialized = serialized
    activeInner = options.resolveSource(key)
    if (activeInner && subscribers.size > 0) {
      unsubscribeInner = activeInner.subscribe(notify)
    }
    if (shouldNotify) {
      notify()
    }
  }

  return {
    getSnapshot(): QuerySnapshot<T> {
      if (subscribers.size === 0) {
        const key = options.selectKey(options.state.getSnapshot())
        const inner = options.resolveSource(key)
        return inner ? inner.getSnapshot() : idleSnapshot
      }
      return activeInner ? activeInner.getSnapshot() : idleSnapshot
    },
    subscribe(listener: () => void): () => void {
      const wasEmpty = subscribers.size === 0
      subscribers.add(listener)
      if (wasEmpty) {
        activeKeySerialized = null
        rebind(false)
        unsubscribeState = options.state.subscribe(() => {
          rebind(true)
        })
      }
      return () => {
        subscribers.delete(listener)
        if (subscribers.size === 0) {
          unsubscribeInner?.()
          unsubscribeInner = null
          unsubscribeState?.()
          unsubscribeState = null
          activeInner = null
          activeKeySerialized = null
        }
      }
    },
  }
}

export function createMinuteClockSource(nowMs: () => number = Date.now): {
  readonly source: ObservableSource<number>
  dispose(): void
} {
  const listeners = new Set<() => void>()
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const readBucket = (): number => Math.floor(nowMs() / 60_000) * 60_000
  let currentBucket = readBucket()

  const clearTimer = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const scheduleNext = (): void => {
    clearTimer()
    if (disposed || listeners.size === 0) return
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return
    const delay = Math.max(250, 60_000 - (nowMs() % 60_000))
    timer = setTimeout(tick, delay)
  }

  const tick = (): void => {
    if (disposed) return
    const nextBucket = readBucket()
    if (nextBucket !== currentBucket) {
      currentBucket = nextBucket
      for (const listener of [...listeners]) {
        listener()
      }
    }
    scheduleNext()
  }

  const attachVisibility = (): (() => void) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return () => {}
    }
    const onWake = (): void => tick()
    if (typeof window.addEventListener === "function") {
      window.addEventListener("focus", onWake)
    }
    if (typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", onWake)
    }
    return () => {
      if (typeof window.removeEventListener === "function") {
        window.removeEventListener("focus", onWake)
      }
      if (typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", onWake)
      }
    }
  }

  let detachVisibility: (() => void) | null = null

  return {
    source: {
      getSnapshot: () => readBucket(),
      subscribe(listener: () => void): () => void {
        if (disposed) return () => {}
        const wasEmpty = listeners.size === 0
        listeners.add(listener)
        if (wasEmpty) {
          currentBucket = readBucket()
          detachVisibility = attachVisibility()
          scheduleNext()
        }
        return () => {
          listeners.delete(listener)
          if (listeners.size === 0) {
            clearTimer()
            detachVisibility?.()
            detachVisibility = null
          }
        }
      },
    },
    dispose(): void {
      disposed = true
      clearTimer()
      detachVisibility?.()
      detachVisibility = null
      listeners.clear()
    },
  }
}
