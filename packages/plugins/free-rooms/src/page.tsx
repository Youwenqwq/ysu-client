import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock,
  DoorOpen,
  RefreshCw,
  Search,
  Star,
  TriangleAlert,
} from "lucide-react"
import {
  buildCourseColorMap,
  courseStartSection,
  getAcademicClock,
  isCourseActiveInWeek,
  periodEndTime,
  periodIsInUse,
  periodStartTime,
  resolveAcademicWeek,
  ScheduleMobile,
  ScheduleTablet,
  type ScheduleLabels,
} from "@orahako/academic-kit"
import type {
  AcademicScheduleRules,
  ClassPeriod,
  ClassroomInfo,
  CodeItem,
  Course,
  CurrentWeek,
  ProviderRuntimeSnapshot,
  QuerySnapshot,
  TermCalendar,
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
  Badge,
  Button,
  Card,
  CardContent,
  cn,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  LoadingCards,
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveSelect,
  Switch,
  useErrorToast,
  useIsMobile,
} from "@orahako/ui-primitives"
import {
  computeRoomAvailability,
  resolveTimePreset,
  sortRoomAvailabilities,
  type FreeRoomQuerySlot,
  type RoomAvailability,
  type TimePreset,
} from "./availability"
import type { BuildingScanState } from "./building-scanner"
import {
  buildFreeRoomsScheduleLabels,
  weekdayShortLabel,
  type FreeRoomsDictionary,
} from "./dictionary"
import {
  FILTER_ALL,
  type FavoriteRoom,
  type FreeRoomsPrefsState,
  type FreeRoomsViewStoreInstance,
} from "./store"

export interface FreeRoomsPageInject {
  readonly hooks: {
    readonly clockTick: ObservableSource<number>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly prefs: ObservableSource<FreeRoomsPrefsState>
    readonly scan: ObservableSource<BuildingScanState>
    readonly currentWeek: ObservableSource<QuerySnapshot<CurrentWeek>>
    readonly termCalendar: ObservableSource<QuerySnapshot<TermCalendar>>
    readonly periods: ObservableSource<QuerySnapshot<ClassPeriod[]>>
    readonly campuses: ObservableSource<QuerySnapshot<CodeItem[]>>
    readonly buildings: ObservableSource<QuerySnapshot<CodeItem[]>>
    readonly rooms: ObservableSource<QuerySnapshot<ClassroomInfo[]>>
    readonly selectedRoomSchedule: ObservableSource<QuerySnapshot<Course[]>>
  }
  readonly setCampus: (campus: string) => void
  readonly setBuilding: (building: string) => void
  readonly setOnlyFree: (onlyFree: boolean) => void
  readonly toggleFavoriteRoom: (room: FavoriteRoom) => void
  readonly triggerBuildingScan: (options: {
    readonly scopeKey: string
    readonly rooms: readonly ClassroomInfo[]
    readonly forceRefresh?: boolean
  }) => void
  readonly resetScan: () => void
}

export type FreeRoomsPageProps = DerivedComponentProps<
  Record<string, never>,
  FreeRoomsDictionary,
  undefined,
  FreeRoomsViewStoreInstance,
  FreeRoomsPageInject
>

const PRESETS: readonly TimePreset[] = ["now", "next", "afternoon", "evening", "tomorrow", "custom"]
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const

