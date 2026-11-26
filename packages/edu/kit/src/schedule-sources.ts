import type { QuerySnapshot } from "@orahako/academic-sdk"
import type { ObservableSource } from "@orahako/sdk"

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

/**
 * React-free dynamic multiplexer binding an `ObservableSource` state slice to a
 * parameterized `QueryService.source(...)` handle. Only activates the underlying
 * query when `resolveSource` returns a non-null source AND at least one subscriber
 * is attached.
 */
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
    for (const listener of [...subscribers]) listener()
  }

  const releaseActive = (): void => {
    unsubscribeInner?.()
    unsubscribeInner = null
    activeInner = null
    activeKeySerialized = null
  }

  const rebind = (shouldNotify: boolean): void => {
    const key = options.selectKey(options.state.getSnapshot())
    const serialized = options.serializeKey(key)
    if (serialized === activeKeySerialized) return

    releaseActive()
    activeKeySerialized = serialized
    activeInner = options.resolveSource(key)
    if (shouldNotify && activeInner) unsubscribeInner = activeInner.subscribe(notify)
    if (shouldNotify) notify()
  }

  return {
    getSnapshot(): QuerySnapshot<T> {
      if (subscribers.size === 0) rebind(false)
      return activeInner ? activeInner.getSnapshot() : idleSnapshot
    },
    subscribe(listener: () => void): () => void {
      const wasEmpty = subscribers.size === 0
      subscribers.add(listener)
      if (wasEmpty) {
        rebind(false)
        unsubscribeInner = activeInner?.subscribe(notify) ?? null
        unsubscribeState = options.state.subscribe(() => rebind(true))
      }
      let subscribed = true
      return () => {
        if (!subscribed) return
        subscribed = false
        subscribers.delete(listener)
        if (subscribers.size === 0) {
          unsubscribeState?.()
          unsubscribeState = null
          releaseActive()
        }
      }
    },
  }
}

/**
 * Minute-granularity wall-clock observable source, automatically starting when
 * subscribed and stopping when all subscribers detach or `dispose()` is called.
 */
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
