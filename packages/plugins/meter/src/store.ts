import { createObservableSource, defineStore, type ObservableSource } from "@orahako/sdk"
import { fetchMeterData, MeterError, type MeterData, type MeterHttp } from "./client"

const MAX_ROOM_HISTORY = 10

export interface MeterRoomHistoryItem {
  readonly account: string
  readonly roomFullName: string
  readonly roomverify: string
  readonly accountNum: string
  readonly updatedAt: number
}

export interface MeterRoomStoreState {
  readonly selectedAccount: string
  readonly history: readonly MeterRoomHistoryItem[]
}

export const meterRoomStore = defineStore({
  init: (): MeterRoomStoreState => ({
    selectedAccount: "",
    history: [],
  }),
  persist: {
    key: "meter-rooms",
    mode: "local",
    version: 1,
  },
  actions: {
    selectAccount(ctx, account: string) {
      const trimmed = account.trim()
      ctx.set((prev) =>
        prev.selectedAccount === trimmed ? prev : { ...prev, selectedAccount: trimmed }
      )
    },
    saveRoom(ctx, item: MeterRoomHistoryItem) {
      const trimmedAccount = item.account.trim()
      if (!trimmedAccount) return
      const normalized: MeterRoomHistoryItem = {
        ...item,
        account: trimmedAccount,
      }
      ctx.set((prev) => {
        const filtered = prev.history.filter((entry) => entry.account !== trimmedAccount)
        return {
          selectedAccount: trimmedAccount,
          history: [normalized, ...filtered].slice(0, MAX_ROOM_HISTORY),
        }
      })
    },
    removeRoom(ctx, account: string) {
      const trimmed = account.trim()
      ctx.set((prev) => {
        const nextHistory = prev.history.filter((entry) => entry.account !== trimmed)
        const nextSelected =
          prev.selectedAccount === trimmed ? (nextHistory[0]?.account ?? "") : prev.selectedAccount
        return {
          selectedAccount: nextSelected,
          history: nextHistory,
        }
      })
    },
    clearHistory(ctx) {
      ctx.set({
        selectedAccount: "",
        history: [],
      })
    },
  },
})

export type MeterRoomStoreInstance = ReturnType<typeof meterRoomStore.create>

export type MeterQueryFailure =
  | { readonly kind: "not_bound" }
  | { readonly kind: "failed"; readonly message: string }

export interface MeterQuerySnapshot {
  readonly account: string | null
  readonly data: MeterData | null
  readonly error: MeterQueryFailure | null
  readonly refreshError: MeterQueryFailure | null
  readonly refreshErrorSeq: number
  readonly isLoading: boolean
  readonly updatedAt: number | null
}

export interface SessionAccountSnapshot {
  readonly hasHydrated: boolean
  readonly username: string | null
}

const INITIAL_QUERY_SNAPSHOT: MeterQuerySnapshot = {
  account: null,
  data: null,
  error: null,
  refreshError: null,
  refreshErrorSeq: 0,
  isLoading: false,
  updatedAt: null,
}

function classifyMeterError(err: unknown): MeterQueryFailure {
  if (err instanceof MeterError && err.message === "NOT_BOUND") {
    return { kind: "not_bound" }
  }
  return {
    kind: "failed",
    message: err instanceof Error ? err.message : String(err),
  }
}

export interface MeterControllerOptions {
  readonly roomStore: MeterRoomStoreInstance
  readonly http: MeterHttp
  readonly getSessionAccount?: () => SessionAccountSnapshot
  readonly subscribeSession?: (listener: () => void) => () => void
  readonly now?: () => number
}

export interface MeterController {
  readonly query: ObservableSource<MeterQuerySnapshot>
  resolveEffectiveAccount(): string
  queryAccount(account: string): Promise<void>
  refresh(): Promise<void>
  dispose(): void
}

