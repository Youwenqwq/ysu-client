import type { MakeupExamCourse, QuerySnapshot } from "@orahako/academic-sdk"
import type { ObservableSource } from "@orahako/sdk"

export interface MakeupCourseFilter {
  readonly batchId: string | undefined
  readonly registered: boolean
}

export interface MakeupCourseQueryController {
  readonly source: ObservableSource<QuerySnapshot<MakeupExamCourse[]>>
  getFilter(): MakeupCourseFilter
  setFilter(next: MakeupCourseFilter): void
  refresh(): Promise<MakeupExamCourse[] | undefined>
  dispose(): void
}

function sameFilter(left: MakeupCourseFilter, right: MakeupCourseFilter): boolean {
  return left.batchId === right.batchId && left.registered === right.registered
}

export function createMakeupCourseQueryController(
  buildSource: (filter: MakeupCourseFilter) => ObservableSource<QuerySnapshot<MakeupExamCourse[]>>
): MakeupCourseQueryController {
  let currentFilter: MakeupCourseFilter = { batchId: undefined, registered: false }
  let currentSource = buildSource(currentFilter)
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
    getFilter: () => currentFilter,
    setFilter: (next) => {
      if (disposed || sameFilter(currentFilter, next)) return
      currentFilter = next
      currentSource = buildSource(next)
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
