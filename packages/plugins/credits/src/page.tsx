import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Search } from "lucide-react"
import type {
  CatalogPage,
  Competition,
  CreditBatch,
  CreditDeclaration,
  CreditRecord,
  CreditSummary,
  LibraryActivity,
  QuerySnapshot,
} from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  SlotComponent,
  Translator,
} from "@orahako/sdk"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  FilterChips,
  FilterDrawer,
  FilterOptionList,
  FilterTrigger,
  Input,
  LoadingCards,
  Skeleton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useErrorToast,
  ValidatingList,
} from "@orahako/ui-primitives"
import type { CreditsUiStoreInstance } from "./controller"
import type { CreditsDictionary } from "./dictionary"

export interface CreditsPageInject {
  readonly hooks: {
    readonly summary: ObservableSource<QuerySnapshot<CreditSummary>>
    readonly batches: ObservableSource<QuerySnapshot<CreditBatch[]>>
    readonly declarations: ObservableSource<QuerySnapshot<CreditDeclaration[]>>
    readonly records: ObservableSource<QuerySnapshot<CreditRecord[]>>
    readonly competitions: ObservableSource<QuerySnapshot<CatalogPage<Competition>>>
    readonly activities: ObservableSource<QuerySnapshot<CatalogPage<LibraryActivity>>>
  }
}

export type CreditsPageProps = DerivedComponentProps<
  Record<string, never>,
  CreditsDictionary,
  undefined,
  CreditsUiStoreInstance,
  CreditsPageInject
>

function DeclarationsPanel({
  useDeclarations,
  t,
}: {
  readonly useDeclarations: CreditsPageProps["useDeclarations"]
  readonly t: Translator<CreditsDictionary>
}): ReactNode {
  const query = useDeclarations()
  const declarations = query.data ?? []
  useErrorToast(query.error ?? undefined)

  if ((query.isLoading || query.isRefreshing) && declarations.length === 0) {
    return <LoadingCards />
  }
  if (declarations.length === 0) {
    return <EmptyState title={t("credits.noDeclarations")} />
  }

  return (
    <ValidatingList validating={query.isRefreshing} className="flex flex-col gap-4">
      {declarations.map((decl, idx) => (
        <Card key={`${decl.itemName}-${idx}`}>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base">{decl.itemName}</CardTitle>
                <CardDescription>
                  {[decl.categoryMajor, decl.categoryMinor].filter(Boolean).join(" · ")}
                </CardDescription>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {decl.score !== undefined && (
                  <span className="text-lg font-semibold tabular-nums">{decl.score}</span>
                )}
                {decl.status && <Badge variant="secondary">{decl.status}</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {decl.awardLevel && (
              <span>
                {t("credits.awardLevel")}: {decl.awardLevel}
              </span>
            )}
            {decl.batch && (
              <span>
                {t("credits.batch")}: {decl.batch}
              </span>
            )}
          </CardContent>
        </Card>
      ))}
    </ValidatingList>
  )
}

function RecordCard({
  record,
  t,
}: {
  readonly record: CreditRecord
  readonly t: Translator<CreditsDictionary>
}): ReactNode {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{record.itemName}</CardTitle>
            <CardDescription>
              {[record.categoryMajor, record.categoryMinor].filter(Boolean).join(" · ")}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {record.actualScore !== undefined && (
              <span className="text-lg font-semibold tabular-nums">{record.actualScore}</span>
            )}
            <div className="flex gap-1">
              {record.grade && <Badge variant="default">{record.grade}</Badge>}
              {record.status && <Badge variant="secondary">{record.status}</Badge>}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {record.year && (
          <span>
            {t("credits.year")}: {record.year}
          </span>
        )}
        {record.batch && (
          <span>
            {t("credits.batch")}: {record.batch}
          </span>
        )}
      </CardContent>
    </Card>
  )
}

function RecordGroup({
  title,
  records,
  defaultOpen,
  t,
}: {
  readonly title: string
  readonly records: readonly CreditRecord[]
  readonly defaultOpen: boolean
  readonly t: Translator<CreditsDictionary>
}): ReactNode {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 rounded-md px-1 py-1 text-sm font-medium text-muted-foreground transition-colors active:bg-muted/60"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0" />
        ) : (
          <ChevronRight className="size-4 shrink-0" />
        )}
        <span className="flex-1 truncate text-left">{title}</span>
        <Badge variant="outline">{records.length}</Badge>
      </button>
      {open && (
        <div className="flex flex-col gap-4">
          {records.map((record, idx) => (
            <RecordCard key={`${record.itemName}-${idx}`} record={record} t={t} />
          ))}
        </div>
      )}
    </section>
  )
}

const CURRENT_BATCH_VALUE = "__current"

