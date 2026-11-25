import { Calendar } from "lucide-react"
import { compareExamStartTime, formatExamTime, isExamCompleted } from "@orahako/academic-kit"
import {
  isProviderError,
  ProviderErrorCode,
  type Exam,
  type ProviderRuntimeSnapshot,
  type QuerySnapshot,
} from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "@orahako/ui-primitives"
import type { ExamsDictionary } from "./dictionary"
import { computeExamDayDiff } from "./widget-sync"

function hasErrorCode(error: Error | null, code: ProviderErrorCode): boolean {
  if (!error) return false
  if (isProviderError(error)) return error.code === code
  return "code" in error && error.code === code
}

export interface UpcomingExamsWidgetInject {
  readonly hooks: {
    readonly exams: ObservableSource<QuerySnapshot<Exam[]>>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
  readonly openExams: () => void
}

export type UpcomingExamsWidgetProps = DerivedComponentProps<
  Record<string, never>,
  ExamsDictionary,
  undefined,
  undefined,
  UpcomingExamsWidgetInject
>

export const UpcomingExamsWidget: SlotComponent<UpcomingExamsWidgetProps> = (props) => {
  const { t } = props
  const examsQuery = props.useExams()
  const providerSnap = props.useProvider()
  const now = new Date()
  const timeZone = providerSnap.provider?.timeZone

  const upcomingExams = (examsQuery.data ?? [])
    .filter((exam) => !isExamCompleted(exam, now, timeZone))
    .sort((a, b) => compareExamStartTime(a, b, timeZone))

  const error = examsQuery.error
  const authExpired =
    hasErrorCode(error, ProviderErrorCode.AUTH_SESSION_EXPIRED) ||
    hasErrorCode(error, ProviderErrorCode.AUTH_REQUIRED)
  const unsupported = hasErrorCode(error, ProviderErrorCode.FEATURE_NOT_SUPPORTED)

  return (
    <Card data-overview-upcoming-exams="">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Calendar className="size-4 text-primary" />
          {t("widgets.upcomingExams.title")}
        </CardTitle>
        <button
          type="button"
          onClick={props.openExams}
          className="rounded-sm p-1 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge variant="secondary">
            {t("widgets.upcomingExams.examCount", { count: upcomingExams.length })}
          </Badge>
        </button>
      </CardHeader>
      <CardContent>
        {examsQuery.data === undefined && examsQuery.isLoading ? (
          <div className="flex flex-col gap-2" aria-label={t("widgets.upcomingExams.loading")}>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {error && (
              <Alert>
                <AlertDescription className="flex flex-wrap items-center gap-2">
                  <span>
                    {t(
                      unsupported
                        ? "widgets.upcomingExams.unsupported"
                        : authExpired
                          ? "widgets.upcomingExams.sessionExpired"
                          : examsQuery.isStale || examsQuery.data !== undefined
                            ? "widgets.upcomingExams.stale"
                            : "widgets.upcomingExams.failed"
                    )}
                  </span>
                  {!unsupported && !authExpired && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={examsQuery.isRefreshing}
                      onClick={() => void examsQuery.refresh()}
                    >
                      {t("widgets.upcomingExams.retry")}
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {examsQuery.data !== undefined && upcomingExams.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("widgets.upcomingExams.noExams")}</p>
            )}

            {upcomingExams.length > 0 && (
              <div className="flex flex-col gap-3">
                {upcomingExams.map((exam, index) => {
                  const dayDiff = computeExamDayDiff(exam, now, timeZone)
                  return (
                    <div
                      key={`${exam.name}-${exam.startAt ?? ""}-${index}`}
                      className="flex items-center justify-between gap-2 rounded-lg border p-3"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium">{exam.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {[
                            formatExamTime(exam),
                            exam.examLocation,
                            exam.seatNumber
                              ? t("widgets.upcomingExams.seatNumber", { num: exam.seatNumber })
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      {dayDiff !== null && dayDiff >= 0 && (
                        <Badge
                          variant={dayDiff <= 1 ? "default" : "secondary"}
                          className="shrink-0"
                        >
                          {dayDiff === 0
                            ? t("widgets.upcomingExams.examToday")
                            : dayDiff === 1
                              ? t("widgets.upcomingExams.examTomorrow")
                              : t("widgets.upcomingExams.examInDays", { count: dayDiff })}
                        </Badge>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {examsQuery.isStale && !error && (
              <p role="status" className="text-xs text-muted-foreground">
                {t("widgets.upcomingExams.stale")}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
