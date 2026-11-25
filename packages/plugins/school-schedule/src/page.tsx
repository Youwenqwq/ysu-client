import { useMemo, useState, type ReactNode } from "react"
import { ArrowLeft, ChevronLeft, ChevronRight, Search, Star } from "lucide-react"
import {
  buildCourseColorMap,
  getAcademicClock,
  isCourseActiveInWeek,
  periodIsInUse,
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
  MajorInfo,
  ProviderRuntimeSnapshot,
  QuerySnapshot,
  SchoolClassInfo,
  TermCalendar,
} from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  SlotComponent,
  Translator,
} from "@orahako/sdk"
import {
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useErrorToast,
  useIsMobile,
  ValidatingList,
} from "@orahako/ui-primitives"
import { buildSchoolScheduleLabels, type SchoolScheduleDictionary } from "./dictionary"
import {
  FILTER_ALL,
  type SchoolScheduleFilterStoreInstance,
  type SchoolSchedulePrefsState,
  type SchoolScheduleTab,
  type SelectedClassroom,
  type SelectedSchoolClass,
} from "./store"

export interface SchoolSchedulePageInject {
  readonly setTab: (tab: SchoolScheduleTab) => void
  readonly setGrade: (grade: string) => void
  readonly setDepartment: (department: string) => void
  readonly setMajor: (major: string) => void
  readonly setCampus: (campus: string) => void
  readonly setBuilding: (building: string) => void
  readonly toggleFavoriteClass: (cls: SelectedSchoolClass) => void
  readonly toggleFavoriteRoom: (room: SelectedClassroom) => void
  readonly hooks: {
    readonly clockTick: ObservableSource<number>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly prefs: ObservableSource<SchoolSchedulePrefsState>
    readonly currentWeek: ObservableSource<QuerySnapshot<CurrentWeek>>
    readonly termCalendar: ObservableSource<QuerySnapshot<TermCalendar>>
    readonly periods: ObservableSource<QuerySnapshot<ClassPeriod[]>>
    readonly gradeYears: ObservableSource<QuerySnapshot<CodeItem[]>>
    readonly departments: ObservableSource<QuerySnapshot<CodeItem[]>>
    readonly majors: ObservableSource<QuerySnapshot<MajorInfo[]>>
    readonly classes: ObservableSource<QuerySnapshot<SchoolClassInfo[]>>
    readonly classSchedule: ObservableSource<QuerySnapshot<Course[]>>
    readonly campuses: ObservableSource<QuerySnapshot<CodeItem[]>>
    readonly buildings: ObservableSource<QuerySnapshot<CodeItem[]>>
    readonly rooms: ObservableSource<QuerySnapshot<ClassroomInfo[]>>
    readonly roomSchedule: ObservableSource<QuerySnapshot<Course[]>>
  }
}

export type SchoolSchedulePageProps = DerivedComponentProps<
  Record<string, never>,
  SchoolScheduleDictionary,
  undefined,
  SchoolScheduleFilterStoreInstance,
  SchoolSchedulePageInject
>