function RecordsPanel({
  batch,
  filterDrawerOpen,
  onBatchChange,
  onFilterDrawerOpenChange,
  useBatches,
  useRecords,
  t,
}: {
  readonly batch: string | undefined
  readonly filterDrawerOpen: boolean
  readonly onBatchChange: (batch: string | undefined) => void
  readonly onFilterDrawerOpenChange: (open: boolean) => void
  readonly useBatches: CreditsPageProps["useBatches"]
  readonly useRecords: CreditsPageProps["useRecords"]
  readonly t: Translator<CreditsDictionary>
}): ReactNode {
  const batchesQuery = useBatches()
  const recordsQuery = useRecords()
  const batches = batchesQuery.data ?? []
  const records = recordsQuery.data ?? []

  useErrorToast(batchesQuery.error ?? undefined)
  useErrorToast(recordsQuery.error ?? undefined)

  const chips = [
    { value: CURRENT_BATCH_VALUE, label: batches[0]?.name ?? t("credits.batch") },
    { value: "all", label: t("credits.allBatches") },
    ...batches.slice(1).map((item) => ({ value: item.batchId, label: item.name })),
  ]
  const activeValue = batch ?? CURRENT_BATCH_VALUE
  const activeLabel = chips.find((chip) => chip.value === activeValue)?.label ?? t("credits.batch")

  return (
    <div className="flex flex-col gap-4">
      {batches.length > 0 && (
        <>
          <div className="flex justify-end md:hidden">
            <FilterTrigger label={activeLabel} onClick={() => onFilterDrawerOpenChange(true)} />
          </div>
          <div className="hidden md:block">
            <FilterChips
              items={chips}
              value={activeValue}
              onChange={(val) => onBatchChange(val === CURRENT_BATCH_VALUE ? undefined : val)}
            />
          </div>
        </>
      )}

      <FilterDrawer
        open={filterDrawerOpen}
        onOpenChange={onFilterDrawerOpenChange}
        title={t("credits.recordsTab")}
      >
        <FilterOptionList
          items={chips}
          value={activeValue}
          onChange={(val) => {
            onBatchChange(val === CURRENT_BATCH_VALUE ? undefined : val)
            onFilterDrawerOpenChange(false)
          }}
        />
      </FilterDrawer>

      {(recordsQuery.isLoading || recordsQuery.isRefreshing) && records.length === 0 ? (
        <LoadingCards />
      ) : records.length === 0 ? (
        <EmptyState title={t("credits.noRecords")} />
      ) : (
        <ValidatingList validating={recordsQuery.isRefreshing} className="flex flex-col gap-4">
          {batch === "all"
            ? Object.entries(
                records.reduce<Record<string, CreditRecord[]>>((groups, record) => {
                  const key = record.batch || t("credits.unknownBatch")
                  const bucket = groups[key]
                  if (bucket) {
                    bucket.push(record)
                  } else {
                    groups[key] = [record]
                  }
                  return groups
                }, {})
              ).map(([batchName, list], gi) => (
                <RecordGroup
                  key={batchName}
                  title={batchName}
                  records={list}
                  defaultOpen={gi === 0}
                  t={t}
                />
              ))
            : records.map((record, idx) => (
                <RecordCard
                  key={`${record.itemName}-${record.batch ?? ""}-${idx}`}
                  record={record}
                  t={t}
                />
              ))}
        </ValidatingList>
      )}
    </div>
  )
}

interface CatalogDisplayItem {
  readonly key: string
  readonly title: string
  readonly subtitle: string
  readonly badge?: string
}

