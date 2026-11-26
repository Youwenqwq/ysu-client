import { useMemo, useState, type MouseEvent, type ReactNode } from "react"
import { BookOpen, ChevronRight, Clock } from "lucide-react"
import {
  computeOverviewSchedule,
  courseEndSection,
  courseStartSection,
  formatMinutesClock,
  isCoursePast,
  resolveScheduleEntriesForDate,
  scheduleOccurrence,
} from "@orahako/academic-kit"
import {
  isProviderError,
  ProviderErrorCode,
  type ClassPeriod,
  type Course,
  type CurrentWeek,
  type ProviderRuntimeSnapshot,
  type QuerySnapshot,
  type SessionSnapshot,
  type TermCalendar,
} from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  ScheduleEffectiveSnapshot,
  ScheduleEntry,
  SlotComponent,
  Translator,
} from "@orahako/sdk"
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Progress,
  Skeleton,
} from "@orahako/ui-primitives"
import type { ScheduleDictionary } from "./dictionary"
import { CourseActivityModal, CourseSigninModal, type MobileLessonBridge } from "./modals"
import {
  computeEffectiveScheduleSnapshot,
  type ScheduleCustomizationsState,
  type SchedulePatchesStoreInstance,
} from "./stores"

export const COURSE_PROGRESS_WIDGET_ID = "course-progress"
export const TODAY_COURSES_WIDGET_ID = "today-courses"

interface OverviewQueryLike {
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

function OverviewScheduleQueryState({
  queries,
  t,
  children,
}: {
  readonly queries: readonly OverviewQueryLike[]
  readonly t: Translator<ScheduleDictionary>
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

  if (missing.some((query) => query.isLoading)) {
    return (
      <div className="flex flex-col gap-2" aria-label={t("overview.queryState.loading")}>
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
                  ? "overview.queryState.unsupported"
                  : authExpired
                    ? "overview.queryState.sessionExpired"
                    : stale || missing.length === 0
                      ? "overview.queryState.stale"
                      : "overview.queryState.failed"
              )}
            </span>
            {!unsupported && !authExpired && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={refreshing}
                onClick={() => void Promise.allSettled(queries.map((query) => query.refresh()))}
              >
                {t("overview.queryState.retry")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {missing.length === 0
        ? children
        : errors.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("overview.queryState.loading")}</p>
          )}
      {stale && errors.length === 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("overview.queryState.stale")}
        </p>
      )}
    </div>
  )
}

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

export interface ScheduleOverviewWidgetInject {
  readonly hooks: {
    readonly clockTick: ObservableSource<number>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly session: ObservableSource<SessionSnapshot>
    readonly patchesHydrated: ObservableSource<boolean>
    readonly customizations: ObservableSource<ScheduleCustomizationsState>
    readonly customizationsHydrated: ObservableSource<boolean>
    readonly scheduleState: ObservableSource<ScheduleEffectiveSnapshot>
    readonly schedule: ObservableSource<QuerySnapshot<Course[]>>
    readonly currentWeek: ObservableSource<QuerySnapshot<CurrentWeek>>
    readonly termCalendar: ObservableSource<QuerySnapshot<TermCalendar>>
    readonly periods: ObservableSource<QuerySnapshot<ClassPeriod[]>>
  }
  readonly scheduleHref: string
  readonly openSchedule: () => void
  readonly mobileBridge: MobileLessonBridge
}

export type CourseProgressWidgetProps = DerivedComponentProps<
  Record<string, never>,
  ScheduleDictionary,
  undefined,
  SchedulePatchesStoreInstance,
  ScheduleOverviewWidgetInject
>

