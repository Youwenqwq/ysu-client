import type { MouseEvent, ReactNode } from "react"
import { ChevronRight, ClipboardCheck } from "lucide-react"
import {
  isProviderError,
  ProviderErrorCode,
  type EvaluationTask,
  type QuerySnapshot,
} from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  SlotComponent,
  Translator,
} from "@orahako/sdk"
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  useIsMobile,
} from "@orahako/ui-primitives"
import type { EvaluationDictionary } from "./dictionary"
import { isEvaluationTaskActive } from "./helpers"

export const PENDING_EVALUATIONS_WIDGET_ID = "pending-evaluations"
export const EVALUATION_SUMMARY_WIDGET_ID = "evaluation-summary"

function hasErrorCode(error: Error | null, code: ProviderErrorCode): boolean {
  if (!error) return false
  if (isProviderError(error)) return error.code === code
  return "code" in error && error.code === code
}

function WidgetQueryState({
  query,
  t,
  children,
}: {
  readonly query: QuerySnapshot<EvaluationTask[]>
  readonly t: Translator<EvaluationDictionary>
  readonly children: ReactNode
}): ReactNode {
  const missing = query.data === undefined
  const hasError = query.error !== null
  const authExpired =
    hasErrorCode(query.error, ProviderErrorCode.AUTH_SESSION_EXPIRED) ||
    hasErrorCode(query.error, ProviderErrorCode.AUTH_REQUIRED)
  const unsupported = hasErrorCode(query.error, ProviderErrorCode.FEATURE_NOT_SUPPORTED)

  if (missing && query.isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-label={t("widget.loading")}>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-full" />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {hasError && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              {t(
                unsupported
                  ? "widget.unsupported"
                  : authExpired
                    ? "widget.sessionExpired"
                    : query.isStale || !missing
                      ? "widget.stale"
                      : "widget.failed"
              )}
            </span>
            {!unsupported && !authExpired && (
              <Button
                size="sm"
                variant="ghost"
                disabled={query.isRefreshing}
                onClick={() => void query.refresh()}
              >
                {t("widget.retry")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {!missing
        ? children
        : !hasError && <p className="text-sm text-muted-foreground">{t("widget.loading")}</p>}
      {query.isStale && !hasError && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("widget.stale")}
        </p>
      )}
    </div>
  )
}

export interface PendingEvaluationsWidgetInject {
  readonly hooks: {
    readonly tasks: ObservableSource<QuerySnapshot<EvaluationTask[]>>
  }
  readonly evaluationHref: string
  readonly openEvaluation: () => void
}

export type PendingEvaluationsWidgetProps = DerivedComponentProps<
  Record<string, never>,
  EvaluationDictionary,
  undefined,
  undefined,
  PendingEvaluationsWidgetInject
>

function handleSpaClick(event: MouseEvent<HTMLAnchorElement>, navigate: () => void): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return
  }
  event.preventDefault()
  navigate()
}

export const PendingEvaluationsWidget: SlotComponent<PendingEvaluationsWidgetProps> = (props) => {
  const { t } = props
  const query = props.useTasks()
  const activeTasks = (query.data ?? []).filter((task) => isEvaluationTaskActive(task))

  if (query.data !== undefined && query.error === null && activeTasks.length === 0) {
    return null
  }

  return (
    <Card data-overview-wide="">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-primary" />
          {t("widget.cardTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <WidgetQueryState query={query} t={t}>
          <a
            href={props.evaluationHref}
            data-evaluation-widget-link=""
            onClick={(event) => handleSpaClick(event, props.openEvaluation)}
            className="flex items-center gap-3 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex-1 text-sm">
              {t("widget.pendingEvaluation", { count: activeTasks.length })}
            </span>
            <ChevronRight className="size-4 shrink-0" />
          </a>
        </WidgetQueryState>
      </CardContent>
    </Card>
  )
}

export type EvaluationSummaryWidgetProps = PendingEvaluationsWidgetProps

export const EvaluationSummaryWidget: SlotComponent<EvaluationSummaryWidgetProps> = (props) => {
  const { t, evaluationHref, openEvaluation } = props
  const query = props.useTasks()
  const compact = useIsMobile()
  const count = (query.data ?? []).filter((task) => isEvaluationTaskActive(task)).length

  if (compact) {
    return (
      <a
        href={evaluationHref}
        data-overview-evaluation-summary="compact"
        onClick={(event) => handleSpaClick(event, openEvaluation)}
        className="flex min-w-0 flex-col gap-1 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <ClipboardCheck className="size-3.5 shrink-0" />
          <span className="truncate">{t("widget.summaryTitle")}</span>
        </span>
        {query.data === undefined && query.isLoading ? (
          <Skeleton className="h-6 w-14" aria-label={t("widget.loading")} />
        ) : query.data === undefined ? (
          <span className="text-sm text-muted-foreground">{t("widget.unavailableShort")}</span>
        ) : (
          <span className="text-base font-semibold tabular-nums">{count}</span>
        )}
      </a>
    )
  }

  return (
    <Card data-overview-evaluation-summary="card" size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="size-4 shrink-0 text-primary" />
          {t("widget.summaryTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <WidgetQueryState query={query} t={t}>
          <a
            href={evaluationHref}
            onClick={(event) => handleSpaClick(event, openEvaluation)}
            className="flex flex-col gap-1 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-2xl font-semibold tabular-nums">{count}</span>
            <span className="text-xs text-muted-foreground">
              {t(count > 0 ? "evaluation.pendingTasks" : "evaluation.noTasks")}
            </span>
          </a>
        </WidgetQueryState>
      </CardContent>
    </Card>
  )
}
