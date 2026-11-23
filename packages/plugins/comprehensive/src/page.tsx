import { useEffect, useMemo, type ReactNode } from "react"
import type {
  ComprehensiveIndicatorDetail,
  ComprehensiveRadarItem,
  ComprehensiveReportPage,
  ComprehensiveReportYears,
  ComprehensiveResult,
  ComprehensiveTerm,
  ComprehensiveYearScore,
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  FilterChips,
  FilterDrawer,
  FilterOptionList,
  LoadingCards,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useErrorToast,
  ValidatingList,
} from "@orahako/ui-primitives"
import type { ComprehensiveDictionary } from "./dictionary"
import {
  computeRadarPercent,
  formatTermLabel,
  formatTermValue,
  type ComprehensiveTermSelection,
} from "./sources"
import type { ComprehensiveViewStoreInstance } from "./view-store"

export interface ComprehensivePageInject {
  readonly hooks: {
    readonly terms: ObservableSource<QuerySnapshot<ComprehensiveTerm[]>>
    readonly selectedTerm: ObservableSource<ComprehensiveTermSelection | null>
    readonly result: ObservableSource<QuerySnapshot<ComprehensiveResult>>
    readonly indicators: ObservableSource<QuerySnapshot<ComprehensiveIndicatorDetail[]>>
    readonly radar: ObservableSource<QuerySnapshot<ComprehensiveRadarItem[]>>
    readonly yearScores: ObservableSource<QuerySnapshot<ComprehensiveYearScore[]>>
    readonly reportYears: ObservableSource<QuerySnapshot<ComprehensiveReportYears>>
    readonly selectedReportYear: ObservableSource<string | null>
    readonly report: ObservableSource<QuerySnapshot<ComprehensiveReportPage>>
  }
  readonly selectTerm: (term: ComprehensiveTermSelection) => void
  readonly selectReportYear: (year: string) => void
}

export type ComprehensivePageProps = DerivedComponentProps<
  Record<string, never>,
  ComprehensiveDictionary,
  undefined,
  ComprehensiveViewStoreInstance,
  ComprehensivePageInject
>

