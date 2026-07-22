"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  EmptyState,
  LoadingCards,
  useErrorToast,
} from "@/components/academic/list-state";
import { FilterChips } from "@/components/academic/filter-chips";
import { useTranslation } from "@/lib/i18n/use-translation";
import {
  useComprehensiveIndicators,
  useComprehensiveRadar,
  useComprehensiveReport,
  useComprehensiveReportYears,
  useComprehensiveResult,
  useComprehensiveTerms,
  useComprehensiveYearScores,
} from "@/providers/hooks";

function ResultPanel({ year, term }: { year: string; term: string }) {
  const { t } = useTranslation();
  const opts = useMemo(() => ({ year, term }), [year, term]);
  const resultQuery = useComprehensiveResult(opts);
  const indicatorsQuery = useComprehensiveIndicators(opts);
  const result = resultQuery.data;
  const indicators = indicatorsQuery.data ?? [];

  useErrorToast(resultQuery.error);
  useErrorToast(indicatorsQuery.error);

  if (resultQuery.isLoading && !result) return <LoadingCards />;
  if (!result) return <EmptyState title={t("comprehensive.noResult")} description={t("comprehensive.description")} />;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex gap-8 py-5">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">
              {t("comprehensive.totalScore")}
            </span>
            <span className="text-2xl font-semibold">{result.totalScore || "-"}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">
              {t("comprehensive.classRank")}
            </span>
            <span className="text-2xl font-semibold">
              {result.classRank || "-"}
              <span className="text-sm font-normal text-muted-foreground">
                {" "}
                / {result.classSize || "-"}
              </span>
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">
              {t("comprehensive.gradeRank")}
            </span>
            <span className="text-2xl font-semibold">
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
            const rank = result.indicators.find((i) => i.name === ind.name)?.rank;
            return (
            <Card key={`${ind.name}-${idx}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{ind.name}</CardTitle>
                  <div className="flex shrink-0 gap-1">
                    {ind.categoryDisplay && (
                      <Badge variant="outline">{ind.categoryDisplay}</Badge>
                    )}
                    <Badge variant="secondary">
                      {t("comprehensive.score")}: {ind.score}
                    </Badge>
                  </div>
                </div>
                <CardDescription>
                  {[
                    rank ? `${t("comprehensive.rank")}: ${rank}` : "",
                    ind.maxScore ? `${t("comprehensive.maxScore")}: ${ind.maxScore}` : "",
                    ind.proportion ? `${t("comprehensive.proportion")}: ${ind.proportion}` : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </CardDescription>
              </CardHeader>
              {ind.description && (
                <CardContent className="text-sm text-muted-foreground">
                  {ind.description}
                </CardContent>
              )}
            </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

function RadarPanel({ year, term }: { year: string; term: string }) {
  const { t } = useTranslation();
  const opts = useMemo(() => ({ year, term }), [year, term]);
  const radarQuery = useComprehensiveRadar(opts);
  const items = radarQuery.data ?? [];
  useErrorToast(radarQuery.error);

  if (radarQuery.isLoading && items.length === 0) return <LoadingCards />;
  if (items.length === 0) return <EmptyState title={t("comprehensive.noRadar")} description={t("comprehensive.description")} />;

  return (
    <div className="flex flex-col gap-4">
      {items.map((item, idx) => {
        const personal = parseFloat(item.personal) || 0;
        const average = parseFloat(item.average) || 0;
        const max = parseFloat(item.maxScore) || 0;
        const pct = (v: number) => (max > 0 ? Math.min(100, (v / max) * 100) : 0);
        return (
          <Card key={`${item.name}-${idx}`}>
            <CardHeader>
              <CardTitle className="text-base">{item.name}</CardTitle>
              <CardDescription>
                {t("comprehensive.personal")}: {item.personal || "-"} ·{" "}
                {t("comprehensive.average")}: {item.average || "-"} ·{" "}
                {t("comprehensive.maxScore")}: {item.maxScore || "-"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="w-10 text-xs text-muted-foreground">
                  {t("comprehensive.personal")}
                </span>
                <div className="h-2 flex-1 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${pct(personal)}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-10 text-xs text-muted-foreground">
                  {t("comprehensive.average")}
                </span>
                <div className="h-2 flex-1 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-muted-foreground/40"
                    style={{ width: `${pct(average)}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function YearsPanel() {
  const { t } = useTranslation();
  const query = useComprehensiveYearScores();
  const items = query.data ?? [];
  useErrorToast(query.error);

  if (query.isLoading && items.length === 0) return <LoadingCards />;
  if (items.length === 0) return <EmptyState title={t("comprehensive.noYearScores")} description={t("comprehensive.description")} />;

  return (
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
            <span className="text-sm font-semibold">{item.score || "-"}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ReportPanel() {
  const { t } = useTranslation();
  const [year, setYear] = useState<string | undefined>(undefined);

  const yearsQuery = useComprehensiveReportYears();
  const years = useMemo(() => yearsQuery.data?.years ?? [], [yearsQuery.data]);

  useEffect(() => {
    if (year === undefined && yearsQuery.data) {
      setYear(yearsQuery.data.defaultYear || years[0]?.year);
    }
  }, [yearsQuery.data, years, year]);

  const reportQuery = useComprehensiveReport(year ? { year } : undefined);
  const entries = reportQuery.data?.entries ?? [];

  useErrorToast(yearsQuery.error);
  useErrorToast(reportQuery.error);

  return (
    <div className="flex flex-col gap-4">
      {years.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {years.map((y) => (
            <button
              key={y.year}
              type="button"
              onClick={() => setYear(y.year)}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                year === y.year
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground active:bg-muted/60"
              }`}
            >
              {y.yearDisplay || y.year}
            </button>
          ))}
        </div>
      )}

      {(reportQuery.isLoading || reportQuery.isValidating) && entries.length === 0 ? (
        <LoadingCards />
      ) : entries.length === 0 ? (
        <EmptyState title={t("comprehensive.noReport")} description={t("comprehensive.description")} />
      ) : (
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
                <span className="shrink-0 text-sm font-semibold">{entry.score || "-"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ComprehensivePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("result");
  const [selected, setSelected] = useState<{ year: string; term: string }>();

  const termsQuery = useComprehensiveTerms();
  const terms = useMemo(() => termsQuery.data ?? [], [termsQuery.data]);

  useEffect(() => {
    if (!selected && terms.length > 0) {
      setSelected({ year: terms[0]!.year, term: terms[0]!.term });
    }
  }, [terms, selected]);

  useErrorToast(termsQuery.error);

  if (termsQuery.isLoading && terms.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10" />
        <LoadingCards />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {terms.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("comprehensive.noTerms")}</p>
      ) : (
        <FilterChips
          items={terms.map((item) => ({
            value: `${item.year}-${item.term}`,
            label:
              [item.yearDisplay, item.termDisplay].filter(Boolean).join(" ") ||
              `${item.year}-${item.term}`,
          }))}
          value={selected ? `${selected.year}-${selected.term}` : undefined}
          onChange={(v) => {
            const item = terms.find((x) => `${x.year}-${x.term}` === v);
            if (item) setSelected({ year: item.year, term: item.term });
          }}
        />
      )}

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
  );
}