function RoomScheduleDetail({
  title,
  subtitle,
  courses,
  isLoading,
  isFavorite,
  onToggleFavorite,
  snapshot,
  calendar,
  periods,
  clockTick,
  scheduleRules,
  weekOverride,
  initialWeek,
  onWeekOverrideChange,
  onBack,
  t,
  labels,
}: {
  readonly title: string
  readonly subtitle?: string
  readonly courses: readonly Course[]
  readonly isLoading: boolean
  readonly isFavorite: boolean
  readonly onToggleFavorite: () => void
  readonly snapshot: CurrentWeek | null
  readonly calendar: TermCalendar | undefined
  readonly periods: readonly ClassPeriod[]
  readonly clockTick: number
  readonly scheduleRules?: AcademicScheduleRules
  readonly weekOverride: number | null
  readonly initialWeek: number
  readonly onWeekOverrideChange: (week: number | null) => void
  readonly onBack: () => void
  readonly t: Translator<FreeRoomsDictionary>
  readonly labels: ScheduleLabels
}): ReactNode {
  const isMobile = useIsMobile()
  const clock = useMemo(
    () => getAcademicClock(new Date(clockTick), scheduleRules?.timeZone),
    [clockTick, scheduleRules?.timeZone]
  )
  const currentWeek = useMemo(
    () => resolveAcademicWeek(snapshot, calendar, clock.date),
    [snapshot, calendar, clock.date]
  )
  const termStartDate =
    snapshot?.semester && calendar?.semester && snapshot.semester !== calendar.semester
      ? undefined
      : calendar?.startDate

  const selectedWeek = weekOverride ?? initialWeek ?? currentWeek?.week ?? 1
  const colorMap = useMemo(() => buildCourseColorMap(courses), [courses])
  const weekCourses = useMemo(
    () => courses.filter((course) => isCourseActiveInWeek(course, selectedWeek)),
    [courses, selectedWeek]
  )
  const [detailCourse, setDetailCourse] = useState<Course | null>(null)
  const isCurrentWeek = currentWeek?.week === selectedWeek

  const shiftWeek = (delta: number): void => {
    const nextWeek = Math.max(1, selectedWeek + delta)
    onWeekOverrideChange(nextWeek)
  }

  return (
    <div className="flex flex-col gap-3" data-free-room-detail="">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label={t("backToList")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-semibold">{title}</span>
            {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onToggleFavorite}
          aria-label={isFavorite ? t("favoriteRemove") : t("favoriteAdd")}
        >
          <Star
            className={cn(
              "size-4",
              isFavorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground"
            )}
          />
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => shiftWeek(-1)}
          aria-label={t("schedule.weekPrev")}
        >
          <ChevronLeft />
        </Button>
        <span className="min-w-16 text-center text-sm font-medium">
          {t("schedule.weekShort", { week: selectedWeek })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={() => shiftWeek(1)}
          aria-label={t("schedule.weekNext")}
        >
          <ChevronRight />
        </Button>
        {isCurrentWeek && (
          <Badge variant="secondary">
            {t("schedule.currentWeekBadge", { week: selectedWeek })}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <LoadingCards />
      ) : courses.length === 0 ? (
        <EmptyState title={t("noCourses")} />
      ) : (
        <div className="flex min-h-[60dvh] flex-col">
          {isMobile ? (
            <ScheduleMobile
              courses={courses}
              colorMap={colorMap}
              periods={periods}
              scheduleRules={scheduleRules}
              currentWeekday={clock.weekday}
              currentWeek={currentWeek}
              weekAnchor={snapshot}
              selectedWeek={selectedWeek}
              termStartDate={termStartDate}
              nowMinutes={clock.minutes}
              labels={labels}
              onPrevWeek={() => shiftWeek(-1)}
              onNextWeek={() => shiftWeek(1)}
              onCourseTap={setDetailCourse}
            />
          ) : (
            <ScheduleTablet
              courses={weekCourses}
              colorMap={colorMap}
              periods={periods}
              scheduleRules={scheduleRules}
              currentWeekday={clock.weekday}
              currentWeek={currentWeek}
              weekAnchor={snapshot}
              selectedWeek={selectedWeek}
              termStartDate={termStartDate}
              nowMinutes={clock.minutes}
              labels={labels}
              onCourseTap={setDetailCourse}
            />
          )}
        </div>
      )}

      <ResponsiveModal
        open={detailCourse !== null}
        onOpenChange={(open) => {
          if (!open) setDetailCourse(null)
        }}
      >
        <ResponsiveModalContent className="sm:max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{detailCourse?.name}</ResponsiveModalTitle>
            <ResponsiveModalDescription>{t("schedule.courseDetail")}</ResponsiveModalDescription>
          </ResponsiveModalHeader>
          {detailCourse && (
            <ResponsiveModalBody>
              <div className="flex flex-col gap-2 text-sm">
                {detailCourse.teacher && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("schedule.teacher")}</span>
                    <span>{detailCourse.teacher}</span>
                  </div>
                )}
                {detailCourse.weeks && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("schedule.weeks")}</span>
                    <span>{detailCourse.weeks}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("schedule.sections")}</span>
                  <span>
                    {t("sections", {
                      start: detailCourse.startSection,
                      end: detailCourse.endSection,
                    })}
                  </span>
                </div>
                {detailCourse.classroom && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("schedule.classroom")}</span>
                    <span>{detailCourse.classroom}</span>
                  </div>
                )}
              </div>
            </ResponsiveModalBody>
          )}
        </ResponsiveModalContent>
      </ResponsiveModal>
    </div>
  )
}