function CatalogPanel<T>({
  keywordDraft,
  page,
  onKeywordDraftChange,
  onSearch,
  onPageChange,
  useCatalog,
  emptyTitle,
  mapItems,
  t,
}: {
  readonly keywordDraft: string
  readonly page: number
  readonly onKeywordDraftChange: (value: string) => void
  readonly onSearch: () => void
  readonly onPageChange: (nextPage: number) => void
  readonly useCatalog: () => QuerySnapshot<CatalogPage<T>>
  readonly emptyTitle: string
  readonly mapItems: (items: readonly T[]) => readonly CatalogDisplayItem[]
  readonly t: Translator<CreditsDictionary>
}): ReactNode {
  const query = useCatalog()
  useErrorToast(query.error ?? undefined)

  const items = query.data ? mapItems(query.data.items) : []
  const totalPages = query.data?.totalPages ?? 1
  const current = query.data?.pageIndex ?? page
  const loading = query.isLoading || query.isRefreshing

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Input
          name="credits-search"
          value={keywordDraft}
          onChange={(event) => onKeywordDraftChange(event.target.value)}
          placeholder={t("credits.searchPlaceholder")}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              onSearch()
            }
          }}
        />
        <Button type="button" onClick={onSearch} disabled={loading}>
          {loading ? <Spinner data-icon="inline-start" /> : <Search data-icon="inline-start" />}
          {t("credits.search")}
        </Button>
      </div>

      {loading && items.length === 0 ? (
        <LoadingCards />
      ) : items.length === 0 ? (
        <EmptyState title={emptyTitle} />
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {items.map((item) => (
              <Card key={item.key}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{item.title}</CardTitle>
                    {item.badge && <Badge variant="secondary">{item.badge}</Badge>}
                  </div>
                  <CardDescription>{item.subtitle}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={current <= 1 || loading}
                onClick={() => onPageChange(Math.max(1, current - 1))}
              >
                <ChevronLeft data-icon="inline-start" />
                {t("credits.prevPage")}
              </Button>
              <span className="text-sm text-muted-foreground tabular-nums">
                {t("credits.pageInfo", { current, total: totalPages })}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={current >= totalPages || loading}
                onClick={() => onPageChange(current + 1)}
              >
                {t("credits.nextPage")}
                <ChevronRight data-icon="inline-end" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export const CreditsPage: SlotComponent<CreditsPageProps> = (props) => {
  const {
    t,
    useStore,
    actions,
    useSummary,
    useBatches,
    useDeclarations,
    useRecords,
    useCompetitions,
    useActivities,
  } = props

  const tab = useStore((s) => s.tab)
  const batch = useStore((s) => s.batch)
  const filterDrawerOpen = useStore((s) => s.filterDrawerOpen)
  const competitionsKeywordDraft = useStore((s) => s.competitionsKeywordDraft)
  const competitionsPage = useStore((s) => s.competitionsPage)
  const activitiesKeywordDraft = useStore((s) => s.activitiesKeywordDraft)
  const activitiesPage = useStore((s) => s.activitiesPage)

  const summaryQuery = useSummary()
  const summary = summaryQuery.data
  useErrorToast(summaryQuery.error ?? undefined)

  return (
    <div className="flex flex-col gap-6" data-credits-page="">
      <Card>
        <CardContent className="py-4">
          {summaryQuery.isLoading && !summary ? (
            <div className="flex gap-8">
              <Skeleton className="h-12 w-24" />
              <Skeleton className="h-12 w-24" />
            </div>
          ) : summary ? (
            <div className="flex gap-8">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t("credits.totalCredits")}</span>
                <span className="text-2xl font-semibold tabular-nums">
                  {summary.totalCredits ?? "-"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t("credits.grade")}</span>
                <span className="text-2xl font-semibold">{summary.grade || "-"}</span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={actions.setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="records">{t("credits.recordsTab")}</TabsTrigger>
          <TabsTrigger value="declarations">{t("credits.declarationsTab")}</TabsTrigger>
          <TabsTrigger value="competitions">{t("credits.competitionsTab")}</TabsTrigger>
          <TabsTrigger value="activities">{t("credits.activitiesTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="mt-4">
          <RecordsPanel
            batch={batch}
            filterDrawerOpen={filterDrawerOpen}
            onBatchChange={actions.setBatch}
            onFilterDrawerOpenChange={actions.setFilterDrawerOpen}
            useBatches={useBatches}
            useRecords={useRecords}
            t={t}
          />
        </TabsContent>

        <TabsContent value="declarations" className="mt-4">
          <DeclarationsPanel useDeclarations={useDeclarations} t={t} />
        </TabsContent>

        <TabsContent value="competitions" className="mt-4">
          <CatalogPanel<Competition>
            keywordDraft={competitionsKeywordDraft}
            page={competitionsPage}
            onKeywordDraftChange={actions.setCompetitionsKeywordDraft}
            onSearch={actions.searchCompetitions}
            onPageChange={actions.setCompetitionsPage}
            useCatalog={useCompetitions}
            emptyTitle={t("credits.noCompetitions")}
            mapItems={(items) =>
              items.map((item) => ({
                key: item.code || item.name,
                title: item.name,
                subtitle: [item.code, item.categoryMajor, item.categoryMinor]
                  .filter(Boolean)
                  .join(" · "),
                ...(item.isEnabled === false ? { badge: t("credits.disabled") } : {}),
              }))
            }
            t={t}
          />
        </TabsContent>

        <TabsContent value="activities" className="mt-4">
          <CatalogPanel<LibraryActivity>
            keywordDraft={activitiesKeywordDraft}
            page={activitiesPage}
            onKeywordDraftChange={actions.setActivitiesKeywordDraft}
            onSearch={actions.searchActivities}
            onPageChange={actions.setActivitiesPage}
            useCatalog={useActivities}
            emptyTitle={t("credits.noActivities")}
            mapItems={(items) =>
              items.map((item, idx) => ({
                key: `${item.name}-${idx}`,
                title: item.name,
                subtitle: [item.organizer, item.category].filter(Boolean).join(" · "),
              }))
            }
            t={t}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