function ClassRow({
  cls,
  isFavorite,
  t,
  onSelect,
  onToggleFavorite,
}: {
  readonly cls: SchoolClassInfo
  readonly isFavorite: boolean
  readonly t: Translator<SchoolScheduleDictionary>
  readonly onSelect: (selected: SelectedSchoolClass) => void
  readonly onToggleFavorite: (selected: SelectedSchoolClass) => void
}): ReactNode {
  const unscheduled = cls.isScheduled === false
  const subtitle = [cls.gradeDisplay, cls.departmentDisplay, cls.majorDisplay]
    .filter(Boolean)
    .join(" · ")
  const item: SelectedSchoolClass = {
    classId: cls.classId,
    className: cls.className,
    ...(subtitle ? { subtitle } : {}),
  }

  return (
    <div
      data-school-class-id={cls.classId}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border border-border/80 bg-card/60 px-3 py-2.5 transition-colors hover:bg-accent/35",
        unscheduled && "opacity-60"
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
      >
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{cls.className}</span>
          {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
        </div>
        <div className="flex shrink-0 gap-1">
          {unscheduled && <Badge variant="secondary">{t("unscheduled")}</Badge>}
          {cls.studentCount !== undefined && (
            <Badge variant="outline">{t("studentCount", { count: cls.studentCount })}</Badge>
          )}
        </div>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        onClick={() => onToggleFavorite(item)}
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

function RoomRow({
  room,
  isFavorite,
  t,
  onSelect,
  onToggleFavorite,
}: {
  readonly room: ClassroomInfo
  readonly isFavorite: boolean
  readonly t: Translator<SchoolScheduleDictionary>
  readonly onSelect: (selected: SelectedClassroom) => void
  readonly onToggleFavorite: (selected: SelectedClassroom) => void
}): ReactNode {
  const unscheduled = room.isScheduled === false
  const subtitle = [room.campusDisplay, room.buildingDisplay, room.typeDisplay]
    .filter(Boolean)
    .join(" · ")
  const item: SelectedClassroom = {
    code: room.code,
    name: room.name,
    ...(subtitle ? { subtitle } : {}),
  }

  return (
    <div
      data-school-room-code={room.code}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border border-border/80 bg-card/60 px-3 py-2.5 transition-colors hover:bg-accent/35",
        unscheduled && "opacity-60"
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(item)}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
      >
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{room.name}</span>
          {subtitle && <span className="truncate text-xs text-muted-foreground">{subtitle}</span>}
        </div>
        <div className="flex shrink-0 gap-1">
          {unscheduled && <Badge variant="secondary">{t("unscheduled")}</Badge>}
          {room.classSeats !== undefined && (
            <Badge variant="outline">{t("seats", { count: room.classSeats })}</Badge>
          )}
        </div>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        onClick={() => onToggleFavorite(item)}
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

function CourseScheduleView({
  title,
  subtitle,
  courses,
  isLoading,
  isFavorite,
  onToggleFavorite,
  snapshot,
  calendar,
  rawPeriods,
  clockTick,
  scheduleRules,
  weekOverride,
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
  readonly rawPeriods: readonly ClassPeriod[]
  readonly clockTick: number
  readonly scheduleRules?: AcademicScheduleRules
  readonly weekOverride: number | null
  readonly onWeekOverrideChange: (week: number | null) => void
  readonly onBack: () => void
  readonly t: Translator<SchoolScheduleDictionary>
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
  const periods = useMemo(
    () => rawPeriods.filter(periodIsInUse).sort((a, b) => a.section - b.section),
    [rawPeriods]
  )

  const selectedWeek = weekOverride ?? currentWeek?.week ?? 1
  const colorMap = useMemo(() => buildCourseColorMap(courses), [courses])
  const weekCourses = useMemo(
    () => courses.filter((course) => isCourseActiveInWeek(course, selectedWeek)),
    [courses, selectedWeek]
  )
  const [detailCourse, setDetailCourse] = useState<Course | null>(null)
  const isCurrentWeek = currentWeek?.week === selectedWeek

  const shiftWeek = (delta: number): void => {
    const nextWeek = Math.max(1, selectedWeek + delta)
    onWeekOverrideChange(nextWeek === currentWeek?.week ? null : nextWeek)
  }

  const detailRows = useMemo(() => {
    if (!detailCourse) return []
    const rows: Array<{ label: string; value: string }> = []
    if (detailCourse.teacher) {
      rows.push({ label: t("schedule.teacher"), value: detailCourse.teacher })
    }
    if (detailCourse.weeks) {
      rows.push({ label: t("schedule.weeks"), value: detailCourse.weeks })
    }
    rows.push({
      label: t("schedule.sections"),
      value: t("sections", {
        start: detailCourse.startSection,
        end: detailCourse.endSection,
      }),
    })
    if (detailCourse.classroom) {
      rows.push({ label: t("schedule.classroom"), value: detailCourse.classroom })
    }
    return rows
  }, [detailCourse, t])

  return (
    <div className="flex flex-col gap-3" data-school-schedule-detail="">
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
              onCourseTap={(course) => setDetailCourse(course)}
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
              onCourseTap={(course) => setDetailCourse(course)}
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
          <ResponsiveModalBody>
            <div className="flex flex-col gap-2 text-sm">
              {detailRows.map((row) => (
                <div key={row.label} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{row.label}</span>
                  <span>{row.value}</span>
                </div>
              ))}
            </div>
          </ResponsiveModalBody>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </div>
  )
}

export const SchoolSchedulePage: SlotComponent<SchoolSchedulePageProps> = (props) => {
  const { t, useStore, actions } = props
  const clockTick = props.useClockTick()
  const providerSnap = props.useProvider()
  const prefs = props.usePrefs()
  const scheduleRules = providerSnap.provider?.slices.timetable?.scheduleRules
  const currentWeekQuery = props.useCurrentWeek()
  const termCalendarQuery = props.useTermCalendar()
  const periodsQuery = props.usePeriods()
  const gradeYearsQuery = props.useGradeYears()
  const departmentsQuery = props.useDepartments()
  const majorsQuery = props.useMajors()
  const classesQuery = props.useClasses()
  const classScheduleQuery = props.useClassSchedule()
  const campusesQuery = props.useCampuses()
  const buildingsQuery = props.useBuildings()
  const roomsQuery = props.useRooms()
  const roomScheduleQuery = props.useRoomSchedule()

  const classKeyword = useStore((s) => s.classKeyword)
  const selectedClass = useStore((s) => s.selectedClass)
  const roomNameInput = useStore((s) => s.roomNameInput)
  const searchedRoomName = useStore((s) => s.searchedRoomName)
  const selectedRoom = useStore((s) => s.selectedRoom)
  const weekOverride = useStore((s) => s.weekOverride)

  useErrorToast(
    gradeYearsQuery.error ??
      departmentsQuery.error ??
      majorsQuery.error ??
      classesQuery.error ??
      classScheduleQuery.error ??
      campusesQuery.error ??
      buildingsQuery.error ??
      roomsQuery.error ??
      roomScheduleQuery.error ??
      undefined
  )

  const labels = useMemo(() => buildSchoolScheduleLabels(t), [t])

  const gradeYears = gradeYearsQuery.data ?? []
  const departments = departmentsQuery.data ?? []
  const majors = majorsQuery.data ?? []
  const classes = useMemo(() => classesQuery.data ?? [], [classesQuery.data])
  const campuses = campusesQuery.data ?? []
  const buildings = buildingsQuery.data ?? []
  const rooms = roomsQuery.data ?? []

  const hasClassFilter =
    prefs.grade !== FILTER_ALL || prefs.department !== FILTER_ALL || prefs.major !== FILTER_ALL
  const hasRoomFilter =
    searchedRoomName !== "" || prefs.campus !== FILTER_ALL || prefs.building !== FILTER_ALL

  const favoriteClassIds = useMemo(
    () => new Set(prefs.favoriteClasses.map((item) => item.classId)),
    [prefs.favoriteClasses]
  )
  const favoriteRoomCodes = useMemo(
    () => new Set(prefs.favoriteRooms.map((item) => item.code)),
    [prefs.favoriteRooms]
  )

  const normalizedClassKeyword = classKeyword.trim().toLowerCase()
  const filteredClasses = useMemo(
    () =>
      normalizedClassKeyword
        ? classes.filter(
            (cls) =>
              cls.className.toLowerCase().includes(normalizedClassKeyword) ||
              (cls.majorDisplay ?? "").toLowerCase().includes(normalizedClassKeyword)
          )
        : classes,
    [classes, normalizedClassKeyword]
  )

  return (
    <div className="flex flex-col gap-4" data-page="school-schedule">
      <Tabs
        value={prefs.tab}
        onValueChange={(value) => props.setTab(value === "room" ? "room" : "class")}
      >
        <TabsList className="w-full">
          <TabsTrigger value="class">{t("classTab")}</TabsTrigger>
          <TabsTrigger value="room">{t("roomTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="class" className="mt-4">
          {selectedClass ? (
            <CourseScheduleView
              title={selectedClass.className}
              subtitle={selectedClass.subtitle}
              courses={classScheduleQuery.data ?? []}
              isLoading={classScheduleQuery.isLoading}
              isFavorite={favoriteClassIds.has(selectedClass.classId)}
              onToggleFavorite={() => props.toggleFavoriteClass(selectedClass)}
              snapshot={currentWeekQuery.data ?? null}
              calendar={termCalendarQuery.data}
              rawPeriods={periodsQuery.data ?? []}
              clockTick={clockTick}
              scheduleRules={scheduleRules}
              weekOverride={weekOverride}
              onWeekOverrideChange={actions.setWeekOverride}
              onBack={() => actions.selectClass(null)}
              t={t}
              labels={labels}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {prefs.favoriteClasses.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Star className="size-3.5 fill-amber-400 text-amber-400" />
                    {t("favoritesClasses")}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {prefs.favoriteClasses.map((fav) => (
                      <Button
                        key={fav.classId}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-full px-3 text-xs"
                        onClick={() => actions.selectClass(fav)}
                      >
                        {fav.className}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <Card>
                <CardContent className="flex flex-col gap-3 pt-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <Field>
                      <FieldLabel>{t("grade")}</FieldLabel>
                      <ResponsiveSelect
                        value={prefs.grade}
                        onValueChange={props.setGrade}
                        title={t("grade")}
                        items={[
                          { value: FILTER_ALL, label: t("all") },
                          ...gradeYears.map((item) => ({ value: item.id, label: item.name })),
                        ]}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>{t("department")}</FieldLabel>
                      <ResponsiveSelect
                        value={prefs.department}
                        onValueChange={props.setDepartment}
                        title={t("department")}
                        items={[
                          { value: FILTER_ALL, label: t("all") },
                          ...departments.map((item) => ({ value: item.id, label: item.name })),
                        ]}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>{t("major")}</FieldLabel>
                      <ResponsiveSelect
                        value={prefs.major}
                        onValueChange={props.setMajor}
                        title={t("major")}
                        items={[
                          { value: FILTER_ALL, label: t("all") },
                          ...majors.map((item) => ({ value: item.id, label: item.name })),
                        ]}
                      />
                    </Field>
                  </div>

                  {hasClassFilter && classes.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="relative min-w-44 flex-1 sm:max-w-72">
                        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={classKeyword}
                          onChange={(event) => actions.setClassKeyword(event.target.value)}
                          placeholder={t("classKeywordPlaceholder")}
                          className="h-8 pl-8 text-xs"
                        />
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {t("resultCount", { count: filteredClasses.length })}
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>

              {!hasClassFilter ? (
                <EmptyState title={t("selectClassHint")} />
              ) : (classesQuery.isLoading || classesQuery.isRefreshing) && classes.length === 0 ? (
                <LoadingCards />
              ) : filteredClasses.length === 0 ? (
                <EmptyState title={t("noClasses")} />
              ) : (
                <ValidatingList
                  validating={classesQuery.isRefreshing}
                  className="grid grid-cols-1 gap-2 md:grid-cols-2"
                >
                  {filteredClasses.map((cls) => (
                    <ClassRow
                      key={cls.classId}
                      cls={cls}
                      isFavorite={favoriteClassIds.has(cls.classId)}
                      t={t}
                      onSelect={actions.selectClass}
                      onToggleFavorite={props.toggleFavoriteClass}
                    />
                  ))}
                </ValidatingList>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="room" className="mt-4">
          {selectedRoom ? (
            <CourseScheduleView
              title={selectedRoom.name}
              subtitle={selectedRoom.subtitle}
              courses={roomScheduleQuery.data ?? []}
              isLoading={roomScheduleQuery.isLoading}
              isFavorite={favoriteRoomCodes.has(selectedRoom.code)}
              onToggleFavorite={() => props.toggleFavoriteRoom(selectedRoom)}
              snapshot={currentWeekQuery.data ?? null}
              calendar={termCalendarQuery.data}
              rawPeriods={periodsQuery.data ?? []}
              clockTick={clockTick}
              scheduleRules={scheduleRules}
              weekOverride={weekOverride}
              onWeekOverrideChange={actions.setWeekOverride}
              onBack={() => actions.selectRoom(null)}
              t={t}
              labels={labels}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {prefs.favoriteRooms.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Star className="size-3.5 fill-amber-400 text-amber-400" />
                    {t("favoritesRooms")}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {prefs.favoriteRooms.map((fav) => (
                      <Button
                        key={fav.code}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 rounded-full px-3 text-xs"
                        onClick={() => actions.selectRoom(fav)}
                      >
                        {fav.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <Card>
                <CardContent className="flex flex-col gap-3 pt-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>{t("campus")}</FieldLabel>
                      <ResponsiveSelect
                        value={prefs.campus}
                        onValueChange={props.setCampus}
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
                        onValueChange={props.setBuilding}
                        title={t("building")}
                        items={[
                          { value: FILTER_ALL, label: t("all") },
                          ...buildings.map((item) => ({ value: item.id, label: item.name })),
                        ]}
                      />
                    </Field>
                  </div>

                  <div className="flex gap-2">
                    <Input
                      id="school-schedule-room-name"
                      value={roomNameInput}
                      onChange={(event) => actions.setRoomNameInput(event.target.value)}
                      placeholder={t("roomNamePlaceholder")}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          actions.submitRoomSearch()
                        }
                      }}
                    />
                    <Button type="button" onClick={() => actions.submitRoomSearch()}>
                      <Search data-icon="inline-start" />
                      {t("searchRoom")}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {!hasRoomFilter ? (
                <EmptyState title={t("selectRoomHint")} />
              ) : (roomsQuery.isLoading || roomsQuery.isRefreshing) && rooms.length === 0 ? (
                <LoadingCards />
              ) : rooms.length === 0 ? (
                <EmptyState title={t("noRooms")} />
              ) : (
                <ValidatingList
                  validating={roomsQuery.isRefreshing}
                  className="grid grid-cols-1 gap-2 md:grid-cols-2"
                >
                  {rooms.map((room) => (
                    <RoomRow
                      key={room.code}
                      room={room}
                      isFavorite={favoriteRoomCodes.has(room.code)}
                      t={t}
                      onSelect={actions.selectRoom}
                      onToggleFavorite={props.toggleFavoriteRoom}
                    />
                  ))}
                </ValidatingList>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
