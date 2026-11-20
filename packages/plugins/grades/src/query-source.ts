import type { QuerySnapshot } from "@orahako/academic-sdk"
import type { ObservableSource } from "@orahako/sdk"

export interface ParameterizedQueryController<P, T> {
  readonly source: ObservableSource<QuerySnapshot<T>>
  getParams(): P
  setParams(next: P): void
  refresh(): Promise<T | undefined>
  dispose(): void
}

/**
 * Pure reactive adapter switching between parameterized `ctx.query.source(...)`
 * handles without exposing raw `ObservableSource` or `useSyncExternalStore` to `.tsx`.
 */
export function createParameterizedQueryController<P, T>(
  initialParams: P,
  buildSource: (params: P) => ObservableSource<QuerySnapshot<T>>,
  equals: (left: P, right: P) => boolean = Object.is
): ParameterizedQueryController<P, T> {
  let currentParams = initialParams
  let currentSource = buildSource(initialParams)
  let detachCurrent: (() => void) | null = null
  let disposed = false
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of Array.from(listeners)) {
      listener()
    }
  }

  const rebindUpstream = (): void => {
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
    getParams: () => currentParams,
    setParams: (next) => {
      if (disposed || equals(currentParams, next)) return
      currentParams = next
      currentSource = buildSource(next)
      rebindUpstream()
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
