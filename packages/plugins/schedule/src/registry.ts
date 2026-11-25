import type { Context } from "@cordisjs/core"
import {
  createObservableSource,
  PLUGIN_SERVICE_SCOPE,
  trackPluginRegistration,
  type ObservableSource,
  type PluginManifest,
  type ScheduleCalendarContext,
  type ScheduleEffectiveSnapshot,
  type ScheduleEntry,
  type ScheduleService,
  type ScheduleSourceContribution,
  type ScheduleSourceSpec,
  type ScopedPluginService,
} from "@orahako/sdk"

const DEFAULT_SOURCE_ORDER = 100

export function scheduleSourceKey(pluginId: string, sourceId: string): string {
  return `${pluginId}:${sourceId}`
}

interface RegisteredSourceRecord {
  readonly contribution: ScheduleSourceContribution
  readonly unsubscribe: () => void
}

export class ScheduleRegistry implements ScheduleService, ScopedPluginService<ScheduleService> {
  readonly sources: ObservableSource<readonly ScheduleSourceContribution[]>
  readonly state: ObservableSource<ScheduleEffectiveSnapshot>

  private readonly sourcesSource = createObservableSource<readonly ScheduleSourceContribution[]>([])
  private readonly stateSource = createObservableSource<ScheduleEffectiveSnapshot>({
    entries: [],
    allEntries: [],
    sources: [],
  })
  private readonly records = new Map<string, RegisteredSourceRecord>()
  private baseEntries: readonly ScheduleEntry[] = []
  private calendarContext: ScheduleCalendarContext | undefined
  private baseRefresher: (() => Promise<void>) | null = null
  private currentSemester = ""
  private disposed = false

  constructor() {
    this.sources = {
      getSnapshot: this.sourcesSource.getSnapshot,
      subscribe: this.sourcesSource.subscribe,
    }
    this.state = {
      getSnapshot: this.stateSource.getSnapshot,
      subscribe: this.stateSource.subscribe,
    }
  }

  [PLUGIN_SERVICE_SCOPE](ctx: Context, manifest: PluginManifest): ScheduleService {
    return this.createScopedFacade(ctx, manifest)
  }

  createScopedFacade(ctx: Pick<Context, "effect">, manifest: PluginManifest): ScheduleService {
    const registerScoped = (spec: ScheduleSourceSpec): (() => void) =>
      trackPluginRegistration(ctx, () => this.registerInternal(manifest.id, spec))

    return {
      sources: this.sources,
      state: this.state,
      registerSource: registerScoped,
      getSources: this.getSources,
      getEffectiveSnapshot: this.getEffectiveSnapshot,
      refresh: this.refresh,
      subscribe: this.subscribe,
    }
  }

  getSources = (): readonly ScheduleSourceContribution[] => {
    return this.sourcesSource.getSnapshot()
  }

  getEffectiveSnapshot = (): ScheduleEffectiveSnapshot => {
    return this.stateSource.getSnapshot()
  }

  subscribe = (listener: () => void): (() => void) => {
    return this.stateSource.subscribe(listener)
  }

  registerSource(spec: ScheduleSourceSpec): () => void {
    return this.registerInternal("root", spec)
  }

  setBaseSchedule(entries: readonly ScheduleEntry[], calendar?: ScheduleCalendarContext): void {
    if (this.disposed) return
    this.baseEntries = entries
    this.calendarContext = calendar
    this.publish()
  }

  setBaseRefresher(refresher: (() => Promise<void>) | null): void {
    this.baseRefresher = refresher
  }

  setSemester(semester: string): void {
    this.currentSemester = semester
    for (const record of this.records.values()) {
      record.contribution.setSemester?.(semester)
    }
  }

  refresh = async (): Promise<void> => {
    await this.refreshAll()
  }

  async refreshAll(): Promise<void> {
    const tasks: Array<Promise<void>> = []
    if (this.baseRefresher) {
      tasks.push(this.baseRefresher())
    }
    for (const record of this.records.values()) {
      const result = record.contribution.refresh?.()
      if (result) tasks.push(result)
    }
    await Promise.allSettled(tasks)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const record of this.records.values()) {
      record.unsubscribe()
    }
    this.records.clear()
    this.baseEntries = []
    this.calendarContext = undefined
    this.baseRefresher = null
    this.sourcesSource.set([])
    this.stateSource.set({ entries: [], allEntries: [], sources: [] })
  }

  private registerInternal(pluginId: string, spec: ScheduleSourceSpec): () => void {
    if (this.disposed) {
      return () => {}
    }
    if (!spec.id) {
      throw new Error("Schedule source id must not be empty")
    }
    const scopedId = scheduleSourceKey(pluginId, spec.id)
    if (this.records.has(scopedId)) {
      throw new Error(`Schedule source already registered: ${scopedId}`)
    }

    const contribution: ScheduleSourceContribution = {
      ...spec,
      pluginId,
      scopedId,
    }

    const unsubscribe = spec.entries.subscribe(() => {
      if (!this.disposed) {
        this.publish()
      }
    })

    const record: RegisteredSourceRecord = { contribution, unsubscribe }
    this.records.set(scopedId, record)
    if (this.currentSemester) {
      contribution.setSemester?.(this.currentSemester)
    }
    this.publish()

    let removed = false
    return () => {
      if (removed) return
      removed = true
      unsubscribe()
      if (this.records.get(scopedId) === record) {
        this.records.delete(scopedId)
        if (!this.disposed) {
          this.publish()
        }
      }
    }
  }

  private publish(): void {
    const sortedSources = Array.from(this.records.values())
      .map((record) => record.contribution)
      .sort(
        (a, b) =>
          (a.order ?? DEFAULT_SOURCE_ORDER) - (b.order ?? DEFAULT_SOURCE_ORDER) ||
          a.scopedId.localeCompare(b.scopedId)
      )

    const entries: ScheduleEntry[] = []
    for (const source of sortedSources) {
      const sourceEntries = source.entries.getSnapshot()
      for (const entry of sourceEntries) {
        entries.push({
          ...entry,
          sourceId: entry.sourceId || source.id,
          sourcePluginId: entry.sourcePluginId || source.pluginId,
        })
      }
    }

    const allEntries: readonly ScheduleEntry[] =
      this.baseEntries.length > 0 ? [...this.baseEntries, ...entries] : entries

    this.sourcesSource.set(sortedSources)
    this.stateSource.set({
      entries,
      allEntries,
      ...(this.calendarContext !== undefined ? { calendar: this.calendarContext } : {}),
      sources: sortedSources,
    })
  }
}
