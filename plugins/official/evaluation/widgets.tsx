"use client"

import Link from "next/link"
import { ChevronRight, ClipboardCheck } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@orahako/plugin-ui/components"
import { useIsMobile, type ProviderQueryResult } from "@orahako/plugin-ui/hooks"
import { useTranslation } from "@orahako/plugin-ui/hooks"
import type { EvaluationTask } from "@orahako/plugin-sdk/academic"
import { pluginPageHref } from "@orahako/plugin-sdk"
import { QueryState, useOverviewEvaluation } from "@orahako/academic"

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

export function EvaluationTasksWidget() {
  const { t } = useTranslation()
  const query = useOverviewEvaluation()
  const tasks = (query.data ?? []).filter((task) => task.status === "active")
  if (query.data && !query.error && tasks.length === 0) return null
  return (
    <Card data-overview-wide>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-primary" />
          {t("app.evaluation")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <QueryState queries={[query]}>
          <Link
            href={pluginPageHref("ysu.evaluation", "index")}
            className="flex items-center gap-3 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex-1 text-sm">
              {t("dashboard.pendingEvaluation", { count: tasks.length })}
            </span>
            <ChevronRight className="size-4 shrink-0" />
          </Link>
        </QueryState>
      </CardContent>
    </Card>
  )
}
