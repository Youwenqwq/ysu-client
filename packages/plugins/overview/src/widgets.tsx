import type { ReactNode } from "react"
import { Calendar, LayoutDashboard } from "lucide-react"
import { computeOverviewSchedule } from "@orahako/academic-kit"
import {
  isProviderError,
  ProviderErrorCode,
  type CurrentWeek,
  type ProviderRuntimeSnapshot,
  type QuerySnapshot,
  type SessionSnapshot,
  type StudentInfo,
  type TermCalendar,
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
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
  ToggleGroupItem,
  useIsMobile,
} from "@orahako/ui-primitives"
import type { OverviewDictionary } from "./store"

export interface OverviewQueryLike {
  readonly data: unknown
  readonly isLoading: boolean
  readonly isRefreshing: boolean
  readonly isStale: boolean
  readonly error: Error | null
  refresh(): Promise<unknown>
}

function hasErrorCode(error: Error | null, code: ProviderErrorCode): boolean {
  if (!error) return false
  if (isProviderError(error)) return error.code === code
  return "code" in error && error.code === code
}

export function OverviewQueryState({
  queries,
  t,
  compact = false,
  children,
}: {
  readonly queries: readonly OverviewQueryLike[]
  readonly t: Translator<OverviewDictionary>
  readonly compact?: boolean
  readonly children: ReactNode
}): ReactNode {
  const missing = queries.filter((query) => query.data === undefined)
  const errors = queries.filter((query) => query.error !== null)
  const refreshing = queries.some((query) => query.isRefreshing)
  const stale = queries.some((query) => query.isStale)
  const authExpired = errors.some(
    (query) =>
      hasErrorCode(query.error, ProviderErrorCode.AUTH_SESSION_EXPIRED) ||
      hasErrorCode(query.error, ProviderErrorCode.AUTH_REQUIRED)
  )
  const unsupported = errors.some((query) =>
    hasErrorCode(query.error, ProviderErrorCode.FEATURE_NOT_SUPPORTED)
  )

  if (compact) {
    if (missing.some((query) => query.isLoading)) {
      return <Skeleton className="h-6 w-14" aria-label={t("queryState.loading")} />
    }
    if (missing.length > 0) {
      const message = t(
        unsupported
          ? "queryState.unsupported"
          : authExpired
            ? "queryState.sessionExpired"
            : errors.length > 0
              ? "queryState.failed"
              : "queryState.loading"
      )
      return (
        <span
          role="status"
          title={message}
          aria-label={message}
          className="text-sm text-muted-foreground"
        >
          {t(errors.length > 0 ? "queryState.unavailableShort" : "queryState.loading")}
        </span>
      )
    }
    return (
      <span className="flex flex-col gap-0.5">
        {children}
        {(stale || errors.length > 0) && (
          <span
            role="status"
            title={t("queryState.stale")}
            className="text-xs text-muted-foreground"
          >
            {t("queryState.staleShort")}
          </span>
        )}
      </span>
    )
  }

  if (missing.some((query) => query.isLoading)) {
    return (
      <div className="flex flex-col gap-2" aria-label={t("queryState.loading")}>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-full" />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {errors.length > 0 && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              {t(
                unsupported
                  ? "queryState.unsupported"
                  : authExpired
                    ? "queryState.sessionExpired"
                    : stale || missing.length === 0
                      ? "queryState.stale"
                      : "queryState.failed"
              )}
            </span>
            {!unsupported && !authExpired && (
              <Button
                size="sm"
                variant="ghost"
                disabled={refreshing}
                onClick={() => void Promise.allSettled(queries.map((query) => query.refresh()))}
              >
                {t("queryState.retry")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {missing.length === 0
        ? children
        : errors.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("queryState.loading")}</p>
          )}
      {stale && errors.length === 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("queryState.stale")}
        </p>
      )}
    </div>
  )
}

export interface ProfileSummaryWidgetInject {
  readonly hooks: {
    readonly session: ObservableSource<SessionSnapshot>
    readonly student: ObservableSource<QuerySnapshot<StudentInfo>>
    readonly avatarUrl: ObservableSource<string | null>
  }
}

export type ProfileSummaryWidgetProps = DerivedComponentProps<
  { readonly children?: ReactNode },
  OverviewDictionary,
  undefined,
  undefined,
  ProfileSummaryWidgetInject
>