function ResultPanel({
  useResult,
  useIndicators,
  t,
}: {
  readonly useResult: ComprehensivePageProps["useResult"]
  readonly useIndicators: ComprehensivePageProps["useIndicators"]
  readonly t: Translator<ComprehensiveDictionary>
}): ReactNode {
  const resultQuery = useResult()
  const indicatorsQuery = useIndicators()
  const result = resultQuery.data
  const indicators = indicatorsQuery.data ?? []

  useErrorToast(resultQuery.error ?? undefined, t("updating"))
  useErrorToast(indicatorsQuery.error ?? undefined, t("updating"))

  if (resultQuery.isLoading && !result) return <LoadingCards />
  if (!result) return <EmptyState title={t("comprehensive.noResult")} />

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex gap-8 py-5">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("comprehensive.totalScore")}</span>
            <span className="text-2xl font-semibold tabular-nums">{result.totalScore || "-"}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("comprehensive.classRank")}</span>
            <span className="text-2xl font-semibold tabular-nums">
              {result.classRank || "-"}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                / {result.classSize || "-"}
              </span>
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">{t("comprehensive.gradeRank")}</span>
            <span className="text-2xl font-semibold tabular-nums">
              {result.gradeRank || "-"}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                / {result.gradeSize || "-"}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>

      {indicators.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-muted-foreground">
            {t("comprehensive.indicatorsTitle")}
          </h3>
          {indicators.map((ind, idx) => {
            const rank = result.indicators.find((item) => item.name === ind.name)?.rank
            return (
              <Card key={`${ind.name}-${idx}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="text-base">{ind.name}</CardTitle>
                      <CardDescription>
                        {[
                          rank ? `${t("comprehensive.rank")}: ${rank}` : "",
                          ind.maxScore ? `${t("comprehensive.maxScore")}: ${ind.maxScore}` : "",
                          ind.proportion
                            ? `${t("comprehensive.proportion")}: ${ind.proportion}`
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </CardDescription>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-lg font-semibold tabular-nums">{ind.score || "-"}</span>
                      {ind.categoryDisplay && (
                        <Badge variant="outline">{ind.categoryDisplay}</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                {ind.description && (
                  <CardContent className="text-sm text-muted-foreground">
                    {ind.description}
                  </CardContent>
                )}
              </Card>
            )
          })}
        </>
      )}
    </div>
  )
}

function RadarPanel({
  useRadar,
  t,
}: {
  readonly useRadar: ComprehensivePageProps["useRadar"]
  readonly t: Translator<ComprehensiveDictionary>
}): ReactNode {
  const radarQuery = useRadar()
  const items = radarQuery.data ?? []
  useErrorToast(radarQuery.error ?? undefined, t("updating"))

  if (radarQuery.isLoading && items.length === 0) return <LoadingCards />
  if (items.length === 0) return <EmptyState title={t("comprehensive.noRadar")} />

  return (
    <ValidatingList validating={radarQuery.isRefreshing}>
      <Card>
        <CardContent className="flex flex-col gap-5 py-5">
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-full bg-primary" />
              {t("comprehensive.personal")}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-0.5 bg-foreground/60" />
              {t("comprehensive.average")}
            </span>
          </div>
          {items.map((item, idx) => {
            const personal = parseFloat(item.personal) || 0
            const average = parseFloat(item.average) || 0
            const max = parseFloat(item.maxScore) || 0
            return (
              <div key={`${item.name}-${idx}`} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{item.name}</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {item.personal || "-"}
                    <span className="text-xs font-normal text-muted-foreground">
                      {" "}
                      / {item.maxScore || "-"}
                    </span>
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${computeRadarPercent(personal, max)}%` }}
                  />
                  {max > 0 && average > 0 && (
                    <div
                      className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/60"
                      style={{ left: `${computeRadarPercent(average, max)}%` }}
                    />
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {t("comprehensive.average")}: {item.average || "-"}
                </span>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </ValidatingList>
  )
}

function YearsPanel({
  useYearScores,
  t,
}: {
  readonly useYearScores: ComprehensivePageProps["useYearScores"]
  readonly t: Translator<ComprehensiveDictionary>
}): ReactNode {
  const query = useYearScores()
  const items = query.data ?? []
  useErrorToast(query.error ?? undefined, t("updating"))

  if (query.isLoading && items.length === 0) return <LoadingCards />
  if (items.length === 0) return <EmptyState title={t("comprehensive.noYearScores")} />

  return (
    <ValidatingList validating={query.isRefreshing}>
      <Card>
        <CardContent className="flex flex-col py-1">
          {items.map((item, idx) => (
            <div
              key={`${item.year}-${item.term}-${idx}`}
              className={`flex items-center justify-between py-3 ${
                idx > 0 ? "border-t border-border" : ""
              }`}
            >
              <span className="text-sm">
                {[item.yearDisplay, item.termDisplay].filter(Boolean).join(" ") ||
                  `${item.year}-${item.term}`}
              </span>
              <span className="text-base font-semibold tabular-nums">{item.score || "-"}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </ValidatingList>
  )
}

function ReportPanel({
  useReportYears,
  useSelectedReportYear,
  useReport,
  selectReportYear,
  t,
}: {
  readonly useReportYears: ComprehensivePageProps["useReportYears"]
  readonly useSelectedReportYear: ComprehensivePageProps["useSelectedReportYear"]
  readonly useReport: ComprehensivePageProps["useReport"]
  readonly selectReportYear: (year: string) => void
  readonly t: Translator<ComprehensiveDictionary>
}): ReactNode {
  const yearsQuery = useReportYears()
  const selectedYear = useSelectedReportYear()
  const reportQuery = useReport()

  const years = useMemo(() => yearsQuery.data?.years ?? [], [yearsQuery.data])
  const entries = reportQuery.data?.entries ?? []

  useErrorToast(yearsQuery.error ?? undefined, t("updating"))
  useErrorToast(reportQuery.error ?? undefined, t("updating"))

  return (
    <div className="flex flex-col gap-4">
      {years.length > 0 && (
        <FilterChips
          items={years.map((y) => ({
            value: y.year,
            label: y.yearDisplay || y.year,
          }))}
          value={selectedYear ?? undefined}
          onChange={selectReportYear}
        />
      )}

      {(yearsQuery.isLoading || reportQuery.isLoading || reportQuery.isRefreshing) &&
      entries.length === 0 ? (
        <LoadingCards />
      ) : entries.length === 0 ? (
        <EmptyState title={t("comprehensive.noReport")} />
      ) : (
        <ValidatingList validating={reportQuery.isRefreshing}>
          <Card>
            <CardContent className="flex flex-col py-1">
              {entries.map((entry, idx) => (
                <div
                  key={`${entry.courseName}-${idx}`}
                  className={`flex items-center justify-between gap-2 py-3 ${
                    idx > 0 ? "border-t border-border" : ""
                  }`}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{entry.courseName}</span>
                    {entry.credit && (
                      <span className="text-xs text-muted-foreground">
                        {t("comprehensive.credit")}: {entry.credit}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-base font-semibold tabular-nums">
                    {entry.score || "-"}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </ValidatingList>
      )}
    </div>
  )
}

export const ComprehensivePage: SlotComponent<ComprehensivePageProps> = (props) => {
  const { t, actions, useStore } = props
  const tab = useStore((state) => state.tab)
  const filterDrawerOpen = useStore((state) => state.filterDrawerOpen)
  const { setTab, setFilterDrawerOpen, reset } = actions

  useEffect(() => {
    reset()
  }, [reset])

  const termsQuery = props.useTerms()
  const selected = props.useSelectedTerm()
  const terms = useMemo(() => termsQuery.data ?? [], [termsQuery.data])

  useErrorToast(termsQuery.error ?? undefined, t("updating"))

  const termItems = terms.map((item) => ({
    value: formatTermValue(item),
    label: formatTermLabel(item),
  }))

  const handleSelectTermValue = (value: string): void => {
    const matched = terms.find((item) => formatTermValue(item) === value)
    if (matched) {
      props.selectTerm({ year: matched.year, term: matched.term })
    }
  }

  if (termsQuery.isLoading && terms.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10" />
        <LoadingCards />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {terms.length === 0 ? (
        <EmptyState title={t("comprehensive.noTerms")} />
      ) : (
        <div className="hidden md:block">
          <FilterChips
            items={termItems}
            value={selected ? formatTermValue(selected) : undefined}
            onChange={handleSelectTermValue}
          />
        </div>
      )}

      <FilterDrawer
        open={filterDrawerOpen}
        onOpenChange={setFilterDrawerOpen}
        title={t("comprehensive.title")}
      >
        <FilterOptionList
          items={termItems}
          value={selected ? formatTermValue(selected) : undefined}
          onChange={(value) => {
            handleSelectTermValue(value)
            setFilterDrawerOpen(false)
          }}
        />
      </FilterDrawer>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger
            value="result"
            data-comprehensive-tab="result"
            onClick={() => setTab("result")}
          >
            {t("comprehensive.resultTab")}
          </TabsTrigger>
          <TabsTrigger value="radar" data-comprehensive-tab="radar" onClick={() => setTab("radar")}>
            {t("comprehensive.radarTab")}
          </TabsTrigger>
          <TabsTrigger value="years" data-comprehensive-tab="years" onClick={() => setTab("years")}>
            {t("comprehensive.yearsTab")}
          </TabsTrigger>
          <TabsTrigger
            value="report"
            data-comprehensive-tab="report"
            onClick={() => setTab("report")}
          >
            {t("comprehensive.reportTab")}
          </TabsTrigger>
        </TabsList>

        {tab === "result" && selected && (
          <TabsContent value="result" className="mt-4">
            <ResultPanel useResult={props.useResult} useIndicators={props.useIndicators} t={t} />
          </TabsContent>
        )}
        {tab === "radar" && selected && (
          <TabsContent value="radar" className="mt-4">
            <RadarPanel useRadar={props.useRadar} t={t} />
          </TabsContent>
        )}
        {tab === "years" && (
          <TabsContent value="years" className="mt-4">
            <YearsPanel useYearScores={props.useYearScores} t={t} />
          </TabsContent>
        )}
        {tab === "report" && (
          <TabsContent value="report" className="mt-4">
            <ReportPanel
              useReportYears={props.useReportYears}
              useSelectedReportYear={props.useSelectedReportYear}
              useReport={props.useReport}
              selectReportYear={props.selectReportYear}
              t={t}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
