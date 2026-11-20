import {
  hasSlice,
  requireSlice,
  type CatalogPage,
  type CatalogQueryOptions,
  type Competition,
  type CreditBatch,
  type CreditDeclaration,
  type CreditRecord,
  type CreditSummary,
  type LibraryActivity,
  type ProviderRuntimeService,
  type QueryService,
  type QuerySnapshot,
  type SessionService,
} from "@orahako/academic-sdk"
import { defineStore, type ObservableSource } from "@orahako/sdk"

export type CreditsTab = "records" | "declarations" | "competitions" | "activities"

export interface CreditsUiState {
  readonly tab: CreditsTab
  readonly batch: string | undefined
  readonly filterDrawerOpen: boolean
  readonly competitionsKeywordDraft: string
  readonly competitionsKeyword: string
  readonly competitionsPage: number
  readonly activitiesKeywordDraft: string
  readonly activitiesKeyword: string
  readonly activitiesPage: number
}

function isCreditsTab(value: string): value is CreditsTab {
  return (
    value === "records" ||
    value === "declarations" ||
    value === "competitions" ||
    value === "activities"
  )
}

export const creditsUiStore = defineStore({
  init: (): CreditsUiState => ({
    tab: "records",
    batch: undefined,
    filterDrawerOpen: false,
    competitionsKeywordDraft: "",
    competitionsKeyword: "",
    competitionsPage: 1,
    activitiesKeywordDraft: "",
    activitiesKeyword: "",
    activitiesPage: 1,
  }),
  actions: {
    setTab(ctx, tab: string) {
      if (!isCreditsTab(tab)) return
      ctx.set((prev) => (prev.tab === tab ? prev : { ...prev, tab }))
    },
    setBatch(ctx, batch: string | undefined) {
      ctx.set((prev) => (prev.batch === batch ? prev : { ...prev, batch }))
    },
    setFilterDrawerOpen(ctx, filterDrawerOpen: boolean) {
      ctx.set((prev) =>
        prev.filterDrawerOpen === filterDrawerOpen ? prev : { ...prev, filterDrawerOpen }
      )
    },
    setCompetitionsKeywordDraft(ctx, competitionsKeywordDraft: string) {
      ctx.set((prev) => ({ ...prev, competitionsKeywordDraft }))
    },
    searchCompetitions(ctx) {
      ctx.set((prev) => ({
        ...prev,
        competitionsKeyword: prev.competitionsKeywordDraft.trim(),
        competitionsPage: 1,
      }))
    },
    setCompetitionsPage(ctx, page: number) {
      const clamped = Math.max(1, Math.floor(page))
      ctx.set((prev) =>
        prev.competitionsPage === clamped ? prev : { ...prev, competitionsPage: clamped }
      )
    },
    setActivitiesKeywordDraft(ctx, activitiesKeywordDraft: string) {
      ctx.set((prev) => ({ ...prev, activitiesKeywordDraft }))
    },
    searchActivities(ctx) {
      ctx.set((prev) => ({
        ...prev,
        activitiesKeyword: prev.activitiesKeywordDraft.trim(),
        activitiesPage: 1,
      }))
    },
    setActivitiesPage(ctx, page: number) {
      const clamped = Math.max(1, Math.floor(page))
      ctx.set((prev) =>
        prev.activitiesPage === clamped ? prev : { ...prev, activitiesPage: clamped }
      )
    },
  },
})

export type CreditsUiStoreInstance = ReturnType<typeof creditsUiStore.create>

/**
 * Rebindable observable query proxy so parameterized queries (batch filter,
 * catalog keyword & pagination) stay pure `ObservableSource<QuerySnapshot<T>>`
 * hooks consumed via derived component props.
 */
export class DynamicQuerySource<T, P> {
  readonly source: ObservableSource<QuerySnapshot<T>>
  private currentKey: string
  private currentInner: ObservableSource<QuerySnapshot<T>>
  private unsubscribeInner: (() => void) | null = null
  private readonly listeners = new Set<() => void>()
  private disposed = false

  constructor(
    initialParams: P,
    private readonly serializeKey: (params: P) => string,
    private readonly buildSource: (params: P) => ObservableSource<QuerySnapshot<T>>
  ) {
    this.currentKey = serializeKey(initialParams)
    this.currentInner = buildSource(initialParams)
    this.source = {
      getSnapshot: () => this.currentInner.getSnapshot(),
      subscribe: (listener) => {
        if (this.disposed) return () => {}
        const wasEmpty = this.listeners.size === 0
        this.listeners.add(listener)
        if (wasEmpty) {
          this.attachInner(this.currentInner)
        }
        let active = true
        return () => {
          if (!active) return
          active = false
          this.listeners.delete(listener)
          if (this.listeners.size === 0) {
            this.detachInner()
          }
        }
      },
    }
  }