function RoomAvailabilityCard({
  item,
  isFavorite,
  onSelect,
  onToggleFavorite,
  t,
}: {
  readonly item: RoomAvailability
  readonly isFavorite: boolean
  readonly onSelect: () => void
  readonly onToggleFavorite: () => void
  readonly t: Translator<FreeRoomsDictionary>
}): ReactNode {
  const { room } = item

  let statusLabel: string
  let statusClass: string
  if (item.status === "free") {
    statusLabel = item.freeAllDay
      ? t("statusFreeAllDay")
      : item.freeUntilTime
        ? t("statusFreeUntilTime", { time: item.freeUntilTime })
        : t("statusFreeUntilSection", { section: item.freeUntilSection ?? 0 })
    statusClass = "border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
  } else if (item.status === "occupied") {
    statusLabel = t("statusOccupied")
    statusClass = "border-border bg-muted text-muted-foreground"
  } else if (item.status === "loading") {
    statusLabel = t("statusLoading")
    statusClass = "border-border bg-muted/60 text-muted-foreground"
  } else {
    statusLabel = t("statusError")
    statusClass = "border-destructive/40 bg-destructive/10 text-destructive"
  }

  let subHint: string | null = null
  if (item.status === "free" && item.nextCourse) {
    subHint = item.nextCourseStartTime
      ? t("nextClassHint", { time: item.nextCourseStartTime, name: item.nextCourse.name })
      : t("nextClassSectionHint", {
          section: courseStartSection(item.nextCourse),
          name: item.nextCourse.name,
        })
  } else if (item.status === "occupied") {
    const freeHint =
      item.nextFreeSection !== null
        ? item.nextFreeTime
          ? t("nextFreeAtTime", { time: item.nextFreeTime })
          : t("nextFreeAtSection", { section: item.nextFreeSection })
        : t("occupiedRestOfDay")
    subHint = item.currentCourse ? `${item.currentCourse.name} · ${freeHint}` : freeHint
  }

  const meta = [
    room.floor !== undefined ? t("floorLabel", { floor: room.floor }) : null,
    room.typeDisplay ?? null,
    room.classSeats !== undefined ? t("seats", { count: room.classSeats }) : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div
      data-free-room-code={room.code}
      data-free-room-status={item.status}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border border-border/80 bg-card/60 px-3 py-2.5 transition-colors hover:bg-accent/35",
        item.status === "occupied" && "opacity-75"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold">{room.name}</span>
          <Badge
            variant="outline"
            className={cn("h-5 px-1.5 text-[11px] font-medium", statusClass)}
          >
            {statusLabel}
          </Badge>
        </div>
        {subHint && <span className="truncate text-xs text-muted-foreground">{subHint}</span>}
        {meta && <span className="truncate text-[11px] text-muted-foreground/80">{meta}</span>}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        onClick={onToggleFavorite}
        aria-label={isFavorite ? t("favoriteRemove") : t("favoriteAdd")}
      >
        <Star
          className={cn(
            "size-4",
            isFavorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground/70"
          )}
        />
      </Button>
    </div>
  )
}

