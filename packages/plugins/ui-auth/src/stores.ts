import { defineStore, type PluginStorageService, type StoreInstance } from "@orahako/sdk"

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
export const RATE_LIMIT_INTERVAL_MS = 60 * 1000
export const RATE_LIMIT_MAX_ATTEMPTS = 3

export interface LoginRateLimitState {
  readonly attempts: readonly number[]
}

export interface RateLimitResult {
  readonly allowed: boolean
  readonly retryAfterMs: number
  readonly reason: "interval" | "window" | null
}

function cleanOldAttempts(attempts: readonly number[], now: number): number[] {
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  return attempts.filter((ts) => typeof ts === "number" && Number.isFinite(ts) && ts > cutoff)
}

export const loginRateLimitStore = defineStore({
  init: (): LoginRateLimitState => ({
    attempts: [],
  }),
  persist: {
    key: "login-rate-limit",
    mode: "local",
    version: 1,
  },
  actions: {
    setAttempts(ctx, attempts: readonly number[]) {
      ctx.set({ attempts: [...attempts] })
    },
    record(ctx, now = Date.now()) {
      const cleaned = cleanOldAttempts(ctx.get().attempts, now)
      cleaned.push(now)
      ctx.set({ attempts: cleaned })
    },
    clear(ctx) {
      ctx.set({ attempts: [] })
    },
  },
})

export interface ScopedLoginRateLimiter {
  readonly store: StoreInstance<LoginRateLimitState, typeof loginRateLimitStore.spec.actions>
  checkRateLimit(now?: number): RateLimitResult
  recordLoginAttempt(now?: number): void
  clearLoginAttempts(): void
  dispose(): void
}

export function createLoginRateLimiter(storage?: PluginStorageService): ScopedLoginRateLimiter {
  const store = loginRateLimitStore.create(storage)

  const checkRateLimit = (now = Date.now()): RateLimitResult => {
    const rawAttempts = store.source.getSnapshot().attempts
    const attempts = cleanOldAttempts(rawAttempts, now)
    if (attempts.length !== rawAttempts.length) {
      store.actions.setAttempts(attempts)
    }

    if (attempts.length >= RATE_LIMIT_MAX_ATTEMPTS) {
      const retryAfterMs = attempts[0]! + RATE_LIMIT_WINDOW_MS - now
      return {
        allowed: false,
        retryAfterMs: Math.max(0, retryAfterMs),
        reason: "window",
      }
    }

    if (attempts.length > 0) {
      const lastAttempt = attempts[attempts.length - 1]!
      const elapsed = now - lastAttempt
      if (elapsed < RATE_LIMIT_INTERVAL_MS) {
        return {
          allowed: false,
          retryAfterMs: RATE_LIMIT_INTERVAL_MS - elapsed,
          reason: "interval",
        }
      }
    }

    return { allowed: true, retryAfterMs: 0, reason: null }
  }

  return {
    store,
    checkRateLimit,
    recordLoginAttempt: (now = Date.now()) => {
      store.actions.record(now)
    },
    clearLoginAttempts: () => {
      store.actions.clear()
    },
    dispose: () => {
      store.dispose()
    },
  }
}

export function formatRetryDuration(ms: number): {
  readonly minutes: number
  readonly seconds: number
} {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return { minutes, seconds }
}

export function formatRateLimitMessage<K extends string>(
  limit: RateLimitResult,
  t: (key: K, params?: Readonly<Record<string, string | number>>) => string,
  windowKey: K,
  intervalKey: K
): string {
  const { minutes, seconds } = formatRetryDuration(limit.retryAfterMs)
  if (limit.reason === "window") {
    return t(windowKey, {
      minutes,
      seconds: seconds.toString().padStart(2, "0"),
    })
  }
  return t(intervalKey, { seconds })
}

/** Session artifacts read by provider quick re-login; keep in sync with provider plugins. */
export const REMEMBERED_USERNAME_ARTIFACT = "remembered-username"
export const REMEMBERED_PASSWORD_ARTIFACT = "remembered-password"

export interface RememberedCredentialEntry {
  readonly username: string
  readonly password: string
}

export interface RememberedCredentialsState {
  readonly bySchool: Readonly<Record<string, RememberedCredentialEntry>>
}

export const rememberedCredentialsStore = defineStore({
  init: (): RememberedCredentialsState => ({
    bySchool: {},
  }),
  persist: {
    key: "remembered-credentials",
    mode: "secure",
    version: 1,
  },
  actions: {
    save(ctx, schoolId: string, entry: RememberedCredentialEntry) {
      if (!schoolId) return
      ctx.set((prev) => ({
        bySchool: {
          ...prev.bySchool,
          [schoolId]: entry,
        },
      }))
    },
    remove(ctx, schoolId: string) {
      if (!schoolId) return
      ctx.set((prev) => {
        if (!(schoolId in prev.bySchool)) return prev
        const next = { ...prev.bySchool }
        delete next[schoolId]
        return { bySchool: next }
      })
    },
  },
})

export type RememberedCredentialsStoreInstance = StoreInstance<
  RememberedCredentialsState,
  typeof rememberedCredentialsStore.spec.actions
>
