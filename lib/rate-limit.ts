const STORAGE_KEY = "ysu-login-rate-limit";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const INTERVAL_MS = 60 * 1000; // 1 minute
const MAX_ATTEMPTS = 3;

interface RateLimitState {
  attempts: number[];
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  reason: "interval" | "window" | null;
}

function readState(): RateLimitState {
  if (typeof window === "undefined") return { attempts: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { attempts: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "attempts" in parsed &&
      Array.isArray((parsed as Record<string, unknown>).attempts)
    ) {
      return {
        attempts: (parsed as RateLimitState).attempts.filter(
          (a) => typeof a === "number",
        ),
      };
    }
  } catch {
    // ignore parse errors
  }
  return { attempts: [] };
}

function writeState(state: RateLimitState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function cleanOldAttempts(attempts: number[]): number[] {
  const cutoff = Date.now() - WINDOW_MS;
  return attempts.filter((t) => t > cutoff);
}

export function checkRateLimit(): RateLimitResult {
  const state = readState();
  const attempts = cleanOldAttempts(state.attempts);

  // Write back cleaned attempts
  writeState({ attempts });

  const now = Date.now();

  // Check window limit (3 per 15 min)
  if (attempts.length >= MAX_ATTEMPTS) {
    const retryAfterMs = attempts[0]! + WINDOW_MS - now;
    return {
      allowed: false,
      retryAfterMs: Math.max(0, retryAfterMs),
      reason: "window",
    };
  }

  // Check interval limit (1 min between attempts)
  if (attempts.length > 0) {
    const lastAttempt = attempts[attempts.length - 1]!;
    const elapsed = now - lastAttempt;
    if (elapsed < INTERVAL_MS) {
      return {
        allowed: false,
        retryAfterMs: INTERVAL_MS - elapsed,
        reason: "interval",
      };
    }
  }

  return { allowed: true, retryAfterMs: 0, reason: null };
}

export function recordLoginAttempt(): void {
  const state = readState();
  const attempts = cleanOldAttempts(state.attempts);
  attempts.push(Date.now());
  writeState({ attempts });
}

export function clearLoginAttempts(): void {
  writeState({ attempts: [] });
}

export function formatRetryDuration(ms: number): {
  minutes: number;
  seconds: number;
} {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return { minutes, seconds };
}
