const RECOVERY_KEY = "orahako-plugin-recovery"

export interface PluginRecoveryState {
  phase: "starting" | "ready"
  build: string
  crashStreak: number
  safeMode: boolean
  lastStartedPluginId?: string
}

export function nextPluginBootState(
  previous: PluginRecoveryState | undefined,
  build: string
): PluginRecoveryState {
  const repeatedCrash = previous?.phase === "starting" && previous.build === build
  const crashStreak = repeatedCrash ? previous.crashStreak + 1 : 0
  return {
    phase: "starting",
    build,
    crashStreak,
    safeMode: crashStreak >= 2,
  }
}

export function beginPluginBoot(build: string): PluginRecoveryState {
  const state = nextPluginBootState(readRecoveryState(), build)
  writeRecoveryState(state)
  return state
}

export function markPluginStarted(id: string): void {
  const state = readRecoveryState()
  if (!state) return
  writeRecoveryState({ ...state, lastStartedPluginId: id })
}

export function finishPluginBoot(): void {
  const state = readRecoveryState()
  if (!state) return
  writeRecoveryState({
    phase: "ready",
    build: state.build,
    crashStreak: 0,
    safeMode: false,
  })
}

export function resetPluginRecovery(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(RECOVERY_KEY)
    }
  } catch {
    // Storage may be unavailable during early WebView startup.
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function readRecoveryState(): PluginRecoveryState | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined
    const raw = localStorage.getItem(RECOVERY_KEY)
    if (!raw) return undefined
    const value: unknown = JSON.parse(raw)
    if (
      !isPlainRecord(value) ||
      (value.phase !== "starting" && value.phase !== "ready") ||
      typeof value.build !== "string" ||
      typeof value.crashStreak !== "number" ||
      typeof value.safeMode !== "boolean"
    ) {
      return undefined
    }
    return {
      phase: value.phase,
      build: value.build,
      crashStreak: value.crashStreak,
      safeMode: value.safeMode,
      ...(typeof value.lastStartedPluginId === "string"
        ? { lastStartedPluginId: value.lastStartedPluginId }
        : {}),
    }
  } catch {
    return undefined
  }
}

function writeRecoveryState(state: PluginRecoveryState): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(RECOVERY_KEY, JSON.stringify(state))
    }
  } catch {
    // Recovery is best-effort when storage is unavailable.
  }
}
