import { ChevronRight, Eye, EyeOff, GraduationCap } from "lucide-react"
import {
  isProviderError,
  ProviderErrorCode,
  type GPAStats,
  type Grade,
  type QuerySnapshot,
  type SessionSnapshot,
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
import type { GradesDictionary } from "./dictionary"
import {
  gradeKey,
  isGradeScored,
  normalizeGradeUser,
  type GradeGachaState,
  type GradesSettingsStoreInstance,
} from "./store"

function hasErrorCode(error: Error | null, code: ProviderErrorCode): boolean {
  if (!error) return false
  if (isProviderError(error)) return error.code === code
  return "code" in error && error.code === code
}

export interface RecentGradesWidgetInject {
  readonly hooks: {
    readonly session: ObservableSource<SessionSnapshot>
    readonly grades: ObservableSource<QuerySnapshot<Grade[]>>
    readonly gpa: ObservableSource<QuerySnapshot<GPAStats>>
    readonly gacha: ObservableSource<GradeGachaState>
  }
  readonly openGrades: () => void
}

export type RecentGradesWidgetProps = DerivedComponentProps<
  Record<string, never>,
  GradesDictionary,
  undefined,
  GradesSettingsStoreInstance,
  RecentGradesWidgetInject
>

export const RecentGradesWidget: SlotComponent<RecentGradesWidgetProps> = (props) => {
  const { t, useStore, actions } = props
  const session = props.useSession()
  const gradesQuery = props.useGrades()
  const gpaQuery = props.useGpa()
  const gachaState = props.useGacha()

  const gpaVisible = useStore((s) => s.gpaVisible)
  const gachaEnabled = useStore((s) => s.gradeGachaEnabled)

  const user = normalizeGradeUser(session.username)
  const pendingKeys = new Set((gachaState.pendingByUser[user] ?? []).map((item) => item.key))

  const allGrades = gradesQuery.data ?? []
  const visibleGrades = gachaEnabled
    ? allGrades.filter((grade) => !pendingKeys.has(gradeKey(grade)))
    : allGrades
  const recentScored = visibleGrades.filter(isGradeScored).slice(0, 4)

  const error = gradesQuery.error
  const authExpired =
    hasErrorCode(error, ProviderErrorCode.AUTH_SESSION_EXPIRED) ||
    hasErrorCode(error, ProviderErrorCode.AUTH_REQUIRED)
  const unsupported = hasErrorCode(error, ProviderErrorCode.FEATURE_NOT_SUPPORTED)

  return (
    <Card data-overview-recent-grades="">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <GraduationCap className="size-4 text-primary" />
          {t("widgets.recentGrades.title")}
        </CardTitle>
        <div className="flex items-center gap-1">
          {gpaQuery.data?.gpaInitial && (
            <button
              type="button"
              onClick={() => actions.toggleGpaVisible()}
              aria-label={t("gpa.toggleVisibility")}
              className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
            >
              <span className="font-medium text-foreground tabular-nums">
                GPA {gpaVisible ? gpaQuery.data.gpaInitial : "***"}
              </span>
              {gpaVisible ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            </button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("widgets.recentGrades.openAll")}
            onClick={props.openGrades}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {gradesQuery.data === undefined && gradesQuery.isLoading ? (
          <div className="flex flex-col gap-2" aria-label={t("widgets.recentGrades.loading")}>
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
                        ? "widgets.recentGrades.unsupported"
                        : authExpired
                          ? "widgets.recentGrades.sessionExpired"
                          : gradesQuery.isStale || gradesQuery.data !== undefined
                            ? "widgets.recentGrades.stale"
                            : "widgets.recentGrades.failed"
                    )}
                  </span>
                  {!unsupported && !authExpired && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={gradesQuery.isRefreshing}
                      onClick={() => void gradesQuery.refresh()}
                    >
                      {t("widgets.recentGrades.retry")}
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {gradesQuery.data !== undefined && recentScored.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("widgets.recentGrades.empty")}</p>
            )}

            {recentScored.length > 0 && (
              <div className="flex flex-col gap-2">
                {recentScored.map((grade, index) => (
                  <button
                    key={`${gradeKey(grade)}-${index}`}
                    type="button"
                    onClick={props.openGrades}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{grade.courseName}</span>
                      <span className="text-xs text-muted-foreground">
                        {[
                          grade.semester,
                          grade.credit ? `${t("grades.table.credit")} ${grade.credit}` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums">
                        {grade.score || grade.gradeLevel || "-"}
                      </span>
                      <Badge
                        variant={grade.isPass ? "secondary" : "destructive"}
                        className="text-[10px]"
                      >
                        {grade.isPass ? t("grades.table.pass") : t("grades.table.fail")}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {gradesQuery.isStale && !error && (
              <p role="status" className="text-xs text-muted-foreground">
                {t("widgets.recentGrades.stale")}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
