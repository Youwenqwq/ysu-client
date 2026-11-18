import type {
  NetworkActivityCategory,
  NetworkActivityEntry,
  NetworkActivityOutcome,
  NetworkActivityRecord,
  NetworkActivitySession,
  NetworkActivitySnapshot,
  ObservableSource,
  PluginHttpActivityService,
} from "@orahako/sdk"

const SESSION_IDLE_MS = 2_000
const MAX_HISTORY = 100

export type FinishRequest = (outcome?: NetworkActivityOutcome) => void
export type ActivityLabeler = (url: string) => string | undefined
export type ActivityClassifier = (url: string) => NetworkActivityCategory | undefined

const emptySnapshot = (): NetworkActivitySnapshot => ({
  active: [],
  history: [],
  session: null,
  revision: 0,
})

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

/**
 * Host-side transport activity recorder.
 *
 * Classifies URLs synchronously through registered classifiers/labelers and
 * retains only coarse categories, labels, HTTP methods, and monotonic timings;
 * raw URLs, headers, bodies, and cookies never enter snapshots.
 */
export class HttpActivityRecorder implements PluginHttpActivityService {
  readonly state: ObservableSource<NetworkActivitySnapshot>

  private readonly active = new Map<number, NetworkActivityEntry>()
  private readonly listeners = new Set<() => void>()
  private readonly labelers = new Map<number, ActivityLabeler>()
  private readonly classifiers = new Map<number, ActivityClassifier>()
  private nextId = 1
  private nextLabelerId = 1
  private nextClassifierId = 1
  private revision = 0
  private generation = 0
  private session: MutableSession | null = null
  private history: readonly NetworkActivityRecord[] = []
  private snapshot: NetworkActivitySnapshot = emptySnapshot()
  private disposed = false

  constructor() {
    this.state = {
      getSnapshot: this.getSnapshot,
      subscribe: this.subscribe,
    }
  }

  classifyRequest = (url: string): NetworkActivityCategory => {
    for (const classifier of this.classifiers.values()) {
      try {
        const category = classifier(url)
        if (category) return category
      } catch {
        // Provider classifiers are isolated from transport and other plugins.
      }
    }
    return "other"
  }

  registerClassifier = (classifier: ActivityClassifier): (() => void) => {
    if (this.disposed) return () => {}
    const id = this.nextClassifierId++
    this.classifiers.set(id, classifier)
    return () => {
      this.classifiers.delete(id)
    }
  }

  registerLabeler = (labeler: ActivityLabeler): (() => void) => {
    if (this.disposed) return () => {}
    const id = this.nextLabelerId++
    this.labelers.set(id, labeler)
    return () => {
      this.labelers.delete(id)
    }
  }

  getSnapshot = (): NetworkActivitySnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {}
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  beginRequest = (url: string, method: "GET" | "POST"): FinishRequest => {
    if (this.disposed) return () => {}
    try {
      const startedAt = performance.now()
      const currentSession = this.ensureSession(startedAt)
      const category = this.classifyRequest(url)
      const label = this.resolveLabel(url)
      const groupKey = label ?? `category:${category}`
      if (!currentSession.groups.has(groupKey)) {
        currentSession.groups.set(groupKey, { startedAt, endedAt: startedAt, category, label })
      }
      const id = this.nextId++
      const entry: NetworkActivityEntry = {
        id,
        category,
        ...(label !== undefined ? { label } : {}),
        method,
        startedAt,
      }
      this.active.set(id, entry)
      this.publish()

      const generation = this.generation
      let finished = false
      return (outcome = "ok") => {
        if (finished) return
        finished = true
        if (this.disposed || generation !== this.generation) return
        try {
          const endedAt = performance.now()
          this.active.delete(id)
          const current = this.session ?? this.createSession(startedAt)
          this.session = current
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
          this.history = [
            ...this.history,
            {
              id,
              category: entry.category,
              ...(entry.label !== undefined ? { label: entry.label } : {}),
              method: entry.method,
              startedAt,
              endedAt,
              durationMs: Math.max(0, endedAt - startedAt),
              outcome,
            },
          ].slice(-MAX_HISTORY)
          this.publish()
        } catch {
          // Keep instrumentation failure isolated from the transport.
        }
      }
    } catch {
      return () => {}
    }
  }

  reset(): void {
    this.generation += 1
    this.active.clear()
    this.listeners.clear()
    this.labelers.clear()
    this.classifiers.clear()
    this.session = null
    this.history = []
    this.revision = 0
    this.snapshot = emptySnapshot()
    this.nextId = 1
    this.nextLabelerId = 1
    this.nextClassifierId = 1
  }

  dispose(): void {
    this.disposed = true
    this.reset()
  }

  private resolveLabel(url: string): string | undefined {
    for (const labeler of this.labelers.values()) {
      try {
        const label = labeler(url)
        if (typeof label === "string" && label.length > 0) return label
      } catch {
        // Broken labelers must never affect requests or other labelers.
      }
    }
    return undefined
  }

  private createSession(now: number): MutableSession {
    return {
      startedAt: now,
      endedAt: now,
      count: 0,
      failed: 0,
      groups: new Map(),
      lastEndedAt: now,
    }
  }

  private ensureSession(now: number): MutableSession {
    if (
      this.session &&
      (this.active.size > 0 || now - this.session.lastEndedAt <= SESSION_IDLE_MS)
    ) {
      return this.session
    }
    this.session = this.createSession(now)
    this.history = []
    return this.session
  }

  private publish(): void {
    this.revision += 1
    this.snapshot = {
      active: Array.from(this.active.values()),
      history: this.history,
      session: this.session ? this.snapshotSession(this.session) : null,
      revision: this.revision,
    }
    for (const listener of Array.from(this.listeners)) {
      try {
        listener()
      } catch {
        // Diagnostics must never break a request or another subscriber.
      }
    }
  }

  private snapshotSession(current: MutableSession): NetworkActivitySession {
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
      ...(slowestGroup?.label !== undefined ? { slowestLabel: slowestGroup.label } : {}),
      slowestMs,
    }
  }
}

export { HttpActivityRecorder as NetworkActivityRuntime }
