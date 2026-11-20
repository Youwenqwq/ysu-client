import { buildExamWidgetSnapshot, getAcademicClock, getExamStartTime } from "@orahako/academic-kit"
import type { Exam, QuerySnapshot } from "@orahako/academic-sdk"
import type { ObservableSource, PluginWidgetService, WidgetSnapshot } from "@orahako/sdk"

export const EXAM_WIDGET_IDS = ["exam", "exam-compact"] as const
export type ExamWidgetId = (typeof EXAM_WIDGET_IDS)[number]

export const DEFAULT_EXAM_SYNC_REMINDER_HOURS = 24

export function computeExamDayDiff(exam: Exam, now: Date = new Date()): number | null {
  const startDate = getExamStartTime(exam)
  if (!startDate) return null
  const todayMs = Date.parse(getAcademicClock(now).date)
  const targetMs = Date.parse(getAcademicClock(startDate).date)
  if (Number.isNaN(todayMs) || Number.isNaN(targetMs)) return null
  return Math.round((targetMs - todayMs) / 86_400_000)
}

export async function syncExamWidgetSnapshots(
  widgets: PluginWidgetService,
  exams: readonly Exam[],
  syncReminderHours = DEFAULT_EXAM_SYNC_REMINDER_HOURS
): Promise<void> {
  const built = buildExamWidgetSnapshot(exams)
  const snapshot: WidgetSnapshot = { exams: built.exams }
  const settings = { syncReminderHours }
  await Promise.allSettled(
    EXAM_WIDGET_IDS.map((widgetId) => widgets.update(widgetId, snapshot, settings))
  )
}

export async function clearExamWidgetSnapshots(widgets: PluginWidgetService): Promise<void> {
  await Promise.allSettled(EXAM_WIDGET_IDS.map((widgetId) => widgets.clear(widgetId)))
}

export interface ParameterizedExamQueryController {
  readonly source: ObservableSource<QuerySnapshot<Exam[]>>
  getTerm(): string
  setTerm(nextTerm: string): void
  refresh(): Promise<Exam[] | undefined>
  dispose(): void
}

export function createParameterizedExamQueryController(
  buildSource: (term: string) => ObservableSource<QuerySnapshot<Exam[]>>
): ParameterizedExamQueryController {
  let currentTerm = ""
  let currentSource = buildSource("")
  let detachCurrent: (() => void) | null = null
  let disposed = false
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of Array.from(listeners)) {
      listener()
    }
  }

  const rebind = (): void => {
    detachCurrent?.()
    detachCurrent = null
    if (!disposed && listeners.size > 0) {
      detachCurrent = currentSource.subscribe(notify)
    }
  }

  return {
    source: {
      getSnapshot: () => currentSource.getSnapshot(),
      subscribe: (listener) => {
        if (disposed) return () => {}
        const wasEmpty = listeners.size === 0
        listeners.add(listener)
        if (wasEmpty) {
          detachCurrent = currentSource.subscribe(notify)
        }
        let active = true
        return () => {
          if (!active) return
          active = false
          listeners.delete(listener)
          if (listeners.size === 0) {
            detachCurrent?.()
            detachCurrent = null
          }
        }
      },
    },
    getTerm: () => currentTerm,
    setTerm: (nextTerm) => {
      if (disposed || currentTerm === nextTerm) return
      currentTerm = nextTerm
      currentSource = buildSource(nextTerm)
      rebind()
      notify()
    },
    refresh: () => currentSource.getSnapshot().refresh(),
    dispose: () => {
      if (disposed) return
      disposed = true
      detachCurrent?.()
      detachCurrent = null
      listeners.clear()
    },
  }
}

/**
 * Wraps an unfiltered exam `ObservableSource` so cached hydrations and fresh
 * query resolutions automatically sync home-screen exam widgets when active.
 */
export function observeExamQueryForWidgets(
  rawSource: ObservableSource<QuerySnapshot<Exam[]>>,
  onSuccess: (exams: readonly Exam[]) => void
): ObservableSource<QuerySnapshot<Exam[]>> {
  let lastSyncedRef: readonly Exam[] | undefined

  const checkSnapshot = (snap: QuerySnapshot<Exam[]>): void => {
    if (snap.data !== undefined && snap.data !== lastSyncedRef) {
      lastSyncedRef = snap.data
      onSuccess(snap.data)
    }
  }

  return {
    getSnapshot: () => {
      const snap = rawSource.getSnapshot()
      checkSnapshot(snap)
      return snap
    },
    subscribe: (listener) => {
      const unsub = rawSource.subscribe(() => {
        checkSnapshot(rawSource.getSnapshot())
        listener()
      })
      checkSnapshot(rawSource.getSnapshot())
      return unsub
    },
  }
}
