import type {
  NetworkActivityCategory,
  NetworkActivityEntry,
  NetworkActivitySession,
  NetworkActivitySnapshot,
  PluginHttpActivityService,
} from "@orahako/plugin-sdk/services"

/**
 * Host-side transport activity.
 *
 * `fetchWithJar` is the single logical request boundary for provider traffic:
 * it includes redirect hops and cookie synchronization. We classify the URL
 * synchronously and keep only the category, method and timings; URLs, headers,
 * bodies and cookies never enter the snapshot.
 */

const SESSION_IDLE_MS = 2_000

type FinishRequest = (outcome?: "ok" | "error" | "aborted") => void
type ActivityLabeler = (url: string) => string | undefined

const active = new Map<number, NetworkActivityEntry>()
const listeners = new Set<() => void>()
const labelers = new Map<number, ActivityLabeler>()
let nextId = 1
let nextLabelerId = 1
let revision = 0
let session: MutableSession | null = null
let snapshot: NetworkActivitySnapshot = { active: [], session: null, revision: 0 }

interface MutableGroup {
  startedAt: number
  endedAt: number
  category: NetworkActivityCategory
  label?: string
}

interface MutableSession {
  startedAt: number
  endedAt: number
  count: number
  failed: number
  groups: Map<string, MutableGroup>
  lastEndedAt: number
}

export function classifyRequest(url: string): NetworkActivityCategory {
  let host: string
  let path: string
  try {
    const parsed = new URL(url)
    host = parsed.hostname.toLowerCase()
    path = parsed.pathname.toLowerCase()
  } catch {
    return "other"
  }

  if (
    host === "open.weixin.qq.com" ||
    host === "lp.open.weixin.qq.com" ||
    host.endsWith(".weixin.qq.com")
  ) {
    return "wechat"
  }
  if (path.startsWith("/authserver")) return "auth"
  if (path.startsWith("/jwmobile")) return "mobile"
  if (path.startsWith("/publicapp")) return "one-stop"
  if (path === "/pay" || path.startsWith("/pay/")) return "payment"
  if (path.startsWith("/jwapp") || path.startsWith("/jwglxt") || path.startsWith("/jwxt")) {
    return "academic"
  }
  if (
    path.startsWith("/xsfw") ||
    path.startsWith("/xuefen") ||
    path.startsWith("/system") ||
    path.startsWith("/huodongku") ||
    path.startsWith("/jingcai")
  ) {
    return "campus"
  }
  return "other"
}

/** Registers a provider-scoped labeler; the first match wins. */
export function registerActivityLabeler(labeler: ActivityLabeler): () => void {
  const id = nextLabelerId++
  labelers.set(id, labeler)
  return () => {
    labelers.delete(id)
  }
}

function resolveLabel(url: string): string | undefined {
  for (const labeler of labelers.values()) {
    try {
      const label = labeler(url)
      if (typeof label === "string" && label.length > 0) return label
    } catch {
      // A broken provider labeler must not affect the request or other labelers.
    }
  }
  return undefined
}

function createSession(now: number): MutableSession {
  return {
    startedAt: now,
    endedAt: now,
    count: 0,
    failed: 0,
    groups: new Map(),
    lastEndedAt: now,
  }
}

function ensureSession(now: number): MutableSession {
  if (session && (active.size > 0 || now - session.lastEndedAt <= SESSION_IDLE_MS)) return session
  session = createSession(now)
  return session
}

function publish(): void {
  revision += 1
  snapshot = {
    active: Array.from(active.values()),
    session: session ? snapshotSession(session) : null,
    revision,
  }
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // Diagnostics must never break a request or another subscriber.
    }
  }
}

function snapshotSession(current: MutableSession): NetworkActivitySession {
  let slowestGroup: MutableGroup | null = null
  let slowestMs = 0
  for (const group of current.groups.values()) {
    const duration = Math.max(0, group.endedAt - group.startedAt)
    if (duration >= slowestMs) {
      slowestGroup = group
      slowestMs = duration
    }
  }
  return {
    startedAt: current.startedAt,
    endedAt: current.endedAt,
    totalMs: Math.max(0, current.endedAt - current.startedAt),
    count: current.count,
    failed: current.failed,
    slowestCategory: slowestGroup?.category ?? null,
    slowestLabel: slowestGroup?.label,
    slowestMs,
  }
}

/**
 * Starts tracking one logical request. The returned finisher is idempotent and
 * safe to call from `finally`-style error paths.
 */
export function beginRequest(url: string, method: "GET" | "POST"): FinishRequest {
  try {
    const startedAt = performance.now()
    const currentSession = ensureSession(startedAt)
    const category = classifyRequest(url)
    const label = resolveLabel(url)
    const groupKey = label ?? `category:${category}`
    if (!currentSession.groups.has(groupKey)) {
      currentSession.groups.set(groupKey, { startedAt, endedAt: startedAt, category, label })
    }
    const id = nextId++
    const entry: NetworkActivityEntry = {
      id,
      category,
      label,
      method,
      startedAt,
    }
    active.set(id, entry)
    publish()

    let finished = false
    return (outcome = "ok") => {
      if (finished) return
      finished = true
      try {
        const endedAt = performance.now()
        active.delete(id)
        const current = session ?? createSession(startedAt)
        session = current
        const key = entry.label ?? `category:${entry.category}`
        const group = current.groups.get(key) ?? {
          startedAt,
          endedAt,
          category: entry.category,
          label: entry.label,
        }
        current.groups.set(key, group)
        group.endedAt = endedAt
        current.count += 1
        if (outcome !== "ok") current.failed += 1
        current.lastEndedAt = endedAt
        current.endedAt = endedAt
        publish()
      } catch {
        // Keep instrumentation failure isolated from the transport.
      }
    }
  } catch {
    return () => {}
  }
}

export const networkActivity: PluginHttpActivityService = {
  getSnapshot: () => snapshot,
  subscribe(listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  registerLabeler: registerActivityLabeler,
}

/** @internal Resets module state for isolated tests. */
export function resetNetworkActivity(): void {
  active.clear()
  listeners.clear()
  labelers.clear()
  session = null
  revision = 0
  snapshot = { active: [], session: null, revision: 0 }
}
