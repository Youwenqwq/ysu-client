"use client"

import { BarChart3, Calendar, Eye, EyeOff } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@orahako/plugin-ui/components"
import { Button } from "@orahako/plugin-ui/components"
import { useSettingsStore } from "@orahako/plugin-ui/stores"
import { useTranslation } from "@orahako/plugin-ui/hooks"
import { useGPAStats } from "@orahako/plugin-ui/hooks"
import { useIsMobile } from "@orahako/plugin-ui/hooks"
import { QueryState } from "@orahako/academic"
import { useOverviewScheduleData } from "@orahako/academic"
import type { OverviewSchedule } from "@orahako/academic"

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
