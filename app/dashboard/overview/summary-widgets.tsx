"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { BarChart3, Calendar, ClipboardCheck, Eye, EyeOff } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { useSettingsStore } from "@/lib/stores/settings"
import { useStoredMediaUrl } from "@/lib/storage/media"
import { loadAvatarImage } from "@/lib/storage/avatar"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useGPAStats, useStudentInfo, type ProviderQueryResult } from "@/providers/hooks"
import type { CurrentWeek, EvaluationTask } from "@/providers/types"
import { QueryState } from "./query-state"

export function ProfileWidget({ compact, children }: { compact: boolean; children?: ReactNode }) {
  const { t } = useTranslation()
  const student = useStudentInfo()
  const avatarImage = useSettingsStore((s) => s.avatarImage)
  const avatarUrl = useStoredMediaUrl(avatarImage, loadAvatarImage)
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <Avatar className="size-12 shrink-0">
          {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
          <AvatarFallback>{student.data?.name?.slice(-2) || "--"}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <CardTitle>{student.data?.name || t("app.studentInfo")}</CardTitle>
          <CardDescription className="truncate">
            {compact ? student.data?.department : student.data?.studentId}
          </CardDescription>
        </div>
      </CardHeader>
      {(!compact || !student.data) && (
        <CardContent>
          <QueryState queries={[student]} compact={compact}>
            <p className="text-sm text-muted-foreground">
              {[student.data?.department, student.data?.major].filter(Boolean).join(" · ")}
            </p>
          </QueryState>
        </CardContent>
      )}
      {children}
    </Card>
  )
}

export function WeekSummary({
  query,
  compact,
}: {
  query: ProviderQueryResult<CurrentWeek>
  compact: boolean
}) {
  const { t } = useTranslation()
  if (compact)
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="size-3.5 shrink-0" />
          <span className="truncate">{t("overviewData.term")}</span>
        </span>
        <QueryState queries={[query]} compact>
          <span className="text-base font-semibold tabular-nums">
            {t("dashboard.currentWeek", { week: query.data?.week ?? "-" })}
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
            {t("dashboard.currentWeek", { week: query.data?.week ?? "-" })}
          </p>
          <p className="text-xs text-muted-foreground">
            {query.data?.weekday ? t(`dashboard.weekdayNames.${query.data.weekday}`) : "-"}
          </p>
          <p className="text-xs text-muted-foreground">{query.data?.semester}</p>
        </QueryState>
      </CardContent>
    </>
  )
}

export function GpaSummary({ compact }: { compact: boolean }) {
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

export function EvaluationSummary({
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
        href="/dashboard/evaluation"
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
            href="/dashboard/evaluation"
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
