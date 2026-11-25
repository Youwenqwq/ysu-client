import type { ClassroomInfo, Course } from "@orahako/academic-sdk"
import {
  createObservableSource,
  type ObservableSource,
  type PluginKeyValueStorage,
} from "@orahako/sdk"

const CACHE_STORAGE_KEY = "free-rooms-building-cache"
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_CACHED_BUILDINGS = 8
const SCAN_CONCURRENCY = 5

export type BuildingScanStatus = "idle" | "scanning" | "ready" | "error"

export interface BuildingScanState {
  readonly scopeKey: string | null
  readonly status: BuildingScanStatus
  readonly loaded: number
  readonly total: number
  readonly failed: number
  readonly failedCodes: readonly string[]
  readonly updatedAt: number | null
  readonly schedulesByRoom: Readonly<Record<string, readonly Course[]>>
  readonly errorMessage: string | null
}

interface PersistedBuildingEntry {
  readonly updatedAt: number
  readonly schedulesByRoom: Readonly<Record<string, readonly Course[]>>
}

interface PersistedCachePayload {
  readonly version: 1
  readonly entries: Readonly<Record<string, PersistedBuildingEntry>>
}

const INITIAL_SCAN_STATE: BuildingScanState = {
  scopeKey: null,
  status: "idle",
  loaded: 0,
  total: 0,
  failed: 0,
  failedCodes: [],
  updatedAt: null,
  schedulesByRoom: {},
  errorMessage: null,
}

function parsePersistedCache(raw: string | null): Record<string, PersistedBuildingEntry> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      (parsed as { version: unknown }).version === 1 &&
      "entries" in parsed &&
      typeof (parsed as { entries: unknown }).entries === "object" &&
      (parsed as { entries: unknown }).entries !== null
    ) {
      return { ...(parsed as PersistedCachePayload).entries }
    }
  } catch {
    // Corrupted cache entry — fall back to fresh scan.
  }
  return {}
}

export class BuildingScheduleScanner {
  private readonly storage: PluginKeyValueStorage
  private readonly stateSource = createObservableSource<BuildingScanState>(INITIAL_SCAN_STATE)
  private readonly memoryCache = new Map<string, PersistedBuildingEntry>()
  private generation = 0
  private disposed = false
  private persistedLoaded = false

  readonly state: ObservableSource<BuildingScanState> = this.stateSource

  constructor(storage: PluginKeyValueStorage) {
    this.storage = storage
  }

  getSnapshot(): BuildingScanState {
    return this.stateSource.getSnapshot()
  }

  reset(): void {
    this.generation += 1
    this.stateSource.set(INITIAL_SCAN_STATE)
  }

  dispose(): void {
    this.disposed = true
    this.generation += 1
  }

  private async ensureHydrated(): Promise<void> {
    if (this.persistedLoaded) return
    this.persistedLoaded = true
    try {
      const raw = await this.storage.getItem(CACHE_STORAGE_KEY)
      const entries = parsePersistedCache(raw)
      const now = Date.now()
      for (const [key, entry] of Object.entries(entries)) {
        if (
          entry &&
          typeof entry.updatedAt === "number" &&
          now - entry.updatedAt <= CACHE_TTL_MS &&
          typeof entry.schedulesByRoom === "object" &&
          entry.schedulesByRoom !== null
        ) {
          this.memoryCache.set(key, entry)
        }
      }
    } catch {
      // Ignore storage read errors and proceed with live scan.
    }
  }

  private async persistCache(): Promise<void> {
    const sorted = Array.from(this.memoryCache.entries())
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_CACHED_BUILDINGS)
    this.memoryCache.clear()
    const entries: Record<string, PersistedBuildingEntry> = {}
    for (const [key, entry] of sorted) {
      this.memoryCache.set(key, entry)
      entries[key] = entry
    }
    const payload: PersistedCachePayload = { version: 1, entries }
    try {
      await this.storage.setItem(CACHE_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // Ignore quota errors so scanning still succeeds in memory.
    }
  }

