export interface ObservableSource<S> {
  getSnapshot(): S
  subscribe(listener: () => void): () => void
}

export interface MutableObservableSource<S> extends ObservableSource<S> {
  set(next: S | ((prev: S) => S)): void
}

function isUpdater<S>(next: S | ((prev: S) => S)): next is (prev: S) => S {
  return typeof next === "function"
}

/**
 * Creates a React-free observable value source with referentially stable
 * `getSnapshot` and `subscribe` methods suitable for `useSyncExternalStore`.
 */
export function createObservableSource<S>(
  initial: S,
  isEqual: (a: S, b: S) => boolean = Object.is
): MutableObservableSource<S> {
  let current = initial
  const listeners = new Set<() => void>()

  const getSnapshot = (): S => current

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  const set = (next: S | ((prev: S) => S)): void => {
    const resolved = isUpdater(next) ? next(current) : next
    if (isEqual(current, resolved)) return
    current = resolved
    for (const listener of Array.from(listeners)) {
      listener()
    }
  }

  return {
    getSnapshot,
    subscribe,
    set,
  }
}
