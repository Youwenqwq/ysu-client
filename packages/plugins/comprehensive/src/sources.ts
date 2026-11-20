import {
  hasSlice,
  requireSlice,
  type ComprehensiveIndicatorDetail,
  type ComprehensiveRadarItem,
  type ComprehensiveReportPage,
  type ComprehensiveReportYears,
  type ComprehensiveResult,
  type ComprehensiveTerm,
  type ComprehensiveYearScore,
  type ProviderRuntimeService,
  type QueryService,
  type QuerySnapshot,
  type SessionService,
} from "@orahako/academic-sdk"
import { createObservableSource, type ObservableSource } from "@orahako/sdk"

export interface ComprehensiveTermSelection {
  readonly year: string
  readonly term: string
}

export function formatTermValue(item: ComprehensiveTermSelection): string {
  return `${item.year}-${item.term}`
}

export function formatTermLabel(item: ComprehensiveTerm): string {
  return (
    [item.yearDisplay, item.termDisplay].filter(Boolean).join(" ") || `${item.year}-${item.term}`
  )
}

export function computeRadarPercent(value: number, max: number): number {
  if (max <= 0 || !Number.isFinite(value) || !Number.isFinite(max)) return 0
  return Math.max(0, Math.min(100, (value / max) * 100))
}

function createIdleSnapshot<T>(): QuerySnapshot<T> {
  return {
    status: "idle",
    data: undefined,
    error: null,
    isLoading: false,
    isRefreshing: false,
    isStale: false,
    updatedAt: null,
    refresh: async () => undefined,
  }
}

interface ParameterizedSourceController<T> {
  readonly source: ObservableSource<QuerySnapshot<T>>
  dispose(): void
}

function createParameterizedSource<P, T>(options: {
  readonly paramSource: ObservableSource<P | null>
  readonly paramKey: (param: P) => string
  readonly createInner: (param: P) => ObservableSource<QuerySnapshot<T>>
}): ParameterizedSourceController<T> {
  const idleSnapshot = createIdleSnapshot<T>()
  const cache = new Map<string, ObservableSource<QuerySnapshot<T>>>()
  const listeners = new Set<() => void>()
  let currentInner: ObservableSource<QuerySnapshot<T>> | null = null
  let unsubInner: (() => void) | null = null
  let unsubParam: (() => void) | null = null
  let disposed = false

  const getInner = (param: P): ObservableSource<QuerySnapshot<T>> => {
    const key = options.paramKey(param)
    const existing = cache.get(key)
    if (existing) return existing
    const created = options.createInner(param)
    cache.set(key, created)
    return created
  }

  const notify = (): void => {
    for (const fn of Array.from(listeners)) fn()
  }

  const rebind = (emitChange: boolean): void => {
    if (disposed) return
    const param = options.paramSource.getSnapshot()
    const nextInner = param !== null ? getInner(param) : null
    if (nextInner === currentInner) return
    unsubInner?.()
    currentInner = nextInner
    unsubInner = currentInner ? currentInner.subscribe(notify) : null
    if (emitChange) notify()
  }

  const source: ObservableSource<QuerySnapshot<T>> = {
    getSnapshot: () => {
      if (disposed) return idleSnapshot
      if (listeners.size > 0) {
        return currentInner ? currentInner.getSnapshot() : idleSnapshot
      }
      const param = options.paramSource.getSnapshot()
      return param !== null ? getInner(param).getSnapshot() : idleSnapshot
    },
    subscribe: (listener) => {
      if (disposed) return () => {}
      const wasEmpty = listeners.size === 0
      listeners.add(listener)
      if (wasEmpty) {
        rebind(false)
        unsubParam = options.paramSource.subscribe(() => {
          rebind(true)
        })
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          unsubParam?.()
          unsubParam = null
          unsubInner?.()
          unsubInner = null
          currentInner = null
        }
      }
    },
  }

  return {
    source,
    dispose() {
      if (disposed) return
      disposed = true
      unsubParam?.()
      unsubParam = null
      unsubInner?.()
      unsubInner = null
      currentInner = null
      listeners.clear()
      cache.clear()
    },
  }
}

export interface ComprehensiveSources {
  readonly termsSource: ObservableSource<QuerySnapshot<ComprehensiveTerm[]>>
  readonly selectedTermSource: ObservableSource<ComprehensiveTermSelection | null>
  readonly resultSource: ObservableSource<QuerySnapshot<ComprehensiveResult>>
  readonly indicatorsSource: ObservableSource<QuerySnapshot<ComprehensiveIndicatorDetail[]>>
  readonly radarSource: ObservableSource<QuerySnapshot<ComprehensiveRadarItem[]>>
  readonly yearScoresSource: ObservableSource<QuerySnapshot<ComprehensiveYearScore[]>>
  readonly reportYearsSource: ObservableSource<QuerySnapshot<ComprehensiveReportYears>>
  readonly selectedReportYearSource: ObservableSource<string | null>
  readonly reportSource: ObservableSource<QuerySnapshot<ComprehensiveReportPage>>
  readonly selectTerm: (term: ComprehensiveTermSelection) => void
  readonly selectReportYear: (year: string) => void
  readonly dispose: () => void
}