  async scanBuilding(options: {
    readonly scopeKey: string
    readonly rooms: readonly ClassroomInfo[]
    readonly fetchRoomSchedule: (code: string) => Promise<Course[]>
    readonly forceRefresh?: boolean
    readonly concurrency?: number
  }): Promise<void> {
    if (this.disposed) return
    const currentGen = ++this.generation
    const { scopeKey, rooms, fetchRoomSchedule, forceRefresh = false } = options
    const concurrency = Math.max(1, options.concurrency ?? SCAN_CONCURRENCY)

    if (rooms.length === 0) {
      this.stateSource.set({
        scopeKey,
        status: "ready",
        loaded: 0,
        total: 0,
        failed: 0,
        failedCodes: [],
        updatedAt: Date.now(),
        schedulesByRoom: {},
        errorMessage: null,
      })
      return
    }

    await this.ensureHydrated()
    if (this.disposed || currentGen !== this.generation) return

    const now = Date.now()
    const cached = !forceRefresh ? this.memoryCache.get(scopeKey) : undefined
    if (cached && now - cached.updatedAt <= CACHE_TTL_MS) {
      const hasAllRooms = rooms.every(
        (room) => room.isScheduled === false || cached.schedulesByRoom[room.code] !== undefined
      )
      if (hasAllRooms) {
        const schedulesByRoom: Record<string, readonly Course[]> = {}
        for (const room of rooms) {
          schedulesByRoom[room.code] = cached.schedulesByRoom[room.code] ?? []
        }
        this.stateSource.set({
          scopeKey,
          status: "ready",
          loaded: rooms.length,
          total: rooms.length,
          failed: 0,
          failedCodes: [],
          updatedAt: cached.updatedAt,
          schedulesByRoom,
          errorMessage: null,
        })
        return
      }
    }

    const schedulesByRoom: Record<string, readonly Course[]> = {}
    const toFetch: ClassroomInfo[] = []
    for (const room of rooms) {
      if (room.isScheduled === false) {
        schedulesByRoom[room.code] = []
      } else if (!forceRefresh && cached && cached.schedulesByRoom[room.code] !== undefined) {
        schedulesByRoom[room.code] = cached.schedulesByRoom[room.code]!
      } else {
        toFetch.push(room)
      }
    }

    let loaded = rooms.length - toFetch.length
    const failedCodes: string[] = []

    const publish = (
      status: BuildingScanStatus,
      updatedAt: number | null,
      errorMessage: string | null
    ) => {
      if (this.disposed || currentGen !== this.generation) return
      this.stateSource.set({
        scopeKey,
        status,
        loaded,
        total: rooms.length,
        failed: failedCodes.length,
        failedCodes: [...failedCodes],
        updatedAt,
        schedulesByRoom: { ...schedulesByRoom },
        errorMessage,
      })
    }

    if (toFetch.length === 0) {
      const updatedAt = cached?.updatedAt ?? Date.now()
      publish("ready", updatedAt, null)
      return
    }

    publish("scanning", cached?.updatedAt ?? null, null)

    let cursor = 0
    let firstError: string | null = null

    const runWorker = async (): Promise<void> => {
      while (!this.disposed && currentGen === this.generation) {
        const idx = cursor++
        if (idx >= toFetch.length) return
        const room = toFetch[idx]!
        try {
          const courses = await fetchRoomSchedule(room.code)
          if (this.disposed || currentGen !== this.generation) return
          schedulesByRoom[room.code] = courses
        } catch (error) {
          if (this.disposed || currentGen !== this.generation) return
          failedCodes.push(room.code)
          if (firstError === null) {
            firstError = error instanceof Error ? error.message : String(error)
          }
        }
        loaded += 1
        publish("scanning", null, null)
      }
    }

    const workerCount = Math.min(concurrency, toFetch.length)
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()))
    if (this.disposed || currentGen !== this.generation) return

    const completedAt = Date.now()
    const allFailed =
      failedCodes.length === toFetch.length && Object.keys(schedulesByRoom).length === 0
    if (!allFailed) {
      this.memoryCache.set(scopeKey, {
        updatedAt: completedAt,
        schedulesByRoom: { ...schedulesByRoom },
      })
      await this.persistCache()
    }

    publish(
      allFailed ? "error" : "ready",
      allFailed ? null : completedAt,
      allFailed ? firstError : null
    )
  }
}