export const ProfileSummaryWidget: SlotComponent<ProfileSummaryWidgetProps> = (props) => {
  const { t } = props
  const session = props.useSession()
  const student = props.useStudent()
  const avatarUrl = props.useAvatarUrl()
  const compact = useIsMobile()

  const displayName = student.data?.name || session.username || t("widgets.profile.fallbackName")
  const initials = (student.data?.name || session.username || "--").slice(-2)

  return (
    <Card data-overview-profile-card="">
      <CardHeader className="flex flex-row items-center gap-3">
        <Avatar className="size-12 shrink-0">
          {avatarUrl && <AvatarImage src={avatarUrl} alt="avatar" />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <CardTitle>{displayName}</CardTitle>
          <CardDescription className="truncate">
            {compact
              ? (student.data?.department ?? session.username ?? "")
              : (student.data?.studentId ?? session.username ?? "")}
          </CardDescription>
        </div>
      </CardHeader>
      {(!compact || !student.data) && (
        <CardContent>
          <OverviewQueryState queries={[student]} t={t} compact={compact}>
            <p className="text-sm text-muted-foreground">
              {[student.data?.department, student.data?.major].filter(Boolean).join(" · ")}
            </p>
          </OverviewQueryState>
        </CardContent>
      )}
      {props.children}
    </Card>
  )
}

export interface WeekSummaryWidgetInject {
  readonly hooks: {
    readonly currentWeek: ObservableSource<QuerySnapshot<CurrentWeek>>
    readonly termCalendar: ObservableSource<QuerySnapshot<TermCalendar>>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
}

export type WeekSummaryWidgetProps = DerivedComponentProps<
  Record<string, never>,
  OverviewDictionary,
  undefined,
  undefined,
  WeekSummaryWidgetInject
>

function weekdayLabel(t: Translator<OverviewDictionary>, weekday: number): string {
  switch (weekday) {
    case 1:
      return t("widgets.weekSummary.weekday1")
    case 2:
      return t("widgets.weekSummary.weekday2")
    case 3:
      return t("widgets.weekSummary.weekday3")
    case 4:
      return t("widgets.weekSummary.weekday4")
    case 5:
      return t("widgets.weekSummary.weekday5")
    case 6:
      return t("widgets.weekSummary.weekday6")
    case 7:
      return t("widgets.weekSummary.weekday7")
    default:
      return String(weekday)
  }
}

export const WeekSummaryWidget: SlotComponent<WeekSummaryWidgetProps> = (props) => {
  const { t } = props
  const currentWeek = props.useCurrentWeek()
  const termCalendar = props.useTermCalendar()
  const provider = props.useProvider()
  const compact = useIsMobile()
  const timeZone = provider.provider?.slices.timetable?.scheduleRules?.timeZone

  const schedule = computeOverviewSchedule({
    courses: [],
    currentWeek: currentWeek.data ?? null,
    calendar: termCalendar.data,
    timeZone,
  })

  const effectiveWeek = schedule.liveWeek?.week ?? currentWeek.data?.week

  if (compact) {
    return (
      <div data-overview-week-summary="compact" className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="size-3.5 shrink-0" />
          <span className="truncate">{t("widgets.weekSummary.termLabel")}</span>
        </span>
        <OverviewQueryState queries={[currentWeek]} t={t} compact>
          <span className="text-base font-semibold tabular-nums">
            {effectiveWeek !== undefined
              ? t("widgets.weekSummary.currentWeek", { week: effectiveWeek })
              : t("queryState.unavailableShort")}
          </span>
        </OverviewQueryState>
      </div>
    )
  }

  return (
    <Card data-overview-week-summary="card" size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="size-4 shrink-0 text-primary" />
          {t("widgets.weekSummary.termLabel")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <OverviewQueryState queries={[currentWeek]} t={t}>
          <p className="text-lg font-semibold tabular-nums">
            {effectiveWeek !== undefined
              ? t("widgets.weekSummary.currentWeek", { week: effectiveWeek })
              : t("queryState.unavailableShort")}
          </p>
        </OverviewQueryState>
        <p className="text-xs text-muted-foreground">
          {schedule.date} · {weekdayLabel(t, schedule.weekday)}
        </p>
        {schedule.semester && <p className="text-xs text-muted-foreground">{schedule.semester}</p>}
      </CardContent>
    </Card>
  )
}

export type OverviewStartupOptionProps = DerivedComponentProps<
  Record<string, never>,
  OverviewDictionary
>

export const OverviewStartupOption: SlotComponent<OverviewStartupOptionProps> = (props) => {
  return (
    <ToggleGroupItem value="overview" className="gap-1 text-xs">
      <LayoutDashboard className="size-3.5" />
      {props.t("startupOption")}
    </ToggleGroupItem>
  )
}