export function createMeterController(options: MeterControllerOptions): MeterController {
  const { roomStore, http, getSessionAccount, subscribeSession, now = Date.now } = options
  const querySource = createObservableSource<MeterQuerySnapshot>(INITIAL_QUERY_SNAPSHOT)

  let disposed = false
  let requestSeq = 0
  let errorSeq = 0
  let activeAccount: string | null = null

  const resolveEffectiveAccount = (): string => {
    const selected = roomStore.source.getSnapshot().selectedAccount.trim()
    if (selected) return selected
    const fallback = getSessionAccount?.().username?.trim() ?? ""
    return fallback
  }

  const runFetch = async (targetAccount: string, retainExistingData: boolean): Promise<void> => {
    const trimmed = targetAccount.trim()
    if (disposed || !trimmed) {
      if (!trimmed && !disposed) {
        activeAccount = null
        requestSeq += 1
        querySource.set(INITIAL_QUERY_SNAPSHOT)
      }
      return
    }

    const seq = ++requestSeq
    activeAccount = trimmed
    const previous = querySource.getSnapshot()
    const keepData = retainExistingData && previous.account === trimmed && previous.data !== null

    querySource.set({
      account: trimmed,
      data: keepData ? previous.data : null,
      error: null,
      refreshError: null,
      refreshErrorSeq: previous.refreshErrorSeq,
      isLoading: true,
      updatedAt: keepData ? previous.updatedAt : null,
    })

    try {
      const data = await fetchMeterData(trimmed, http)
      if (disposed || seq !== requestSeq) return
      const timestamp = now()
      roomStore.actions.saveRoom({
        account: trimmed,
        roomFullName: data.overview?.roomFullName || data.room.roomFullName,
        roomverify: data.room.roomverify,
        accountNum: data.room.accountNum,
        updatedAt: timestamp,
      })
      querySource.set({
        account: trimmed,
        data,
        error: null,
        refreshError: null,
        refreshErrorSeq: errorSeq,
        isLoading: false,
        updatedAt: timestamp,
      })
    } catch (err) {
      if (disposed || seq !== requestSeq) return
      const failure = classifyMeterError(err)
      if (keepData) {
        errorSeq += 1
        querySource.set({
          account: trimmed,
          data: previous.data,
          error: null,
          refreshError: failure,
          refreshErrorSeq: errorSeq,
          isLoading: false,
          updatedAt: previous.updatedAt,
        })
      } else {
        querySource.set({
          account: trimmed,
          data: null,
          error: failure,
          refreshError: null,
          refreshErrorSeq: errorSeq,
          isLoading: false,
          updatedAt: null,
        })
      }
    }
  }

  const syncAutoAccount = (): void => {
    if (disposed) return
    if (!roomStore.hydrated.getSnapshot()) return
    const sessionSnap = getSessionAccount?.()
    if (
      !roomStore.source.getSnapshot().selectedAccount.trim() &&
      sessionSnap &&
      !sessionSnap.hasHydrated
    ) {
      return
    }
    const nextAccount = resolveEffectiveAccount()
    if (!nextAccount) {
      if (activeAccount !== null) {
        activeAccount = null
        requestSeq += 1
        querySource.set(INITIAL_QUERY_SNAPSHOT)
      }
      return
    }
    if (nextAccount !== activeAccount) {
      void runFetch(nextAccount, false)
    }
  }

  const unsubStore = roomStore.source.subscribe(syncAutoAccount)
  const unsubHydrated = roomStore.hydrated.subscribe(syncAutoAccount)
  const unsubSession = subscribeSession ? subscribeSession(syncAutoAccount) : undefined
  syncAutoAccount()

  return {
    query: {
      getSnapshot: querySource.getSnapshot,
      subscribe: querySource.subscribe,
    },
    resolveEffectiveAccount,
    async queryAccount(account: string): Promise<void> {
      const trimmed = account.trim()
      if (!trimmed || disposed) return
      roomStore.actions.selectAccount(trimmed)
      await runFetch(trimmed, false)
    },
    async refresh(): Promise<void> {
      const target = resolveEffectiveAccount()
      if (!target || disposed) return
      await runFetch(target, true)
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      requestSeq += 1
      unsubStore()
      unsubHydrated()
      unsubSession?.()
    },
  }
}
