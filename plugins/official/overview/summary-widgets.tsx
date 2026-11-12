"use client"

import Link from "next/link"
import { BarChart3, Calendar, ClipboardCheck, Eye, EyeOff } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useSettingsStore } from "@/lib/stores/settings"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useGPAStats, type ProviderQueryResult } from "@/providers/hooks"
import type { EvaluationTask } from "@/providers/types"
import { useIsMobile } from "@/hooks/use-mobile"
import { QueryState } from "./query-state"
import { useOverviewEvaluation, useOverviewScheduleData } from "./context"
import type { OverviewSchedule } from "./use-overview-schedule"
import { pluginPageHref } from "@ysu/plugin-sdk"

function WeekSummary({ data, compact }: { data: OverviewSchedule; compact: boolean }) {
  const { t } = useTranslation()
  const query = data.currentWeek
  if (compact)
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="size-3.5 shrink-0" />
          <span className="truncate">{t("overviewData.term")}</span>
        </span>
        <QueryState queries={[query]} compact>
          <span className="text-base font-semibold tabular-nums">
            {query.data
              ? t("dashboard.currentWeek", { week: query.data.week })
              : t("overviewData.unavailableShort")}
          </span>
        </QueryState>
      </div>
    )
  return (
    <>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="size-4 shrink-0 text-primary" />
          {t("overviewData.term")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState queries={[query]}>
          <p className="text-lg font-semibold tabular-nums">
            {query.data
              ? t("dashboard.currentWeek", { week: query.data.week })
              : t("overviewData.unavailableShort")}
          </p>
        </QueryState>
        <p className="text-xs text-muted-foreground">
          {data.date} · {t(`dashboard.weekdayNames.${data.weekday}`)}
        </p>
        <p className="text-xs text-muted-foreground">{data.semester}</p>
      </CardContent>
    </>
  )
}

function GpaSummary({ compact }: { compact: boolean }) {
  const { t } = useTranslation()
  const query = useGPAStats()
  const visible = useSettingsStore((s) => s.gpaVisible)
  const setVisible = useSettingsStore((s) => s.setGpaVisible)
  if (compact)
    return (
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        aria-label={t(visible ? "overviewData.hideGpa" : "overviewData.showGpa")}
        aria-pressed={visible}
        className="flex w-full min-w-0 flex-col gap-1 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-70"
      >
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="truncate">{t("dashboard.gpaInitial")}</span>
          {visible ? <EyeOff className="size-3 shrink-0" /> : <Eye className="size-3 shrink-0" />}
        </span>
        <QueryState queries={[query]} compact>
          <span className="text-base font-semibold tabular-nums">
            {visible ? (query.data?.gpaInitial ?? "-") : "***"}
          </span>
        </QueryState>
      </button>
    )
  return (
    <>
      <CardHeader className="flex flex-row items-center justify-between gap-1">
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="size-4 shrink-0 text-primary" />
          {t("dashboard.gpaInitial")}
        </CardTitle>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t(visible ? "overviewData.hideGpa" : "overviewData.showGpa")}
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      </CardHeader>
      <CardContent>
        <QueryState queries={[query]}>
          <p className="text-2xl font-semibold tabular-nums">
            {visible ? (query.data?.gpaInitial ?? "-") : "***"}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("dashboard.weightedAvg")} {visible ? (query.data?.weightedAvg ?? "-") : "***"}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("dashboard.arithmeticAvg")} {visible ? (query.data?.arithmeticAvg ?? "-") : "***"}
          </p>
        </QueryState>
      </CardContent>
    </>
  )
}

function EvaluationSummary({
  query,
  compact,
}: {
  query: ProviderQueryResult<EvaluationTask[]>
  compact: boolean
}) {
  const { t } = useTranslation()
  const count = (query.data ?? []).filter((task) => task.status === "active").length
  if (compact)
    return (
      <Link
        href={pluginPageHref("ysu.evaluation", "index")}
        className="flex min-w-0 flex-col gap-1 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <ClipboardCheck className="size-3.5 shrink-0" />
          <span className="truncate">{t("app.evaluation")}</span>
        </span>
        <QueryState queries={[query]} compact>
          <span className="text-base font-semibold tabular-nums">{count}</span>
        </QueryState>
      </Link>
    )
  return (
    <>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="size-4 shrink-0 text-primary" />
          {t("app.evaluation")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState queries={[query]}>
          <Link
            href={pluginPageHref("ysu.evaluation", "index")}
            className="flex flex-col gap-1 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-2xl font-semibold tabular-nums">{count}</span>
            <span className="text-xs text-muted-foreground">
              {t(count ? "overviewData.pendingTasks" : "overviewData.noPendingTasks")}
            </span>
          </Link>
        </QueryState>
      </CardContent>
    </>
  )
}

export function WeekSummaryWidget() {
  const data = useOverviewScheduleData()
  const compact = useIsMobile()
  return compact ? (
    <WeekSummary data={data} compact />
  ) : (
    <Card size="sm">
      <WeekSummary data={data} compact={false} />
    </Card>
  )
}

export function GpaSummaryWidget() {
  const compact = useIsMobile()
  return compact ? (
    <GpaSummary compact />
  ) : (
    <Card size="sm">
      <GpaSummary compact={false} />
    </Card>
  )
}

export function EvaluationSummaryWidget() {
  const query = useOverviewEvaluation()
  const compact = useIsMobile()
  return compact ? (
    <EvaluationSummary query={query} compact />
  ) : (
    <Card size="sm">
      <EvaluationSummary query={query} compact={false} />
    </Card>
  )
}
