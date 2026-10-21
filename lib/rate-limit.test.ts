import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkRateLimit, clearLoginAttempts, recordLoginAttempt } from "./rate-limit"
import { STORAGE_KEYS } from "./storage/keys"

const INTERVAL_MS = 60 * 1000
const WINDOW_MS = 15 * 60 * 1000
const NOW = Date.UTC(2026, 9, 17, 12)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  const storage = new Map<string, string>()
  vi.stubGlobal("window", {})
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("persisted password login rate limit", () => {
  it("allows another attempt exactly 60 seconds after the previous one", () => {
    expect(checkRateLimit()).toEqual({ allowed: true, retryAfterMs: 0, reason: null })
    recordLoginAttempt()
    expect(checkRateLimit()).toEqual({
      allowed: false, retryAfterMs: INTERVAL_MS, reason: "interval",
    })
    vi.setSystemTime(NOW + INTERVAL_MS - 1)
    expect(checkRateLimit()).toEqual({ allowed: false, retryAfterMs: 1, reason: "interval" })
    vi.setSystemTime(NOW + INTERVAL_MS)
    expect(checkRateLimit()).toEqual({ allowed: true, retryAfterMs: 0, reason: null })
    recordLoginAttempt()
    expect(checkRateLimit()).toEqual({
      allowed: false, retryAfterMs: INTERVAL_MS, reason: "interval",
    })
  })

  it("permits three attempts per rolling window and expires each attempt at its boundary", () => {
    recordLoginAttempt()
    vi.setSystemTime(NOW + INTERVAL_MS)
    expect(checkRateLimit().allowed).toBe(true)
    recordLoginAttempt()
    vi.setSystemTime(NOW + 2 * INTERVAL_MS)
    expect(checkRateLimit().allowed).toBe(true)
    recordLoginAttempt()
    expect(checkRateLimit()).toEqual({
      allowed: false, retryAfterMs: WINDOW_MS - 2 * INTERVAL_MS, reason: "window",
    })
    vi.setSystemTime(NOW + WINDOW_MS - 1)
    expect(checkRateLimit()).toEqual({ allowed: false, retryAfterMs: 1, reason: "window" })
    vi.setSystemTime(NOW + WINDOW_MS)
    expect(checkRateLimit()).toEqual({ allowed: true, retryAfterMs: 0, reason: null })
    recordLoginAttempt()
    expect(checkRateLimit()).toEqual({
      allowed: false, retryAfterMs: INTERVAL_MS, reason: "window",
    })
    vi.setSystemTime(NOW + WINDOW_MS + INTERVAL_MS)
    expect(checkRateLimit()).toEqual({ allowed: true, retryAfterMs: 0, reason: null })
  })

  it("migrates legacy attempt arrays without discarding their remaining interval", () => {
    localStorage.setItem(STORAGE_KEYS.legacyLoginRateLimit, JSON.stringify({
      attempts: [NOW - WINDOW_MS, NOW - 30_000, "invalid", null],
    }))
    expect(checkRateLimit()).toEqual({
      allowed: false, retryAfterMs: 30_000, reason: "interval",
    })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.loginRateLimit)!)).toEqual({
      attempts: [NOW - 30_000],
    })
    expect(localStorage.getItem(STORAGE_KEYS.legacyLoginRateLimit)).toBeNull()
  })

  it.each([STORAGE_KEYS.loginRateLimit, STORAGE_KEYS.legacyLoginRateLimit])(
    "drops obsolete lastAttemptAt-only state stored under %s",
    (key) => {
      localStorage.setItem(key, JSON.stringify({ lastAttemptAt: NOW }))
      expect(checkRateLimit()).toEqual({ allowed: true, retryAfterMs: 0, reason: null })
      recordLoginAttempt()
      expect(checkRateLimit()).toEqual({
        allowed: false, retryAfterMs: INTERVAL_MS, reason: "interval",
      })
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.loginRateLimit)!)).toEqual({
        attempts: [NOW],
      })
      expect(localStorage.getItem(STORAGE_KEYS.legacyLoginRateLimit)).toBeNull()
    }
  )

  it("retains attempts across module reloads, without requiring Web Locks", async () => {
    vi.stubGlobal("navigator", {})
    recordLoginAttempt()
    vi.setSystemTime(NOW + 40_000)
    vi.resetModules()
    // Static imports cannot exercise reopening the module after clearing its cache.
    const reopened = await import("./rate-limit")
    expect(reopened.checkRateLimit()).toEqual({
      allowed: false, retryAfterMs: 20_000, reason: "interval",
    })
    vi.setSystemTime(NOW + INTERVAL_MS)
    expect(reopened.checkRateLimit().allowed).toBe(true)
    reopened.recordLoginAttempt()
    expect(reopened.checkRateLimit().reason).toBe("interval")
  })

  it("clears the full rolling attempt history", () => {
    recordLoginAttempt()
    vi.setSystemTime(NOW + INTERVAL_MS)
    recordLoginAttempt()
    vi.setSystemTime(NOW + 2 * INTERVAL_MS)
    recordLoginAttempt()
    expect(checkRateLimit().reason).toBe("window")
    clearLoginAttempts()
    expect(checkRateLimit()).toEqual({ allowed: true, retryAfterMs: 0, reason: null })
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.loginRateLimit)!)).toEqual({
      attempts: [],
    })
  })
})