export function createComprehensiveSources(deps: {
  readonly query: QueryService
  readonly provider: ProviderRuntimeService
  readonly session: SessionService
}): ComprehensiveSources {
  const { query, provider, session } = deps
  let disposed = false

  const isSliceEnabled = (): boolean =>
    !disposed &&
    session.getSnapshot().isAuthenticated &&
    hasSlice(provider.getSnapshot().provider, "comprehensive")

  const termsSource = query.source<ComprehensiveTerm[], "comprehensive">({
    feature: "comprehensive-terms",
    slice: "comprehensive",
    enabled: isSliceEnabled,
    fetcher: (activeProvider) =>
      requireSlice(activeProvider, "comprehensive").getComprehensiveTerms(),
  })

  const yearScoresSource = query.source<ComprehensiveYearScore[], "comprehensive">({
    feature: "comprehensive-year-scores",
    slice: "comprehensive",
    enabled: isSliceEnabled,
    fetcher: (activeProvider) =>
      requireSlice(activeProvider, "comprehensive").getComprehensiveYearScores(),
  })

  const reportYearsSource = query.source<ComprehensiveReportYears, "comprehensive">({
    feature: "comprehensive-report-years",
    slice: "comprehensive",
    enabled: isSliceEnabled,
    fetcher: (activeProvider) =>
      requireSlice(activeProvider, "comprehensive").getComprehensiveReportYears(),
  })

  const userTermSource = createObservableSource<ComprehensiveTermSelection | null>(null)
  const userReportYearSource = createObservableSource<string | null>(null)

  let lastIdentityKey = ""
  const computeIdentityKey = (): string => {
    const sess = session.getSnapshot()
    const prov = provider.getSnapshot()
    return `${sess.activeSchoolId ?? ""}|${sess.username ?? ""}|${prov.generation}`
  }

  const resetUserSelectionsOnEnvChange = (): void => {
    if (disposed) return
    const nextKey = computeIdentityKey()
    if (nextKey !== lastIdentityKey) {
      lastIdentityKey = nextKey
      userTermSource.set(null)
      userReportYearSource.set(null)
    }
  }

  const unsubSession = session.state.subscribe(resetUserSelectionsOnEnvChange)
  const unsubProvider = provider.state.subscribe(resetUserSelectionsOnEnvChange)
  lastIdentityKey = computeIdentityKey()

  // Memoize the resolved `{ year, term }` object so `Object.is` stays true across renders.
  let cachedTermRef: ComprehensiveTermSelection | null = null
  const resolveEffectiveTerm = (): ComprehensiveTermSelection | null => {
    if (disposed) return null
    const explicit = userTermSource.getSnapshot()
    const loadedTerms = termsSource.getSnapshot().data
    let targetYear: string | null = null
    let targetTerm: string | null = null

    if (explicit) {
      if (
        !loadedTerms ||
        loadedTerms.some((t) => t.year === explicit.year && t.term === explicit.term)
      ) {
        targetYear = explicit.year
        targetTerm = explicit.term
      }
    }
    if (targetYear === null || targetTerm === null) {
      const first = loadedTerms?.[0]
      if (first) {
        targetYear = first.year
        targetTerm = first.term
      }
    }
    if (targetYear === null || targetTerm === null) {
      cachedTermRef = null
      return null
    }
    if (cachedTermRef && cachedTermRef.year === targetYear && cachedTermRef.term === targetTerm) {
      return cachedTermRef
    }
    cachedTermRef = { year: targetYear, term: targetTerm }
    return cachedTermRef
  }

  const termListeners = new Set<() => void>()
  let unsubTermDeps: (() => void) | null = null

  const selectedTermSource: ObservableSource<ComprehensiveTermSelection | null> = {
    getSnapshot: resolveEffectiveTerm,
    subscribe: (listener) => {
      termListeners.add(listener)
      if (termListeners.size === 1) {
        const notify = () => {
          for (const fn of Array.from(termListeners)) fn()
        }
        const offUser = userTermSource.subscribe(notify)
        const offTerms = termsSource.subscribe(notify)
        unsubTermDeps = () => {
          offUser()
          offTerms()
        }
      }
      return () => {
        termListeners.delete(listener)
        if (termListeners.size === 0) {
          unsubTermDeps?.()
          unsubTermDeps = null
        }
      }
    },
  }

  const resolveEffectiveReportYear = (): string | null => {
    if (disposed) return null
    const explicit = userReportYearSource.getSnapshot()
    const loadedYears = reportYearsSource.getSnapshot().data
    if (explicit !== null && explicit.length > 0) {
      if (!loadedYears || loadedYears.years.some((item) => item.year === explicit)) {
        return explicit
      }
    }
    const fallback = loadedYears?.defaultYear || loadedYears?.years[0]?.year
    return fallback && fallback.length > 0 ? fallback : null
  }

  const reportYearListeners = new Set<() => void>()
  let unsubReportYearDeps: (() => void) | null = null

  const selectedReportYearSource: ObservableSource<string | null> = {
    getSnapshot: resolveEffectiveReportYear,
    subscribe: (listener) => {
      reportYearListeners.add(listener)
      if (reportYearListeners.size === 1) {
        const notify = () => {
          for (const fn of Array.from(reportYearListeners)) fn()
        }
        const offUser = userReportYearSource.subscribe(notify)
        const offYears = reportYearsSource.subscribe(notify)
        unsubReportYearDeps = () => {
          offUser()
          offYears()
        }
      }
      return () => {
        reportYearListeners.delete(listener)
        if (reportYearListeners.size === 0) {
          unsubReportYearDeps?.()
          unsubReportYearDeps = null
        }
      }
    },
  }

  const resultController = createParameterizedSource<
    ComprehensiveTermSelection,
    ComprehensiveResult
  >({
    paramSource: selectedTermSource,
    paramKey: (param) => `${param.year}|${param.term}`,
    createInner: (param) =>
      query.source<ComprehensiveResult, "comprehensive">({
        feature: "comprehensive-result",
        slice: "comprehensive",
        params: { year: param.year, term: param.term },
        enabled: isSliceEnabled,
        fetcher: (activeProvider) =>
          requireSlice(activeProvider, "comprehensive").getComprehensiveResult({
            year: param.year,
            term: param.term,
          }),
      }),
  })

  const indicatorsController = createParameterizedSource<
    ComprehensiveTermSelection,
    ComprehensiveIndicatorDetail[]
  >({
    paramSource: selectedTermSource,
    paramKey: (param) => `${param.year}|${param.term}`,
    createInner: (param) =>
      query.source<ComprehensiveIndicatorDetail[], "comprehensive">({
        feature: "comprehensive-indicators",
        slice: "comprehensive",
        params: { year: param.year, term: param.term },
        enabled: isSliceEnabled,
        fetcher: (activeProvider) =>
          requireSlice(activeProvider, "comprehensive").getComprehensiveIndicators({
            year: param.year,
            term: param.term,
          }),
      }),
  })

  const radarController = createParameterizedSource<
    ComprehensiveTermSelection,
    ComprehensiveRadarItem[]
  >({
    paramSource: selectedTermSource,
    paramKey: (param) => `${param.year}|${param.term}`,
    createInner: (param) =>
      query.source<ComprehensiveRadarItem[], "comprehensive">({
        feature: "comprehensive-radar",
        slice: "comprehensive",
        params: { year: param.year, term: param.term },
        enabled: isSliceEnabled,
        fetcher: (activeProvider) =>
          requireSlice(activeProvider, "comprehensive").getComprehensiveRadar({
            year: param.year,
            term: param.term,
          }),
      }),
  })

  const reportController = createParameterizedSource<string, ComprehensiveReportPage>({
    paramSource: selectedReportYearSource,
    paramKey: (year) => year,
    createInner: (year) =>
      query.source<ComprehensiveReportPage, "comprehensive">({
        feature: "comprehensive-report",
        slice: "comprehensive",
        params: { year },
        enabled: () => isSliceEnabled() && year.length > 0,
        fetcher: (activeProvider) =>
          requireSlice(activeProvider, "comprehensive").getComprehensiveReport({ year }),
      }),
  })

  const selectTerm = (term: ComprehensiveTermSelection): void => {
    if (disposed) return
    userTermSource.set({ year: term.year, term: term.term })
  }

  const selectReportYear = (year: string): void => {
    if (disposed || !year) return
    userReportYearSource.set(year)
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    unsubSession()
    unsubProvider()
    resultController.dispose()
    indicatorsController.dispose()
    radarController.dispose()
    reportController.dispose()
    unsubTermDeps?.()
    unsubTermDeps = null
    unsubReportYearDeps?.()
    unsubReportYearDeps = null
    termListeners.clear()
    reportYearListeners.clear()
  }

  return {
    termsSource,
    selectedTermSource,
    resultSource: resultController.source,
    indicatorsSource: indicatorsController.source,
    radarSource: radarController.source,
    yearScoresSource,
    reportYearsSource,
    selectedReportYearSource,
    reportSource: reportController.source,
    selectTerm,
    selectReportYear,
    dispose,
  }
}
