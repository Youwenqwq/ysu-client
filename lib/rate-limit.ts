import { getLocalStorageItemWithFallback, STORAGE_KEYS } from "./storage/keys"

const STORAGE_KEY = STORAGE_KEYS.loginRateLimit
const LEGACY_STORAGE_KEY = STORAGE_KEYS.legacyLoginRateLimit

const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const INTERVAL_MS = 60 * 1000 // 1 minute
const MAX_ATTEMPTS = 3

interface RateLimitState {
  attempts: number[]
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterMs: number
  reason: "interval" | "window" | null
}

function readState(): RateLimitState {
  if (typeof window === "undefined") return { attempts: [] }
  try {
    const raw = getLocalStorageItemWithFallback(STORAGE_KEY, LEGACY_STORAGE_KEY)
    if (!raw) return { attempts: [] }
    const parsed = JSON.parse(raw) as unknown
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "attempts" in parsed &&
      Array.isArray((parsed as Record<string, unknown>).attempts)
    ) {
      return {
        attempts: (parsed as RateLimitState).attempts.filter((a) => typeof a === "number"),
      }
    }
  } catch {
    // ignore parse errors
  }
  return { attempts: [] }
}

function writeState(state: RateLimitState): void {
  if (typeof window === "undefined") return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

function cleanOldAttempts(attempts: number[]): number[] {
  const cutoff = Date.now() - WINDOW_MS
  return attempts.filter((t) => t > cutoff)
}

export function checkRateLimit(): RateLimitResult {
  const state = readState()
  const attempts = cleanOldAttempts(state.attempts)

  // Write back cleaned attempts
  writeState({ attempts })

  const now = Date.now()

  // Check window limit (3 per 15 min)
  if (attempts.length >= MAX_ATTEMPTS) {
    const retryAfterMs = attempts[0]! + WINDOW_MS - now
    return {
      allowed: false,
      retryAfterMs: Math.max(0, retryAfterMs),
      reason: "window",
    }
  }

  // Check interval limit (1 min between attempts)
  if (attempts.length > 0) {
    const lastAttempt = attempts[attempts.length - 1]!
    const elapsed = now - lastAttempt
    if (elapsed < INTERVAL_MS) {
      return {
        allowed: false,
        retryAfterMs: INTERVAL_MS - elapsed,
        reason: "interval",
      }
    }
  }

  return { allowed: true, retryAfterMs: 0, reason: null }
}

export function recordLoginAttempt(): void {
  const state = readState()
  const attempts = cleanOldAttempts(state.attempts)
  attempts.push(Date.now())
  writeState({ attempts })
}

export function clearLoginAttempts(): void {
  writeState({ attempts: [] })
}

export function formatRetryDuration(ms: number): {
  minutes: number
  seconds: number
} {
  const totalSeconds = Math.ceil(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return { minutes, seconds }
}

/**
 * 格式化限流错误消息（登录与重新登录共用）。
 * window 档的秒数补零对齐 mm:ss 展示，interval 档不补零——保持既有文案行为。
 */
export function rateLimitMessage(
  limit: RateLimitResult,
  t: (key: string, params?: Record<string, string | number>) => string,
  windowKey: string,
  intervalKey: string
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
