import { useMemo, useState, type ReactNode } from "react"
import { ArrowLeft, CalendarSearch, ChevronLeft, ChevronRight, Search } from "lucide-react"
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
  RouteLocation,
  SlotComponent,
  Translator,
} from "@orahako/sdk"
import {
  Badge,
  Button,
  cn,
  EmptyState,
  Field,
  FieldGroup,
  FieldLabel,
  FilterDrawer,
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
import { buildSchoolScheduleLabels, weekdayName, type SchoolScheduleDictionary } from "./dictionary"
import {
  FILTER_ALL,
  type SchoolScheduleFilterStoreInstance,
  type SchoolScheduleTab,
  type SelectedClassroom,
  type SelectedSchoolClass,
} from "./store"

export interface FreeRoomContext {
  readonly week: number
  readonly day: number
  readonly section: number
}

export interface SchoolSchedulePageInject {
  readonly onTabChange: (tab: SchoolScheduleTab) => void
  readonly hooks: {
    readonly location: ObservableSource<RouteLocation>
    readonly clockTick: ObservableSource<number>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
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

function parseFreeRoomContext(location: RouteLocation): FreeRoomContext | null {
  const week = Number(location.params.week)
  const day = Number(location.params.day)
  const section = Number(location.params.section)
  if (
    Number.isInteger(week) &&
    week >= 1 &&
    Number.isInteger(day) &&
    day >= 1 &&
    day <= 7 &&
    Number.isInteger(section) &&
    section >= 1
  ) {
    return { week, day, section }
  }
  return null
}

function ClassRow({
  cls,
  t,
  onSelect,
}: {
  readonly cls: SchoolClassInfo
  readonly t: Translator<SchoolScheduleDictionary>
  readonly onSelect: (selected: SelectedSchoolClass) => void
}): ReactNode {
  const unscheduled = cls.isScheduled === false
  return (
    <button
      type="button"
      data-school-class-id={cls.classId}
      onClick={() => onSelect({ classId: cls.classId, className: cls.className })}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-left transition-colors active:bg-muted/60",
        unscheduled && "opacity-60"
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{cls.className}</span>
        <span className="truncate text-xs text-muted-foreground">
          {[cls.gradeDisplay, cls.departmentDisplay, cls.majorDisplay].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div className="flex shrink-0 gap-1">
        {unscheduled && <Badge variant="secondary">{t("unscheduled")}</Badge>}
        {cls.studentCount !== undefined && (
          <Badge variant="outline">{t("studentCount", { count: cls.studentCount })}</Badge>
        )}
      </div>
    </button>
  )
}

function RoomRow({
  room,
  t,
  onSelect,
}: {
  readonly room: ClassroomInfo
  readonly t: Translator<SchoolScheduleDictionary>
  readonly onSelect: (selected: SelectedClassroom) => void
}): ReactNode {
  const unscheduled = room.isScheduled === false
  return (
    <button
      type="button"
      data-school-room-code={room.code}
      onClick={() => onSelect({ code: room.code, name: room.name })}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-left transition-colors active:bg-muted/60",
        unscheduled && "opacity-60"
      )}
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{room.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {[room.campusDisplay, room.buildingDisplay, room.typeDisplay].filter(Boolean).join(" · ")}
        </span>
      </div>
      <div className="flex shrink-0 gap-1">
        {unscheduled && <Badge variant="secondary">{t("unscheduled")}</Badge>}
        {room.classSeats !== undefined && (
          <Badge variant="outline">{t("seats", { count: room.classSeats })}</Badge>
        )}
      </div>
    </button>
  )
}

function CourseScheduleView({
  title,
  subtitle,
  courses,
  isLoading,
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
      <div className="flex items-center gap-2">
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
  const location = props.useLocation()
  const clockTick = props.useClockTick()
  const providerSnap = props.useProvider()
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

  const tab = useStore((s) => s.tab)
  const grade = useStore((s) => s.grade)
  const department = useStore((s) => s.department)
  const major = useStore((s) => s.major)
  const selectedClass = useStore((s) => s.selectedClass)
  const classDrawerOpen = useStore((s) => s.classDrawerOpen)
  const campus = useStore((s) => s.campus)
  const building = useStore((s) => s.building)
  const roomNameInput = useStore((s) => s.roomNameInput)
  const searchedRoomName = useStore((s) => s.searchedRoomName)
  const selectedRoom = useStore((s) => s.selectedRoom)
  const roomDrawerOpen = useStore((s) => s.roomDrawerOpen)
  const weekOverride = useStore((s) => s.weekOverride)

  const freeRoomContext = useMemo(() => parseFreeRoomContext(location), [location])

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
  const classes = classesQuery.data ?? []
  const campuses = campusesQuery.data ?? []
  const buildings = buildingsQuery.data ?? []
  const rooms = roomsQuery.data ?? []

  const hasClassFilter = grade !== FILTER_ALL || department !== FILTER_ALL || major !== FILTER_ALL
  const hasRoomFilter = searchedRoomName !== "" || campus !== FILTER_ALL || building !== FILTER_ALL
  const classFilterControls = (
    <FieldGroup className="flex flex-col gap-3 md:flex-row">
      <Field className="flex-1">
        <FieldLabel>{t("grade")}</FieldLabel>
        <ResponsiveSelect
          nested
          value={grade}
          onValueChange={actions.setGrade}
          title={t("grade")}
          items={[
            { value: FILTER_ALL, label: t("all") },
            ...gradeYears.map((item) => ({ value: item.id, label: item.name })),
          ]}
        />
      </Field>
      <Field className="flex-1">
        <FieldLabel>{t("department")}</FieldLabel>
        <ResponsiveSelect
          nested
          value={department}
          onValueChange={actions.setDepartment}
          title={t("department")}
          items={[
            { value: FILTER_ALL, label: t("all") },
            ...departments.map((item) => ({ value: item.id, label: item.name })),
          ]}
        />
      </Field>
      <Field className="flex-1">
        <FieldLabel>{t("major")}</FieldLabel>
        <ResponsiveSelect
          nested
          value={major}
          onValueChange={actions.setMajor}
          title={t("major")}
          items={[
            { value: FILTER_ALL, label: t("all") },
            ...majors.map((item) => ({ value: item.id, label: item.name })),
          ]}
        />
      </Field>
    </FieldGroup>
  )

  const renderRoomFilterControls = (idPrefix: string): ReactNode => (
    <FieldGroup className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 md:flex-row">
        <Field className="flex-1">
          <FieldLabel>{t("campus")}</FieldLabel>
          <ResponsiveSelect
            nested
            value={campus}
            onValueChange={actions.setCampus}
            title={t("campus")}
            items={[
              { value: FILTER_ALL, label: t("all") },
              ...campuses.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </Field>
        <Field className="flex-1">
          <FieldLabel>{t("building")}</FieldLabel>
          <ResponsiveSelect
            nested
            value={building}
            onValueChange={actions.setBuilding}
            title={t("building")}
            items={[
              { value: FILTER_ALL, label: t("all") },
              ...buildings.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-room-name`}>{t("roomTab")}</FieldLabel>
        <div className="flex gap-2">
          <Input
            id={`${idPrefix}-room-name`}
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
      </Field>
    </FieldGroup>
  )

  return (
    <div className="flex flex-col gap-6" data-page="school-schedule">
      <Tabs
        value={tab}
        onValueChange={(value) => props.onTabChange(value === "room" ? "room" : "class")}
      >
        <TabsList className="w-full">
          <TabsTrigger value="class">{t("classTab")}</TabsTrigger>
          <TabsTrigger value="room">{t("roomTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="class" className="mt-4">
          {selectedClass ? (
            <CourseScheduleView
              title={selectedClass.className}
              courses={classScheduleQuery.data ?? []}
              isLoading={classScheduleQuery.isLoading}
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
              <div className="hidden md:block">{classFilterControls}</div>
              <FilterDrawer
                open={classDrawerOpen}
                onOpenChange={actions.setClassDrawerOpen}
                title={t("classTab")}
              >
                {classFilterControls}
              </FilterDrawer>

              {!hasClassFilter ? (
                <EmptyState title={t("selectHint")} />
              ) : (classesQuery.isLoading || classesQuery.isRefreshing) && classes.length === 0 ? (
                <LoadingCards />
              ) : classes.length === 0 ? (
                <EmptyState title={t("noClasses")} />
              ) : (
                <ValidatingList
                  validating={classesQuery.isRefreshing}
                  className="flex flex-col gap-2"
                >
                  {classes.map((cls) => (
                    <ClassRow key={cls.classId} cls={cls} t={t} onSelect={actions.selectClass} />
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
              courses={roomScheduleQuery.data ?? []}
              isLoading={roomScheduleQuery.isLoading}
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
              {freeRoomContext && (
                <div
                  data-free-room-context=""
                  className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
                >
                  <CalendarSearch className="size-4 shrink-0 text-primary" />
                  <span>
                    {t("freeRoomContext", {
                      week: freeRoomContext.week,
                      weekday: weekdayName(t, freeRoomContext.day),
                      section: freeRoomContext.section,
                    })}
                  </span>
                </div>
              )}
              <div className="hidden md:block">{renderRoomFilterControls("room-desktop")}</div>
              <FilterDrawer
                open={roomDrawerOpen}
                onOpenChange={actions.setRoomDrawerOpen}
                title={t("roomTab")}
              >
                {renderRoomFilterControls("room-drawer")}
              </FilterDrawer>

              {!hasRoomFilter ? (
                <EmptyState title={t("selectHint")} />
              ) : (roomsQuery.isLoading || roomsQuery.isRefreshing) && rooms.length === 0 ? (
                <LoadingCards />
              ) : rooms.length === 0 ? (
                <EmptyState title={t("noRooms")} />
              ) : (
                <ValidatingList
                  validating={roomsQuery.isRefreshing}
                  className="flex flex-col gap-2"
                >
                  {rooms.map((room) => (
                    <RoomRow key={room.code} room={room} t={t} onSelect={actions.selectRoom} />
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