export const CourseProgressWidget: SlotComponent<CourseProgressWidgetProps> = (props) => {
  const { t, useStore } = props
  const clockTick = props.useClockTick()
  const providerSnap = props.useProvider()
  const sessionSnap = props.useSession()
  const patchesHydrated = props.usePatchesHydrated()
  const customizationsState = props.useCustomizations()
  const customizationsHydrated = props.useCustomizationsHydrated()
  const scheduleState = props.useScheduleState()
  const scheduleQuery = props.useSchedule()
  const currentWeekQuery = props.useCurrentWeek()
  const termCalendarQuery = props.useTermCalendar()
  const periodsQuery = props.usePeriods()
  const patchesState = useStore()
  const timeZone = providerSnap.provider?.slices.timetable?.scheduleRules?.timeZone

  const rawWeek = currentWeekQuery.data ?? null
  const rawCalendar = termCalendarQuery.data
  const calendar =
    rawWeek?.semester && rawCalendar?.semester && rawWeek.semester !== rawCalendar.semester
      ? undefined
      : rawCalendar

  const effective = useMemo(
    () =>
      computeEffectiveScheduleSnapshot({
        rawCourses: scheduleQuery.data,
        calendar,
        currentWeek: rawWeek,
        providerSnapshot: providerSnap,
        sessionSnapshot: sessionSnap,
        patchesState,
        patchesHydrated,
        customizationsState,
        customizationsHydrated,
      }),
    [
      calendar,
      customizationsHydrated,
      customizationsState,
      patchesHydrated,
      patchesState,
      providerSnap,
      rawWeek,
      scheduleQuery.data,
      sessionSnap,
    ]
  )

  const overview = useMemo(
    () =>
      computeOverviewSchedule({
        courses: effective.ready ? effective.courses : (scheduleQuery.data ?? []),
        periods: periodsQuery.data ?? [],
        currentWeek: rawWeek,
        calendar,
        now: new Date(clockTick),
        timeZone,
      }),
    [
      calendar,
      clockTick,
      effective.courses,
      effective.ready,
      periodsQuery.data,
      rawWeek,
      scheduleQuery.data,
      timeZone,
    ]
  )

  const todayExtraEntries = useMemo(
    () =>
      resolveScheduleEntriesForDate(
        scheduleState.entries,
        overview.date,
        overview.weekday,
        overview.liveWeek?.week,
        overview.timeMap,
        { excludeCategories: ["exam"] }
      ).filter((item) => item.time !== null),
    [
      overview.date,
      overview.liveWeek?.week,
      overview.timeMap,
      overview.weekday,
      scheduleState.entries,
    ]
  )

  const { currentCourse, currentRange, nextCourseInfo, nowMinutes } = overview
  const ongoingEntry =
    todayExtraEntries.find(
      (item) => item.time && nowMinutes >= item.time.startMinute && nowMinutes < item.time.endMinute
    ) ?? null
  const nextEntry =
    todayExtraEntries.find((item) => item.time && item.time.startMinute > nowMinutes) ?? null

  const activeItem: {
    readonly title: string
    readonly detail: string
    readonly range: [number, number]
    readonly ongoing: boolean
    readonly isEvent: boolean
  } | null = (() => {
    if (currentCourse && currentRange) {
      return {
        title: currentCourse.name,
        detail: [currentCourse.teacher, currentCourse.classroom].filter(Boolean).join(" · "),
        range: currentRange,
        ongoing: true,
        isEvent: false,
      }
    }
    if (ongoingEntry?.time) {
      return {
        title: ongoingEntry.entry.title,
        detail: [ongoingEntry.entry.subtitle, ongoingEntry.entry.location]
          .filter(Boolean)
          .join(" · "),
        range: [ongoingEntry.time.startMinute, ongoingEntry.time.endMinute],
        ongoing: true,
        isEvent: ongoingEntry.entry.category === "personal",
      }
    }
    if (nextCourseInfo && nextEntry?.time) {
      if (nextEntry.time.startMinute < nextCourseInfo.range[0]) {
        return {
          title: nextEntry.entry.title,
          detail: [nextEntry.entry.subtitle, nextEntry.entry.location].filter(Boolean).join(" · "),
          range: [nextEntry.time.startMinute, nextEntry.time.endMinute],
          ongoing: false,
          isEvent: nextEntry.entry.category === "personal",
        }
      }
    }
    if (nextCourseInfo) {
      return {
        title: nextCourseInfo.course.name,
        detail: [nextCourseInfo.course.teacher, nextCourseInfo.course.classroom]
          .filter(Boolean)
          .join(" · "),
        range: nextCourseInfo.range,
        ongoing: false,
        isEvent: false,
      }
    }
    if (nextEntry?.time) {
      return {
        title: nextEntry.entry.title,
        detail: [nextEntry.entry.subtitle, nextEntry.entry.location].filter(Boolean).join(" · "),
        range: [nextEntry.time.startMinute, nextEntry.time.endMinute],
        ongoing: false,
        isEvent: nextEntry.entry.category === "personal",
      }
    }
    return null
  })()

  const queries: readonly OverviewQueryLike[] = [scheduleQuery, currentWeekQuery, periodsQuery]
  const settled = queries.every((q) => q.data !== undefined && q.error === null)
  if (settled && !activeItem) {
    return null
  }

  const formatCountdown = (minutes: number): string => {
    if (minutes < 60) {
      return t("overview.minutesOnly", { minutes: Math.max(1, minutes) })
    }
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest > 0
      ? t("overview.hoursMinutes", { hours, minutes: rest })
      : t("overview.hoursOnly", { hours })
  }

  const noLiveWeek =
    (currentWeekQuery.data !== undefined || termCalendarQuery.data !== undefined) &&
    overview.liveWeek === null &&
    !activeItem

  return (
    <Card data-overview-wide="" data-overview-course-progress="">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Clock className="size-4 text-primary" />
          {t(
            activeItem?.ongoing
              ? activeItem.isEvent
                ? "overview.ongoingEventNow"
                : "overview.ongoingNow"
              : "overview.nextCourse"
          )}
        </CardTitle>
        {activeItem && (
          <Badge variant={activeItem.ongoing ? "default" : "secondary"}>
            {t(activeItem.ongoing ? "overview.remaining" : "overview.startsIn", {
              time: formatCountdown(
                activeItem.ongoing
                  ? activeItem.range[1] - nowMinutes
                  : activeItem.range[0] - nowMinutes
              ),
            })}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <OverviewScheduleQueryState queries={queries} t={t}>
          {noLiveWeek && (
            <p className="text-sm text-muted-foreground">
              {t("overview.queryState.unavailableShort")}
            </p>
          )}
          {activeItem && (
            <div className="flex flex-col gap-2">
              <a
                href={props.scheduleHref}
                onClick={(event) => handleSpaClick(event, props.openSchedule)}
                className="rounded-sm text-lg font-semibold outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {activeItem.title}
              </a>
              {activeItem.detail && (
                <p className="text-sm text-muted-foreground">{activeItem.detail}</p>
              )}
              {activeItem.ongoing && (
                <Progress
                  aria-label={t("overview.ongoingNow")}
                  value={Math.min(
                    100,
                    Math.max(
                      0,
                      ((nowMinutes - activeItem.range[0]) /
                        Math.max(1, activeItem.range[1] - activeItem.range[0])) *
                        100
                    )
                  )}
                  className="h-1.5"
                />
              )}
              <p className="text-xs text-muted-foreground">
                {formatMinutesClock(activeItem.range[0])} -{" "}
                {formatMinutesClock(activeItem.range[1])}
              </p>
            </div>
          )}
        </OverviewScheduleQueryState>
      </CardContent>
    </Card>
  )
}

export type TodayCoursesWidgetProps = DerivedComponentProps<
  Record<string, never>,
  ScheduleDictionary,
  undefined,
  SchedulePatchesStoreInstance,
  ScheduleOverviewWidgetInject
>

export const TodayCoursesWidget: SlotComponent<TodayCoursesWidgetProps> = (props) => {
  const { t, useStore } = props
  const clockTick = props.useClockTick()
  const providerSnap = props.useProvider()
  const sessionSnap = props.useSession()
  const patchesHydrated = props.usePatchesHydrated()
  const customizationsState = props.useCustomizations()
  const customizationsHydrated = props.useCustomizationsHydrated()
  const scheduleState = props.useScheduleState()
  const scheduleQuery = props.useSchedule()
  const currentWeekQuery = props.useCurrentWeek()
  const termCalendarQuery = props.useTermCalendar()
  const periodsQuery = props.usePeriods()
  const patchesState = useStore()
  const timeZone = providerSnap.provider?.slices.timetable?.scheduleRules?.timeZone

  const [activityCourse, setActivityCourse] = useState<Course | null>(null)
  const [activityWeek, setActivityWeek] = useState(1)
  const [activityOpen, setActivityOpen] = useState(false)
  const [signinActivityId, setSigninActivityId] = useState<string | null>(null)
  const [signinType, setSigninType] = useState(1)
  const [signinOpen, setSigninOpen] = useState(false)

  const rawWeek = currentWeekQuery.data ?? null
  const rawCalendar = termCalendarQuery.data
  const calendar =
    rawWeek?.semester && rawCalendar?.semester && rawWeek.semester !== rawCalendar.semester
      ? undefined
      : rawCalendar

  const effective = useMemo(
    () =>
      computeEffectiveScheduleSnapshot({
        rawCourses: scheduleQuery.data,
        calendar,
        currentWeek: rawWeek,
        providerSnapshot: providerSnap,
        sessionSnapshot: sessionSnap,
        patchesState,
        patchesHydrated,
        customizationsState,
        customizationsHydrated,
      }),
    [
      calendar,
      customizationsHydrated,
      customizationsState,
      patchesHydrated,
      patchesState,
      providerSnap,
      rawWeek,
      scheduleQuery.data,
      sessionSnap,
    ]
  )

  const overview = useMemo(
    () =>
      computeOverviewSchedule({
        courses: effective.ready ? effective.courses : (scheduleQuery.data ?? []),
        periods: periodsQuery.data ?? [],
        currentWeek: rawWeek,
        calendar,
        now: new Date(clockTick),
        timeZone,
      }),
    [
      calendar,
      clockTick,
      effective.courses,
      effective.ready,
      periodsQuery.data,
      rawWeek,
      scheduleQuery.data,
      timeZone,
    ]
  )

  const todayExtraEntries = useMemo(
    () =>
      resolveScheduleEntriesForDate(
        scheduleState.entries,
        overview.date,
        overview.weekday,
        overview.liveWeek?.week,
        overview.timeMap,
        { excludeCategories: ["exam"] }
      ),
    [
      overview.date,
      overview.liveWeek?.week,
      overview.timeMap,
      overview.weekday,
      scheduleState.entries,
    ]
  )

  const unifiedTodayItems = useMemo(() => {
    const items: Array<
      | {
          readonly kind: "course"
          readonly key: string
          readonly startMinute: number
          readonly startSection: number
          readonly course: Course
          readonly range: [number, number] | null
        }
      | {
          readonly kind: "entry"
          readonly key: string
          readonly startMinute: number
          readonly startSection: number
          readonly entry: ScheduleEntry
          readonly range: [number, number] | null
        }
    > = []

    overview.todayCourses.forEach((course, index) => {
      const range = overview.courseTimeRange(course)
      items.push({
        kind: "course",
        key: `course:${course.scheduleId ?? course.name}-${course.startSection}-${index}`,
        startMinute: range ? range[0] : Number.POSITIVE_INFINITY,
        startSection: courseStartSection(course),
        course,
        range,
      })
    })

    for (const resolved of todayExtraEntries) {
      items.push({
        kind: "entry",
        key: `entry:${resolved.entry.id}`,
        startMinute: resolved.time ? resolved.time.startMinute : Number.POSITIVE_INFINITY,
        startSection: resolved.entry.sections?.startSection ?? Number.POSITIVE_INFINITY,
        entry: resolved.entry,
        range: resolved.time ? [resolved.time.startMinute, resolved.time.endMinute] : null,
      })
    }

    return items.sort((a, b) => a.startMinute - b.startMinute || a.startSection - b.startSection)
  }, [overview, todayExtraEntries])

  const noLiveWeek =
    (currentWeekQuery.data !== undefined || termCalendarQuery.data !== undefined) &&
    overview.liveWeek === null &&
    todayExtraEntries.length === 0

  const openCourse = (course: Course): void => {
    const occurrence = scheduleOccurrence(course)
    setActivityCourse(course)
    setActivityWeek(occurrence ? occurrence.source.week : (overview.liveWeek?.week ?? 1))
    setActivityOpen(true)
  }

  return (
    <>
      <Card data-overview-today-courses="">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4 text-primary" />
            {t("overview.todayCourses.title")}
          </CardTitle>
          <a
            href={props.scheduleHref}
            aria-label={t("navTitle")}
            onClick={(event) => handleSpaClick(event, props.openSchedule)}
            className="rounded-sm p-2 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight className="size-4" />
          </a>
        </CardHeader>
        <CardContent>
          <OverviewScheduleQueryState queries={[scheduleQuery, currentWeekQuery]} t={t}>
            {noLiveWeek ? (
              <p className="text-sm text-muted-foreground">
                {t("overview.queryState.unavailableShort")}
              </p>
            ) : unifiedTodayItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("overview.noCoursesToday")}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {unifiedTodayItems.map((item) => {
                  if (item.kind === "course") {
                    const { course, range } = item
                    const isCurrent = course === overview.currentCourse
                    const isPast =
                      !isCurrent && isCoursePast(course, overview.nowMinutes, overview.timeMap)
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => openCourse(course)}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                          isCurrent && "border-primary bg-primary/5",
                          isPast && "opacity-50"
                        )}
                      >
                        {range && (
                          <span className="flex w-11 shrink-0 flex-col text-xs leading-tight text-muted-foreground">
                            <span>{formatMinutesClock(range[0])}</span>
                            <span>{formatMinutesClock(range[1])}</span>
                          </span>
                        )}
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                            {course.deliveryMode === "online" && (
                              <Badge variant="outline" className="h-4 px-1 text-[10px]">
                                {t("schedule.onlineTag")}
                              </Badge>
                            )}
                            <span className="truncate">{course.name}</span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {[course.teacher, course.classroom].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <Badge variant={isCurrent ? "default" : "outline"} className="shrink-0">
                          {isCurrent
                            ? t("overview.ongoingNow")
                            : t("overview.sectionRange", {
                                start: courseStartSection(course),
                                end: courseEndSection(course),
                              })}
                        </Badge>
                      </button>
                    )
                  }

                  const { entry, range } = item
                  const isCurrent =
                    range !== null &&
                    overview.nowMinutes >= range[0] &&
                    overview.nowMinutes < range[1]
                  const isPast = range !== null && !isCurrent && overview.nowMinutes >= range[1]
                  return (
                    <a
                      key={item.key}
                      href={props.scheduleHref}
                      onClick={(event) => handleSpaClick(event, props.openSchedule)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring",
                        isCurrent && "border-primary bg-primary/5",
                        isPast && "opacity-50"
                      )}
                    >
                      {range && (
                        <span className="flex w-11 shrink-0 flex-col text-xs leading-tight text-muted-foreground">
                          <span>{formatMinutesClock(range[0])}</span>
                          <span>{formatMinutesClock(range[1])}</span>
                        </span>
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-sm font-medium">{entry.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {[entry.subtitle, entry.location].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <Badge variant={isCurrent ? "default" : "secondary"} className="shrink-0">
                        {isCurrent
                          ? t("overview.ongoingEventNow")
                          : entry.badge || t("schedule.personalTag")}
                      </Badge>
                    </a>
                  )
                })}
              </div>
            )}
          </OverviewScheduleQueryState>
        </CardContent>
      </Card>

      <CourseActivityModal
        course={activityCourse}
        week={activityWeek}
        open={activityOpen}
        mobileBridge={props.mobileBridge}
        t={t}
        onOpenChange={setActivityOpen}
        onSigninActivity={(activityId, type) => {
          setSigninActivityId(activityId)
          setSigninType(type)
          setSigninOpen(true)
        }}
      />
      <CourseSigninModal
        activityId={signinActivityId}
        signinType={signinType}
        open={signinOpen}
        mobileBridge={props.mobileBridge}
        t={t}
        onOpenChange={setSigninOpen}
      />
    </>
  )
}