export const FreeRoomsPage: SlotComponent<FreeRoomsPageProps> = (props) => {
  const { t, useStore, actions } = props
  const clockTick = props.useClockTick()
  const providerSnap = props.useProvider()
  const prefs = props.usePrefs()
  const scan = props.useScan()
  const currentWeekQuery = props.useCurrentWeek()
  const termCalendarQuery = props.useTermCalendar()
  const periodsQuery = props.usePeriods()
  const campusesQuery = props.useCampuses()
  const buildingsQuery = props.useBuildings()
  const roomsQuery = props.useRooms()
  const selectedRoomScheduleQuery = props.useSelectedRoomSchedule()

  const preset = useStore((s) => s.preset)
  const customWeek = useStore((s) => s.customWeek)
  const customDay = useStore((s) => s.customDay)
  const customStartSection = useStore((s) => s.customStartSection)
  const customEndSection = useStore((s) => s.customEndSection)
  const floorFilter = useStore((s) => s.floorFilter)
  const keyword = useStore((s) => s.keyword)
  const selectedRoom = useStore((s) => s.selectedRoom)
  const detailWeekOverride = useStore((s) => s.detailWeekOverride)

  useErrorToast(
    campusesQuery.error ??
      buildingsQuery.error ??
      roomsQuery.error ??
      selectedRoomScheduleQuery.error ??
      undefined
  )

  const scheduleRules = providerSnap.provider?.slices.timetable?.scheduleRules
  const clock = useMemo(
    () => getAcademicClock(new Date(clockTick), scheduleRules?.timeZone),
    [clockTick, scheduleRules?.timeZone]
  )
  const snapshot = currentWeekQuery.data ?? null
  const calendar = termCalendarQuery.data
  const currentWeek = useMemo(
    () => resolveAcademicWeek(snapshot, calendar, clock.date),
    [snapshot, calendar, clock.date]
  )
  const totalWeeks = calendar?.totalWeeks ?? 20
  const periods = useMemo(
    () => (periodsQuery.data ?? []).filter(periodIsInUse).sort((a, b) => a.section - b.section),
    [periodsQuery.data]
  )
  const minSection = periods[0]?.section ?? 1
  const maxSection = periods.at(-1)?.section ?? 12

  const activeSlot = useMemo<FreeRoomQuerySlot>(() => {
    if (preset === "custom") {
      return {
        week: Math.max(1, customWeek ?? currentWeek?.week ?? 1),
        day: customDay ?? (clock.weekday >= 1 && clock.weekday <= 7 ? clock.weekday : 1),
        startSection: Math.max(minSection, Math.min(maxSection, customStartSection)),
        endSection: Math.max(
          Math.max(minSection, Math.min(maxSection, customStartSection)),
          Math.min(maxSection, customEndSection)
        ),
      }
    }
    return resolveTimePreset(preset, {
      currentWeek: currentWeek?.week ?? 1,
      totalWeeks,
      weekday: clock.weekday,
      nowMinutes: clock.minutes,
      periods,
    })
  }, [
    clock.minutes,
    clock.weekday,
    currentWeek?.week,
    customDay,
    customEndSection,
    customStartSection,
    customWeek,
    maxSection,
    minSection,
    periods,
    preset,
    totalWeeks,
  ])

  const campuses = campusesQuery.data ?? []
  const buildings = buildingsQuery.data ?? []
  const rooms = useMemo(() => roomsQuery.data ?? [], [roomsQuery.data])
  const hasBuilding = prefs.building !== FILTER_ALL

  const schoolId = providerSnap.schoolId ?? "unknown"
  const semester = snapshot?.semester ?? calendar?.semester ?? "current"
  const scopeKey = hasBuilding ? `${schoolId}:${semester}:${prefs.building}` : null

  const { triggerBuildingScan, resetScan } = props
  useEffect(() => {
    if (!scopeKey) {
      resetScan()
      return
    }
    if (roomsQuery.isLoading || rooms.length === 0) return
    triggerBuildingScan({ scopeKey, rooms })
  }, [resetScan, rooms, roomsQuery.isLoading, scopeKey, triggerBuildingScan])

  const favoriteCodeSet = useMemo(
    () => new Set(prefs.favoriteRooms.map((item) => item.code)),
    [prefs.favoriteRooms]
  )

  const failedCodeSet = useMemo(() => new Set(scan.failedCodes), [scan.failedCodes])

  const availabilities = useMemo(() => {
    if (!hasBuilding || rooms.length === 0) return []
    const isSameScope = scan.scopeKey === scopeKey
    const raw = rooms.map((room) => {
      const courses = isSameScope ? scan.schedulesByRoom[room.code] : undefined
      return computeRoomAvailability(room, courses, periods, activeSlot, {
        failed: isSameScope && failedCodeSet.has(room.code),
      })
    })
    return sortRoomAvailabilities(raw, favoriteCodeSet)
  }, [
    activeSlot,
    failedCodeSet,
    favoriteCodeSet,
    hasBuilding,
    periods,
    rooms,
    scan.schedulesByRoom,
    scan.scopeKey,
    scopeKey,
  ])

  const floors = useMemo(() => {
    const set = new Set<number>()
    for (const room of rooms) {
      if (typeof room.floor === "number" && Number.isFinite(room.floor)) {
        set.add(room.floor)
      }
    }
    return Array.from(set).sort((a, b) => a - b)
  }, [rooms])

  const normalizedKeyword = keyword.trim().toLowerCase()
  const filteredAvailabilities = useMemo(
    () =>
      availabilities.filter((item) => {
        if (prefs.onlyFree && item.status !== "free" && item.status !== "loading") return false
        if (floorFilter !== FILTER_ALL && String(item.room.floor ?? "") !== floorFilter) {
          return false
        }
        if (normalizedKeyword && !item.room.name.toLowerCase().includes(normalizedKeyword)) {
          return false
        }
        return true
      }),
    [availabilities, floorFilter, normalizedKeyword, prefs.onlyFree]
  )

  const freeCount = useMemo(
    () => availabilities.filter((item) => item.status === "free").length,
    [availabilities]
  )

  const slotTimeRange = useMemo(() => {
    const startP = periods.find((p) => p.section === activeSlot.startSection)
    const endP = periods.find((p) => p.section === activeSlot.endSection)
    const start = startP ? periodStartTime(startP) : ""
    const end = endP ? periodEndTime(endP) : ""
    return start && end ? `${start}–${end}` : ""
  }, [activeSlot.endSection, activeSlot.startSection, periods])

  const labels = useMemo(() => buildFreeRoomsScheduleLabels(t), [t])

  if (selectedRoom) {
    const cachedCourses =
      scan.scopeKey === scopeKey ? scan.schedulesByRoom[selectedRoom.code] : undefined
    const detailCourses = cachedCourses ?? selectedRoomScheduleQuery.data ?? []
    const detailLoading = cachedCourses === undefined && selectedRoomScheduleQuery.isLoading
    const isFav = favoriteCodeSet.has(selectedRoom.code)
    const matchedRoom = rooms.find((r) => r.code === selectedRoom.code)

    return (
      <div className="flex flex-col gap-4" data-page="free-rooms">
        <RoomScheduleDetail
          title={selectedRoom.name}
          subtitle={selectedRoom.subtitle}
          courses={detailCourses}
          isLoading={detailLoading}
          isFavorite={isFav}
          onToggleFavorite={() =>
            props.toggleFavoriteRoom({
              code: selectedRoom.code,
              name: selectedRoom.name,
              ...(matchedRoom?.campusDisplay ? { campusDisplay: matchedRoom.campusDisplay } : {}),
              ...(matchedRoom?.buildingDisplay
                ? { buildingDisplay: matchedRoom.buildingDisplay }
                : {}),
              ...(matchedRoom?.classSeats !== undefined
                ? { classSeats: matchedRoom.classSeats }
                : {}),
            })
          }
          snapshot={snapshot}
          calendar={calendar}
          periods={periods}
          clockTick={clockTick}
          scheduleRules={scheduleRules}
          weekOverride={detailWeekOverride}
          initialWeek={activeSlot.week}
          onWeekOverrideChange={actions.setDetailWeekOverride}
          onBack={() => actions.selectRoom(null)}
          t={t}
          labels={labels}
        />
      </div>
    )
  }

  const slotText =
    activeSlot.startSection === activeSlot.endSection
      ? t("slotSummarySingle", {
          week: activeSlot.week,
          weekday: weekdayShortLabel(t, activeSlot.day),
          section: activeSlot.startSection,
        })
      : t("slotSummary", {
          week: activeSlot.week,
          weekday: weekdayShortLabel(t, activeSlot.day),
          start: activeSlot.startSection,
          end: activeSlot.endSection,
        })

  const scanPercent =
    scan.total > 0 ? Math.min(100, Math.round((scan.loaded / scan.total) * 100)) : 0

  return (
    <div className="flex flex-col gap-4" data-page="free-rooms">
      {/* Inline Campus + Building Selector */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field>
              <FieldLabel>{t("campus")}</FieldLabel>
              <ResponsiveSelect
                value={prefs.campus}
                onValueChange={(value) => {
                  actions.setFloorFilter(FILTER_ALL)
                  props.setCampus(value)
                }}
                title={t("campus")}
                items={[
                  { value: FILTER_ALL, label: t("all") },
                  ...campuses.map((item) => ({ value: item.id, label: item.name })),
                ]}
              />
            </Field>
            <Field>
              <FieldLabel>{t("building")}</FieldLabel>
              <ResponsiveSelect
                value={prefs.building}
                onValueChange={(value) => {
                  actions.setFloorFilter(FILTER_ALL)
                  props.setBuilding(value)
                }}
                title={t("building")}
                placeholder={t("selectBuildingPlaceholder")}
                items={[
                  { value: FILTER_ALL, label: t("selectBuildingPlaceholder") },
                  ...buildings.map((item) => ({ value: item.id, label: item.name })),
                ]}
              />
            </Field>
            {hasBuilding && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0"
                disabled={scan.status === "scanning" || !scopeKey || rooms.length === 0}
                onClick={() => {
                  if (scopeKey && rooms.length > 0) {
                    props.triggerBuildingScan({ scopeKey, rooms, forceRefresh: true })
                  }
                }}
                aria-label={t("refresh")}
                title={t("refresh")}
              >
                <RefreshCw className={cn("size-4", scan.status === "scanning" && "animate-spin")} />
              </Button>
            )}
          </div>

          {/* Time preset chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {PRESETS.map((item) => {
              const active = preset === item
              return (
                <Button
                  key={item}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  className="h-7 rounded-full px-3 text-xs"
                  onClick={() => {
                    if (item === "custom") {
                      actions.enterCustomSlot(activeSlot)
                    } else {
                      actions.setPreset(item)
                    }
                  }}
                >
                  {t(`presets.${item}`)}
                </Button>
              )
            })}
          </div>

          {/* Active slot summary */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Clock className="size-3.5 shrink-0 text-primary" />
            <span className="font-medium text-foreground">{slotText}</span>
            {slotTimeRange && <span className="tabular-nums">({slotTimeRange})</span>}
          </div>

          {/* Custom slot picker */}
          {preset === "custom" && (
            <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("weekLabel")}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() => actions.setCustomWeek(activeSlot.week - 1)}
                    aria-label={t("schedule.weekPrev")}
                  >
                    <ChevronLeft className="size-3.5" />
                  </Button>
                  <span className="min-w-12 text-center text-xs font-semibold tabular-nums">
                    {t("schedule.weekShort", { week: activeSlot.week })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={() => actions.setCustomWeek(Math.min(totalWeeks, activeSlot.week + 1))}
                    aria-label={t("schedule.weekNext")}
                  >
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("sectionRangeLabel")}
                  </span>
                  <Input
                    type="number"
                    min={minSection}
                    max={maxSection}
                    value={activeSlot.startSection}
                    aria-label={t("startSection")}
                    className="h-7 w-14 px-2 text-center text-xs"
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10)
                      if (!Number.isNaN(next)) {
                        const clamped = Math.max(minSection, Math.min(maxSection, next))
                        actions.setCustomSections(clamped, Math.max(clamped, activeSlot.endSection))
                      }
                    }}
                  />
                  <span className="text-xs text-muted-foreground">–</span>
                  <Input
                    type="number"
                    min={activeSlot.startSection}
                    max={maxSection}
                    value={activeSlot.endSection}
                    aria-label={t("endSection")}
                    className="h-7 w-14 px-2 text-center text-xs"
                    onChange={(event) => {
                      const next = Number.parseInt(event.target.value, 10)
                      if (!Number.isNaN(next)) {
                        const clamped = Math.max(
                          activeSlot.startSection,
                          Math.min(maxSection, next)
                        )
                        actions.setCustomSections(activeSlot.startSection, clamped)
                      }
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((day) => (
                  <Button
                    key={day}
                    type="button"
                    size="sm"
                    variant={activeSlot.day === day ? "default" : "outline"}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => actions.setCustomDay(day)}
                  >
                    {weekdayShortLabel(t, day)}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Starred rooms quick strip */}
      {prefs.favoriteRooms.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Star className="size-3.5 fill-amber-400 text-amber-400" />
            {t("favoritesTitle")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {prefs.favoriteRooms.map((fav) => (
              <Button
                key={fav.code}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 rounded-full px-3 text-xs"
                onClick={() =>
                  actions.selectRoom({
                    code: fav.code,
                    name: fav.name,
                    subtitle: [fav.campusDisplay, fav.buildingDisplay].filter(Boolean).join(" · "),
                  })
                }
              >
                <DoorOpen className="size-3 text-muted-foreground" />
                {fav.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Results area */}
      {!hasBuilding ? (
        <EmptyState icon={<Building2 />} title={t("selectBuildingHint")} />
      ) : roomsQuery.isLoading && rooms.length === 0 ? (
        <LoadingCards />
      ) : rooms.length === 0 ? (
        <EmptyState title={t("noRoomsInBuilding")} />
      ) : (
        <div className="flex flex-col gap-3">
          {/* Scan progress or cache hint */}
          {scan.status === "scanning" && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{t("scanningProgress", { loaded: scan.loaded, total: scan.total })}</span>
                <span className="font-medium tabular-nums">{scanPercent}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-primary/15">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${scanPercent}%` }}
                />
              </div>
            </div>
          )}

          {scan.status === "error" && (
            <Alert variant="destructive">
              <TriangleAlert className="size-4" />
              <AlertDescription className="flex items-center justify-between gap-2">
                <span>{scan.errorMessage || t("scanFailed")}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (scopeKey) {
                      props.triggerBuildingScan({ scopeKey, rooms, forceRefresh: true })
                    }
                  }}
                >
                  {t("retry")}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {scan.status === "ready" && scan.failed > 0 && (
            <Alert>
              <TriangleAlert className="size-4" />
              <AlertDescription>{t("scanPartialWarning", { count: scan.failed })}</AlertDescription>
            </Alert>
          )}

          {/* Result summary & filters */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-xs font-medium">
                {t("freeCountSummary", { free: freeCount, total: rooms.length })}
              </Badge>
              {scan.status === "ready" && scan.failed === 0 && (
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {t("scanCachedHint")}
                </span>
              )}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
              <span>{t("onlyFree")}</span>
              <Switch checked={prefs.onlyFree} onCheckedChange={props.setOnlyFree} />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-40 flex-1 sm:max-w-56">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={keyword}
                onChange={(event) => actions.setKeyword(event.target.value)}
                placeholder={t("roomKeywordPlaceholder")}
                className="h-8 pl-8 text-xs"
              />
            </div>
            {floors.length > 1 && (
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={floorFilter === FILTER_ALL ? "secondary" : "ghost"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => actions.setFloorFilter(FILTER_ALL)}
                >
                  {t("allFloors")}
                </Button>
                {floors.map((floor) => (
                  <Button
                    key={floor}
                    type="button"
                    size="sm"
                    variant={floorFilter === String(floor) ? "secondary" : "ghost"}
                    className="h-7 px-2 text-xs"
                    onClick={() => actions.setFloorFilter(String(floor))}
                  >
                    {t("floorLabel", { floor })}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Room list */}
          {filteredAvailabilities.length === 0 ? (
            <EmptyState
              title={
                prefs.onlyFree && !normalizedKeyword && floorFilter === FILTER_ALL
                  ? t("noFreeRooms")
                  : t("noMatchingRooms")
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {filteredAvailabilities.map((item) => (
                <RoomAvailabilityCard
                  key={item.room.code}
                  item={item}
                  isFavorite={favoriteCodeSet.has(item.room.code)}
                  onSelect={() =>
                    actions.selectRoom({
                      code: item.room.code,
                      name: item.room.name,
                      subtitle: [
                        item.room.campusDisplay,
                        item.room.buildingDisplay,
                        item.room.typeDisplay,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    })
                  }
                  onToggleFavorite={() =>
                    props.toggleFavoriteRoom({
                      code: item.room.code,
                      name: item.room.name,
                      ...(item.room.campusDisplay
                        ? { campusDisplay: item.room.campusDisplay }
                        : {}),
                      ...(item.room.buildingDisplay
                        ? { buildingDisplay: item.room.buildingDisplay }
                        : {}),
                      ...(item.room.classSeats !== undefined
                        ? { classSeats: item.room.classSeats }
                        : {}),
                    })
                  }
                  t={t}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