  setParams(params: P): void {
    if (this.disposed) return
    const nextKey = this.serializeKey(params)
    if (nextKey === this.currentKey) return
    this.currentKey = nextKey
    const nextInner = this.buildSource(params)
    const hadListeners = this.listeners.size > 0
    if (hadListeners) {
      this.detachInner()
    }
    this.currentInner = nextInner
    if (hadListeners) {
      this.attachInner(nextInner)
      this.notify()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.detachInner()
    this.listeners.clear()
  }

  private attachInner(inner: ObservableSource<QuerySnapshot<T>>): void {
    this.unsubscribeInner = inner.subscribe(() => {
      this.notify()
    })
  }

  private detachInner(): void {
    this.unsubscribeInner?.()
    this.unsubscribeInner = null
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) {
      listener()
    }
  }
}

export interface CreditsControllerOptions {
  readonly provider: Pick<ProviderRuntimeService, "getSnapshot">
  readonly session: Pick<SessionService, "getSnapshot">
  readonly query: Pick<QueryService, "source">
}

export interface CreditsController {
  readonly uiStore: CreditsUiStoreInstance
  readonly summarySource: ObservableSource<QuerySnapshot<CreditSummary>>
  readonly batchesSource: ObservableSource<QuerySnapshot<CreditBatch[]>>
  readonly declarationsSource: ObservableSource<QuerySnapshot<CreditDeclaration[]>>
  readonly recordsSource: ObservableSource<QuerySnapshot<CreditRecord[]>>
  readonly competitionsSource: ObservableSource<QuerySnapshot<CatalogPage<Competition>>>
  readonly activitiesSource: ObservableSource<QuerySnapshot<CatalogPage<LibraryActivity>>>
  dispose(): void
}

export function createCreditsController(options: CreditsControllerOptions): CreditsController {
  const { provider, session, query } = options
  const uiStore = creditsUiStore.create()
  let disposed = false

  const isEnabled = (): boolean =>
    !disposed &&
    session.getSnapshot().isAuthenticated &&
    hasSlice(provider.getSnapshot().provider, "credits")

  const summarySource = query.source<CreditSummary, "credits">({
    feature: "credit-summary",
    slice: "credits",
    enabled: isEnabled,
    fetcher: (activeProvider) => requireSlice(activeProvider, "credits").getCreditSummary(),
  })

  const batchesSource = query.source<CreditBatch[], "credits">({
    feature: "credit-batches",
    slice: "credits",
    enabled: isEnabled,
    fetcher: (activeProvider) => requireSlice(activeProvider, "credits").getCreditBatches(),
  })

  const declarationsSource = query.source<CreditDeclaration[], "credits">({
    feature: "credit-declarations",
    slice: "credits",
    enabled: isEnabled,
    fetcher: (activeProvider) => requireSlice(activeProvider, "credits").getCreditDeclarations(),
  })

  const recordsProxy = new DynamicQuerySource<CreditRecord[], string | undefined>(
    undefined,
    (batch) => batch ?? "__current__",
    (batch) => {
      const params = batch === "all" ? { all: true } : batch ? { batchId: batch } : undefined
      return query.source<CreditRecord[], "credits">({
        feature: "credit-records",
        slice: "credits",
        params,
        enabled: isEnabled,
        fetcher: (activeProvider) => {
          const credits = requireSlice(activeProvider, "credits")
          if (batch === "all") {
            return credits.getAllCreditRecords()
          }
          return credits.getCreditRecords(batch ? { batchId: batch } : undefined)
        },
      })
    }
  )

  const competitionsProxy = new DynamicQuerySource<CatalogPage<Competition>, CatalogQueryOptions>(
    { keyword: "", pageIndex: 1 },
    (opts) => `${opts.keyword ?? ""}|${opts.pageIndex ?? 1}`,
    (opts) =>
      query.source<CatalogPage<Competition>, "credits">({
        feature: "credit-competitions",
        slice: "credits",
        params: opts,
        enabled: isEnabled,
        fetcher: (activeProvider) =>
          requireSlice(activeProvider, "credits").getCreditCompetitions(opts),
      })
  )

  const activitiesProxy = new DynamicQuerySource<CatalogPage<LibraryActivity>, CatalogQueryOptions>(
    { keyword: "", pageIndex: 1 },
    (opts) => `${opts.keyword ?? ""}|${opts.pageIndex ?? 1}`,
    (opts) =>
      query.source<CatalogPage<LibraryActivity>, "credits">({
        feature: "credit-library-activities",
        slice: "credits",
        params: opts,
        enabled: isEnabled,
        fetcher: (activeProvider) =>
          requireSlice(activeProvider, "credits").getCreditLibraryActivities(opts),
      })
  )

  const unsubscribeStore = uiStore.source.subscribe(() => {
    const state = uiStore.source.getSnapshot()
    recordsProxy.setParams(state.batch)
    competitionsProxy.setParams({
      keyword: state.competitionsKeyword,
      pageIndex: state.competitionsPage,
    })
    activitiesProxy.setParams({
      keyword: state.activitiesKeyword,
      pageIndex: state.activitiesPage,
    })
  })

  return {
    uiStore,
    summarySource,
    batchesSource,
    declarationsSource,
    recordsSource: recordsProxy.source,
    competitionsSource: competitionsProxy.source,
    activitiesSource: activitiesProxy.source,
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribeStore()
      recordsProxy.dispose()
      competitionsProxy.dispose()
      activitiesProxy.dispose()
      uiStore.dispose()
    },
  }
}
