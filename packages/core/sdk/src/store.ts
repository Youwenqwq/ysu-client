import { createObservableSource, type ObservableSource } from "./observable"
import type { PluginStorageService } from "./services"

export interface StoreActionContext<S> {
  get(): S
  set(next: S | ((prev: S) => S)): void
  reset(): void
}

export type StoreActionsShape<S> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly [key: string]: (ctx: StoreActionContext<S>, ...args: any[]) => any
}

export type BoundActions<A> = {
  readonly [K in keyof A]: A[K] extends (
    ctx: StoreActionContext<infer _S>,
    ...args: infer P
  ) => infer R
    ? (...args: P) => R
    : never
}

export interface StorePersistConfig<S = unknown> {
  readonly key: string
  readonly mode?: "local" | "secure"
  readonly version?: number
  migrate?(persisted: unknown, version: number): S
}

export interface StoreSpec<S, A> {
  init(): S
  readonly persist?: StorePersistConfig<S>
  readonly actions: A
}

export interface StoreInstance<S, A> {
  readonly source: ObservableSource<S>
  readonly hydrated: ObservableSource<boolean>
  readonly actions: BoundActions<A>
  dispose(): void
}

export interface StoreDefinition<S, A> {
  readonly spec: StoreSpec<S, A>
  create(storage?: PluginStorageService): StoreInstance<S, A>
}

interface PersistedEnvelope {
  readonly version: number
  readonly state: unknown
}

function isPersistedEnvelope(value: unknown): value is PersistedEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "version" in value &&
    typeof value.version === "number" &&
    "state" in value
  )
}

function isUpdater<S>(next: S | ((prev: S) => S)): next is (prev: S) => S {
  return typeof next === "function"
}

function bindActions<S, A extends StoreActionsShape<S>>(
  rawActions: A,
  actionContext: StoreActionContext<S>
): BoundActions<A>
function bindActions<S>(
  rawActions: StoreActionsShape<S>,
  actionContext: StoreActionContext<S>
): object {
  const bound: Record<string, (...args: unknown[]) => unknown> = {}
  for (const [key, fn] of Object.entries(rawActions)) {
    bound[key] = (...args: unknown[]) => fn(actionContext, ...args)
  }
  return bound
}

/**
 * Defines a React-free snapshot store factory. Calling `defineStore(...)` never
 * instantiates a module-level singleton; plugin scopes call `.create(storage)`
 * so state and persistence follow the owning plugin lifecycle.
 */
export function defineStore<S, A extends StoreActionsShape<NoInfer<S>>>(
  spec: StoreSpec<S, A>
): StoreDefinition<S, A> {
  return {
    spec,
    create(storage?: PluginStorageService): StoreInstance<S, A> {
      const initial = spec.init()
      const stateSource = createObservableSource<S>(initial)
      const persistConfig = spec.persist
      const backend =
        persistConfig && storage
          ? persistConfig.mode === "secure"
            ? storage.secure
            : storage.local
          : undefined
      const hydratedSource = createObservableSource<boolean>(backend === undefined)

      let disposed = false
      let mutatedBeforeHydration = false
      let writeQueue: Promise<void> = Promise.resolve()

      const persistSnapshot = (snapshot: S): void => {
        if (!backend || !persistConfig || disposed) return
        const payload = JSON.stringify({
          version: persistConfig.version ?? 1,
          state: snapshot,
        })
        writeQueue = writeQueue
          .then(() => {
            if (disposed) return
            return backend.setItem(persistConfig.key, payload)
          })
          .catch(() => {
            // Persistence failures must not crash synchronous UI transitions.
          })
      }

      const actionContext: StoreActionContext<S> = {
        get: () => stateSource.getSnapshot(),
        set: (next) => {
          if (disposed) return
          const previous = stateSource.getSnapshot()
          const resolved = isUpdater(next) ? next(previous) : next
          if (Object.is(previous, resolved)) return
          if (!hydratedSource.getSnapshot()) {
            mutatedBeforeHydration = true
          }
          stateSource.set(resolved)
          persistSnapshot(resolved)
        },
        reset: () => {
          actionContext.set(spec.init())
        },
      }

      if (backend && persistConfig) {
        const expectedVersion = persistConfig.version ?? 1
        void backend
          .getItem(persistConfig.key)
          .then((raw) => {
            if (disposed || mutatedBeforeHydration || raw === null) return
            const parsed: unknown = JSON.parse(raw)
            if (!isPersistedEnvelope(parsed)) return
            if (parsed.version === expectedVersion) {
              stateSource.set(parsed.state as S)
            } else if (persistConfig.migrate) {
              const migrated = persistConfig.migrate(parsed.state, parsed.version)
              stateSource.set(migrated)
              persistSnapshot(migrated)
            }
          })
          .catch(() => {
            // Corrupt or unavailable persisted payloads fall back to init().
          })
          .finally(() => {
            if (!disposed) hydratedSource.set(true)
          })
      }

      const actions = bindActions(spec.actions, actionContext)

      return {
        source: {
          getSnapshot: stateSource.getSnapshot,
          subscribe: stateSource.subscribe,
        },
        hydrated: {
          getSnapshot: hydratedSource.getSnapshot,
          subscribe: hydratedSource.subscribe,
        },
        actions,
        dispose() {
          disposed = true
        },
      }
    },
  }
}
