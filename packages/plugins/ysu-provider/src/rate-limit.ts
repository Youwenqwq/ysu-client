import type { PluginKeyValueStorage } from "@orahako/sdk"
import { isPlainRecord } from "./http-utils"

const RATE_LIMIT_KEY = "login-rate-limit"
const WINDOW_MS = 15 * 60 * 1000
const INTERVAL_MS = 60 * 1000
const MAX_ATTEMPTS = 3

export interface RateLimitResult {
  readonly allowed: boolean
  readonly retryAfterMs: number
  readonly reason: "interval" | "window" | null
}

async function readAttempts(storage: PluginKeyValueStorage): Promise<number[]> {
  try {
    const raw = await storage.getItem(RATE_LIMIT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (isPlainRecord(parsed) && Array.isArray(parsed.attempts)) {
      return parsed.attempts.filter(
        (entry): entry is number => typeof entry === "number" && Number.isFinite(entry)
      )
    }
  } catch {
    // Corrupt rate-limit state falls back to clean window.
  }
  return []
}

async function writeAttempts(
  storage: PluginKeyValueStorage,
  attempts: readonly number[]
): Promise<void> {
  try {
    await storage.setItem(RATE_LIMIT_KEY, JSON.stringify({ attempts }))
  } catch {
    // Storage failures must not block login attempts.
  }
}

function cleanOldAttempts(attempts: readonly number[], now: number): number[] {
  const cutoff = now - WINDOW_MS
  return attempts.filter((timestamp) => timestamp > cutoff)
}

export async function checkRateLimit(storage: PluginKeyValueStorage): Promise<RateLimitResult> {
  const now = Date.now()
  const raw = await readAttempts(storage)
  const attempts = cleanOldAttempts(raw, now)
  if (attempts.length !== raw.length) {
    await writeAttempts(storage, attempts)
  }

  if (attempts.length >= MAX_ATTEMPTS) {
    const retryAfterMs = attempts[0]! + WINDOW_MS - now
    return {
      allowed: false,
      retryAfterMs: Math.max(0, retryAfterMs),
      reason: "window",
    }
  }

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

export async function recordLoginAttempt(storage: PluginKeyValueStorage): Promise<void> {
  const now = Date.now()
  const attempts = cleanOldAttempts(await readAttempts(storage), now)
  attempts.push(now)
  await writeAttempts(storage, attempts)
}

export async function clearLoginAttempts(storage: PluginKeyValueStorage): Promise<void> {
  await writeAttempts(storage, [])
}
