"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  EmptyState,
  LoadingCards,
  useErrorToast,
  ValidatingList,
} from "@/components/academic/list-state"
import { FilterChips } from "@/components/academic/filter-chips"
import { FilterDrawer, FilterOptionList, FilterTrigger } from "@/components/academic/filter-drawer"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useMobileHeaderRight } from "@/lib/stores/mobile-header"
import {
  useComprehensiveIndicators,
  useComprehensiveRadar,
  useComprehensiveReport,
  useComprehensiveReportYears,
  useComprehensiveResult,
  useComprehensiveTerms,
  useComprehensiveYearScores,
} from "@/providers/hooks"

function ResultPanel({ year, term }: { year: string; term: string }) {
  const { t } = useTranslation()
  const opts = useMemo(() => ({ year, term }), [year, term])
  const resultQuery = useComprehensiveResult(opts)
  const indicatorsQuery = useComprehensiveIndicators(opts)
  const result = resultQuery.data
  const indicators = indicatorsQuery.data ?? []

  useErrorToast(resultQuery.error)
  useErrorToast(indicatorsQuery.error)

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
            const rank = result.indicators.find((i) => i.name === ind.name)?.rank
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

function RadarPanel({ year, term }: { year: string; term: string }) {
  const { t } = useTranslation()
  const opts = useMemo(() => ({ year, term }), [year, term])
  const radarQuery = useComprehensiveRadar(opts)
  const items = radarQuery.data ?? []
  useErrorToast(radarQuery.error)

  if (radarQuery.isLoading && items.length === 0) return <LoadingCards />
  if (items.length === 0) return <EmptyState title={t("comprehensive.noRadar")} />

  return (
    <ValidatingList validating={radarQuery.isValidating}>
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
            const pct = (v: number) => (max > 0 ? Math.min(100, (v / max) * 100) : 0)
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
                    style={{ width: `${pct(personal)}%` }}
                  />
                  {max > 0 && average > 0 && (
                    <div
                      className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground/60"
                      style={{ left: `${pct(average)}%` }}
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

function YearsPanel() {
  const { t } = useTranslation()
  const query = useComprehensiveYearScores()
  const items = query.data ?? []
  useErrorToast(query.error)

  if (query.isLoading && items.length === 0) return <LoadingCards />
  if (items.length === 0) return <EmptyState title={t("comprehensive.noYearScores")} />

  return (
    <ValidatingList validating={query.isValidating}>
      <Card>
        <CardContent className="flex flex-col py-1">
          {items.map((item, idx) => (
            <div
              key={`${item.year}-${item.term}`}
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

function ReportPanel() {
  const { t } = useTranslation()
  const [year, setYear] = useState<string | undefined>(undefined)

  const yearsQuery = useComprehensiveReportYears()
  const years = useMemo(() => yearsQuery.data?.years ?? [], [yearsQuery.data])

  useEffect(() => {
    if (year === undefined && yearsQuery.data) {
      setYear(yearsQuery.data.defaultYear || years[0]?.year)
    }
  }, [yearsQuery.data, years, year])

  const reportQuery = useComprehensiveReport(year ? { year } : undefined, year !== undefined)
  const entries = reportQuery.data?.entries ?? []

  useErrorToast(yearsQuery.error)
  useErrorToast(reportQuery.error)

  return (
    <div className="flex flex-col gap-4">
      {years.length > 0 && (
        <FilterChips
          items={years.map((y) => ({
            value: y.year,
            label: y.yearDisplay || y.year,
          }))}
          value={year}
          onChange={setYear}
        />
      )}

      {(reportQuery.isLoading || reportQuery.isValidating) && entries.length === 0 ? (
        <LoadingCards />
      ) : entries.length === 0 ? (
        <EmptyState title={t("comprehensive.noReport")} />
      ) : (
        <ValidatingList validating={reportQuery.isValidating}>
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

export default function ComprehensivePage() {
  const { t } = useTranslation()
  const [tab, setTab] = useState("result")
  const [selected, setSelected] = useState<{ year: string; term: string }>()
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)

  const termsQuery = useComprehensiveTerms()
  const terms = useMemo(() => termsQuery.data ?? [], [termsQuery.data])

  useEffect(() => {
    if (!selected && terms.length > 0) {
      setSelected({ year: terms[0]!.year, term: terms[0]!.term })
    }
  }, [terms, selected])

  useErrorToast(termsQuery.error)

  const termLabel = (item: (typeof terms)[number]) =>
    [item.yearDisplay, item.termDisplay].filter(Boolean).join(" ") || `${item.year}-${item.term}`
  const selectedItem = terms.find(
    (x) => selected && x.year === selected.year && x.term === selected.term
  )
  const termItems = terms.map((item) => ({
    value: `${item.year}-${item.term}`,
    label: termLabel(item),
  }))

  // 年学期筛选只作用于成绩/指标对比两个面板
  useMobileHeaderRight(
    tab === "result" || tab === "radar" ? (
      <FilterTrigger
        label={selectedItem ? termLabel(selectedItem) : t("comprehensive.title")}
        onClick={() => setFilterDrawerOpen(true)}
      />
    ) : null,
    [tab, selectedItem, terms, t]
  )

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
            value={selected ? `${selected.year}-${selected.term}` : undefined}
            onChange={(v) => {
              const item = terms.find((x) => `${x.year}-${x.term}` === v)
              if (item) setSelected({ year: item.year, term: item.term })
            }}
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
          value={selected ? `${selected.year}-${selected.term}` : undefined}
          onChange={(v) => {
            const item = terms.find((x) => `${x.year}-${x.term}` === v)
            if (item) setSelected({ year: item.year, term: item.term })
            setFilterDrawerOpen(false)
          }}
        />
      </FilterDrawer>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="result">{t("comprehensive.resultTab")}</TabsTrigger>
          <TabsTrigger value="radar">{t("comprehensive.radarTab")}</TabsTrigger>
          <TabsTrigger value="years">{t("comprehensive.yearsTab")}</TabsTrigger>
          <TabsTrigger value="report">{t("comprehensive.reportTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="result" className="mt-4">
          {selected && <ResultPanel year={selected.year} term={selected.term} />}
        </TabsContent>
        <TabsContent value="radar" className="mt-4">
          {selected && <RadarPanel year={selected.year} term={selected.term} />}
        </TabsContent>
        <TabsContent value="years" className="mt-4">
          <YearsPanel />
        </TabsContent>
        <TabsContent value="report" className="mt-4">
          <ReportPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
