import { useEffect, useMemo, useState, type ReactNode } from "react"
import { toast } from "sonner"
import {
  CalendarDays,
  CalendarSearch,
  Check,
  ChevronLeft,
  ChevronRight,
  Grid3x2,
  Grid3x3,
  History,
  Pencil,
  Search,
  TriangleAlert,
  Undo2,
} from "lucide-react"
import {
  buildCourseColorMap,
  computeExamBlocks,
  getAcademicClock,
  isCourseActiveInWeek,
  parseTimeToMinutes,
  periodIsInUse,
  resolveAcademicWeek,
  schedulePatchAffectsWeek,
  scheduleWeek,
  ScheduleMobile,
  ScheduleTablet,
  type ScheduleDrop,
  type ScheduleSelection,
} from "@orahako/academic-kit"
import {
  hasSlice,
  isProviderError,
  ProviderErrorCode,
  supportsPlugin,
  type ClassPeriod,
  type Course,
  type CurrentWeek,
  type Exam,
  type ProviderRuntimeSnapshot,
  type QuerySnapshot,
  type SessionSnapshot,
  type TermCalendar,
} from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  RouteLocation,
  SlotComponent,
} from "@orahako/sdk"
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  FieldGroup,
  FieldLabel,
  FilterDrawer,
  FilterTrigger,
  Input,
  Skeleton,
  Spinner,
  useBackHandler,
  useIsMobile,
} from "@orahako/ui-primitives"
import {
  buildScheduleLabels,
  formatScheduleEditorError,
  type ScheduleDictionary,
} from "./dictionary"
import { ScheduleDragSurface } from "./drag-surface"
import {
  ScheduleAdjustmentDialog,
  ScheduleAdjustmentsDialog,
  type ScheduleAdjustmentsDialogView,
} from "./editor-dialogs"
import { CourseActivityModal, CourseSigninModal, type MobileLessonBridge } from "./modals"
import {
  computeEffectiveScheduleSnapshot,
  type SchedulePatchDraft,
  type SchedulePatchesState,
  type SchedulePatchMutators,
  type ScheduleSettingsState,
  type ScheduleViewStoreInstance,
  type WidgetAssistantPosition,
} from "./stores"
import { WidgetDiscovery } from "./widget-discovery"

export interface FreeRoomTargetParams {
  readonly week: number
  readonly day?: number
  readonly section?: number
}

export interface SchedulePageInject {
  readonly hooks: {
    readonly clockTick: ObservableSource<number>
    readonly settings: ObservableSource<ScheduleSettingsState>
    readonly patches: ObservableSource<SchedulePatchesState>
    readonly patchesHydrated: ObservableSource<boolean>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly session: ObservableSource<SessionSnapshot>
    readonly schedule: ObservableSource<QuerySnapshot<Course[]>>
    readonly currentWeek: ObservableSource<QuerySnapshot<CurrentWeek>>
    readonly termCalendar: ObservableSource<QuerySnapshot<TermCalendar>>
    readonly periods: ObservableSource<QuerySnapshot<ClassPeriod[]>>
    readonly exams: ObservableSource<QuerySnapshot<Exam[]>>
  }
  readonly patchMutators: SchedulePatchMutators
  readonly mobileBridge: MobileLessonBridge
  readonly pluginId: string
  readonly isNative: () => boolean
  readonly setCompactMode: (compact: boolean) => void
  readonly setWidgetAssistantHidden: (hidden: boolean) => void
  readonly setWidgetAssistantPosition: (position: WidgetAssistantPosition | null) => void
  readonly requestPinScheduleWidget: () => Promise<boolean>
  readonly widgetsSettingsHref: string
  readonly openWidgetsSettings: () => void
  readonly openSchoolSchedule: () => void
  readonly openFreeRooms: (params: FreeRoomTargetParams) => void
}

export type SchedulePageProps = DerivedComponentProps<
  Record<string, never>,
  ScheduleDictionary,
  undefined,
  ScheduleViewStoreInstance,
  SchedulePageInject
>

function computeCurrentOrUpcomingSection(
  periods: readonly ClassPeriod[],
  weekday: number,
  nowMinutes: number
): number | null {
  if (weekday <= 0) return null
  for (const period of periods) {
    const start = parseTimeToMinutes(period.startTime)
    const end = parseTimeToMinutes(period.endTime)
    if (start === null || end === null) continue
    if (nowMinutes >= start && nowMinutes < end) return period.section
  }
  const upcoming = periods.find((period) => {
    const start = parseTimeToMinutes(period.startTime)
    return start !== null && start > nowMinutes
  })
  return upcoming?.section ?? null
}

function isUnsupportedError(error: Error | null): boolean {
  if (!error) return false
  if (isProviderError(error)) return error.code === ProviderErrorCode.FEATURE_NOT_SUPPORTED
  return "code" in error && error.code === ProviderErrorCode.FEATURE_NOT_SUPPORTED
}

export const SchedulePage: SlotComponent<SchedulePageProps> = (props) => {
  const { t, useStore, actions } = props
  const isMobile = useIsMobile()
  const clockTick = props.useClockTick()
  const settings = props.useSettings()
  const patchesState = props.usePatches()
  const patchesHydrated = props.usePatchesHydrated()
  const providerSnap = props.useProvider()
  const sessionSnap = props.useSession()
  const scheduleQuery = props.useSchedule()
  const currentWeekQuery = props.useCurrentWeek()
  const termCalendarQuery = props.useTermCalendar()
  const periodsQuery = props.usePeriods()
  const examsQuery = props.useExams()

  const weekOverride = useStore((s) => s.weekOverride)
  const termInput = useStore((s) => s.termInput)
  const queriedTerm = useStore((s) => s.queriedTerm)
  const filterDrawerOpen = useStore((s) => s.filterDrawerOpen)
  const editScope = useStore((s) => s.editScope)
  const showOriginal = useStore((s) => s.showOriginal)
  const pendingDrop = useStore((s) => s.pendingDrop)
  const manager = useStore((s) => s.manager)
  const undo = useStore((s) => s.undo)

  const [activityCourse, setActivityCourse] = useState<Course | null>(null)
  const [activityWeek, setActivityWeek] = useState(1)
  const [activityOpen, setActivityOpen] = useState(false)
  const [signinActivityId, setSigninActivityId] = useState<string | null>(null)
  const [signinType, setSigninType] = useState(1)
  const [signinOpen, setSigninOpen] = useState(false)

  const compactMode = settings.compactMode
  const rawCourses = useMemo(() => scheduleQuery.data ?? [], [scheduleQuery.data])
  const snapshot = currentWeekQuery.data ?? null
  const rawCalendar = termCalendarQuery.data
  const semester = queriedTerm || snapshot?.semester
  const termCalendar =
    semester && rawCalendar?.semester && rawCalendar.semester !== semester
      ? undefined
      : rawCalendar
  const weekAnchor =
    queriedTerm && snapshot?.semester && snapshot.semester !== queriedTerm ? null : snapshot

  const clock = useMemo(() => getAcademicClock(new Date(clockTick)), [clockTick])
  const currentWeek = useMemo(
    () => resolveAcademicWeek(snapshot, rawCalendar, clock.date, queriedTerm || undefined),
    [clock.date, queriedTerm, rawCalendar, snapshot]
  )
  const selectedWeek = weekOverride ?? currentWeek?.week ?? 1

  const effective = useMemo(
    () =>
      computeEffectiveScheduleSnapshot({
        rawCourses: scheduleQuery.data,
        calendar: termCalendar,
        currentWeek: snapshot,
        requestedSemester: queriedTerm || undefined,
        providerSnapshot: providerSnap,
        sessionSnapshot: sessionSnap,
        patchesState,
        patchesHydrated,
      }),
    [
      patchesHydrated,
      patchesState,
      providerSnap,
      queriedTerm,
      scheduleQuery.data,
      sessionSnap,
      snapshot,
      termCalendar,
    ]
  )

  const periods = useMemo(
    () => (periodsQuery.data ?? []).filter(periodIsInUse).sort((a, b) => a.section - b.section),
    [periodsQuery.data]
  )

  const canEdit = effective.ready && periods.length > 0
  const editing =
    effective.ready && editScope !== null && editScope === effective.scope && !showOriginal
  const mobileFullscreen = isMobile && (editing || showOriginal)
  const courses = effective.ready && !showOriginal ? effective.courses : rawCourses
  const activePending = pendingDrop?.scope === effective.scope ? pendingDrop : null
  const activeManager = manager?.scope === effective.scope ? manager : null
  const undoPatch =
    undo?.scope === effective.scope
      ? effective.patches.find((patch) => patch.id === undo.id)
      : undefined
  const lastAdjustment = effective.patches.filter((patch) => patch.enabled).at(-1)

  const weekAdjustments = useMemo(
    () =>
      effective.patches.filter((patch) =>
        schedulePatchAffectsWeek(patch, effective.termStartDate, selectedWeek)
      ),
    [effective.patches, effective.termStartDate, selectedWeek]
  )
  const weekIssues = useMemo(() => {
    const ids = new Set(weekAdjustments.map((patch) => patch.id))
    return effective.issues.filter((issue) => ids.has(issue.patchId))
  }, [weekAdjustments, effective.issues])
  const weekAdjustmentCount = weekAdjustments.length
  const reviewCount = new Set(weekIssues.map((issue) => issue.patchId)).size

  const adjustmentsView = useMemo<ScheduleAdjustmentsDialogView>(
    () =>
      undoPatch && undo
        ? { kind: "confirmation", patch: undoPatch, remove: undo.remove }
        : activeManager
          ? { kind: "manager", selectedPatchId: activeManager.id }
          : null,
    [undoPatch, undo, activeManager]
  )

  useBackHandler(() => actions.finishEditing(), editing)
  useBackHandler(() => actions.setShowOriginal(false), showOriginal)

  const mutationCtx = {
    expectedScope: effective.scope,
    rawCourses: scheduleQuery.data,
    termStartDate: effective.termStartDate,
    totalWeeks: effective.totalWeeks,
  }

  const enterEditor = (): void => {
    if (!canEdit || !effective.scope) return
    actions.enterEditor(
      effective.scope,
      Math.min(effective.totalWeeks, Math.max(1, selectedWeek))
    )
  }

  const openManager = (id: string | null = null): void => {
    if (effective.scope) {
      actions.setManager({ scope: effective.scope, id })
    }
  }

  const openAdjustment = (drop: ScheduleDrop): void => {
    if (editing && effective.scope) {
      actions.setPendingDrop({ scope: effective.scope, drop })
    }
  }

  const selectAdjustment = (selection: ScheduleSelection): void => {
    openAdjustment({
      selection,
      targetDate: selection.date,
      targetStartSection: selection.courses[0]?.startSection ?? 1,
    })
  }

  const requestUndo = (id: string, remove = true): void => {
    if (effective.scope) {
      actions.setUndo({ scope: effective.scope, id, remove })
    }
  }

  const saveAdjustment = (draft: SchedulePatchDraft): void => {
    const id = props.patchMutators.addPatch(mutationCtx, draft)
    actions.setPendingDrop(null)
    toast.success(t("scheduleEditor.saved"), {
      action: { label: t("scheduleEditor.undo"), onClick: () => requestUndo(id) },
    })
  }

  const confirmUndo = (): void => {
    if (!undoPatch || !undo) return
    try {
      if (undo.remove) {
        props.patchMutators.removePatch(mutationCtx, undoPatch.id)
      } else {
        props.patchMutators.setPatchEnabled(mutationCtx, undoPatch.id, false)
      }
      actions.setUndo(null)
      toast.success(t("scheduleEditor.undone"))
    } catch (error) {
      toast.error(formatScheduleEditorError(t, error))
    }
  }

  const loading =
    scheduleQuery.isLoading ||
    scheduleQuery.isRefreshing ||
    currentWeekQuery.isLoading ||
    currentWeekQuery.isRefreshing ||
    termCalendarQuery.isLoading ||
    termCalendarQuery.isRefreshing ||
    periodsQuery.isLoading ||
    periodsQuery.isRefreshing ||
    examsQuery.isLoading ||
    examsQuery.isRefreshing

  const selectWeek = (week: number): void => {
    const nextWeek = Math.max(1, week)
    actions.setWeekOverride(!editing && nextWeek === currentWeek?.week ? null : nextWeek)
  }

  const shiftWeek = (delta: number): void => {
    selectWeek(Math.min(effective.totalWeeks || Infinity, Math.max(1, selectedWeek + delta)))
  }

  useEffect(() => {
    const errors = [
      scheduleQuery.error,
      currentWeekQuery.error,
      termCalendarQuery.error,
      periodsQuery.error,
      examsQuery.error,
    ].filter((err): err is Error => err !== null && !isUnsupportedError(err))
    if (errors.length === 0) return
    toast.error(errors[0]?.message || t("updating"))
  }, [
    currentWeekQuery.error,
    examsQuery.error,
    periodsQuery.error,
    scheduleQuery.error,
    t,
    termCalendarQuery.error,
  ])

  const handleQuery = async (): Promise<void> => {
    const nextTerm = termInput.trim()
    if (nextTerm === queriedTerm) {
      actions.setFilterDrawerOpen(false)
      await Promise.allSettled([
        scheduleQuery.refresh(),
        currentWeekQuery.refresh(),
        termCalendarQuery.refresh(),
        periodsQuery.refresh(),
        examsQuery.refresh(),
      ])
    } else {
      actions.commitQueriedTerm(nextTerm)
    }
  }

  const currentSection = useMemo(
    () => computeCurrentOrUpcomingSection(periods, clock.weekday, clock.minutes),
    [clock.minutes, clock.weekday, periods]
  )

  const handleOpenFreeRooms = (): void => {
    props.openFreeRooms({
      week: selectedWeek || currentWeek?.week || 1,
      day: clock.weekday >= 1 ? clock.weekday : undefined,
      section: currentSection ?? undefined,
    })
  }

  const labels = useMemo(() => buildScheduleLabels(t), [t])

  const filteredCourses = useMemo(() => {
    if (selectedWeek <= 0) return courses
    return courses.filter((course) => isCourseActiveInWeek(course, selectedWeek))
  }, [courses, selectedWeek])

  const courseColors = useMemo(() => buildCourseColorMap(courses), [courses])

  const examBlocks = useMemo(
    () =>
      computeExamBlocks(
        examsQuery.data ?? [],
        periods,
        weekAnchor,
        selectedWeek,
        termCalendar?.startDate
      ),
    [examsQuery.data, periods, selectedWeek, termCalendar?.startDate, weekAnchor]
  )

  const handleCourseTap = (course: Course, week: number): void => {
    setActivityCourse(course)
    setActivityWeek(week)
    setActivityOpen(true)
  }

  const editorActions = (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!lastAdjustment}
        onClick={() => {
          if (lastAdjustment) requestUndo(lastAdjustment.id)
        }}
        aria-label={t("scheduleEditor.undoLast")}
      >
        <Undo2 />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => openManager()}
        aria-label={t("scheduleEditor.manage")}
      >
        <History />
      </Button>
      <Button type="button" size="sm" onClick={() => actions.finishEditing()}>
        <Check data-icon="inline-start" />
        {t("scheduleEditor.done")}
      </Button>
    </div>
  )

  const activeProvider = providerSnap.provider
  if (
    !supportsPlugin(activeProvider?.supportedPlugins, props.pluginId) ||
    !hasSlice(activeProvider, "timetable")
  ) {
    return null
  }

  if (loading && courses.length === 0) {
    return (
      <div className="flex flex-col gap-4" data-page="schedule-loading">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const renderFilterControls = (idPrefix: string): ReactNode => (
    <FieldGroup className="flex flex-row flex-wrap items-end gap-3">
      <Field className="w-48">
        <FieldLabel htmlFor={`${idPrefix}-term`}>{t("schedule.termLabel")}</FieldLabel>
        <Input
          id={`${idPrefix}-term`}
          value={termInput}
          onChange={(event) => actions.setTermInput(event.target.value)}
          placeholder={t("schedule.termPlaceholder")}
        />
      </Field>
      <Field className="min-w-[16rem]">
        <FieldLabel htmlFor={`${idPrefix}-week`}>{t("schedule.weekLabel")}</FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
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
            <Input
              id={`${idPrefix}-week`}
              type="number"
              value={selectedWeek || ""}
              onChange={(event) => selectWeek(Number.parseInt(event.target.value, 10) || 1)}
              placeholder={t("schedule.weeks")}
              className="w-20 text-center"
            />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              onClick={() => shiftWeek(1)}
              aria-label={t("schedule.weekNext")}
            >
              <ChevronRight />
            </Button>
          </div>
          {currentWeek && currentWeek.week >= 1 && (
            <Badge variant="secondary">
              {t("schedule.currentWeekBadge", { week: currentWeek.week })}
            </Badge>
          )}
        </div>
      </Field>
      <Button type="button" onClick={() => void handleQuery()} disabled={loading}>
        {loading ? <Spinner data-icon="inline-start" /> : <Search data-icon="inline-start" />}
        {t("schedule.query")}
      </Button>
      <Button type="button" variant="outline" disabled={!canEdit} onClick={enterEditor}>
        <Pencil data-icon="inline-start" />
        {t("scheduleEditor.enter")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={!effective.ready}
        onClick={() => {
          actions.setFilterDrawerOpen(false)
          openManager()
        }}
      >
        <History data-icon="inline-start" />
        {t("scheduleEditor.manage")}
      </Button>
      {!canEdit && <p className="text-sm text-muted-foreground">{t("scheduleEditor.notReady")}</p>}
    </FieldGroup>
  )

  return (
    <div
      data-page="schedule"
      className={
        isMobile ? "flex min-h-0 flex-1 flex-col" : "flex flex-col gap-6"
      }
    >
      <Card className="hidden md:block">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>{t("schedule.title")}</CardTitle>
            <CardDescription>{t("schedule.description")}</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {editing && editorActions}
            <Button type="button" variant="outline" onClick={handleOpenFreeRooms}>
              <CalendarSearch data-icon="inline-start" />
              {t("freeRoomEntry")}
            </Button>
            <Button type="button" variant="outline" onClick={props.openSchoolSchedule}>
              <CalendarDays data-icon="inline-start" />
              {t("schoolScheduleEntry")}
            </Button>
          </div>
        </CardHeader>
        {!editing && <CardContent>{renderFilterControls("schedule-desktop")}</CardContent>}
      </Card>

      {showOriginal && (
        <Alert className={cn("shrink-0", isMobile && "rounded-none border-x-0 border-t-0")}>
          <AlertTitle>{t("scheduleEditor.showOriginal")}</AlertTitle>
          <AlertDescription>
            <p>{t("scheduleEditor.originalNotice")}</p>
            {!isMobile && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => actions.setShowOriginal(false)}
              >
                {t("scheduleEditor.showEffective")}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {!isMobile &&
        effective.ready &&
        (weekAdjustmentCount > 0 || reviewCount > 0) &&
        !showOriginal && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => openManager()}>
              <History data-icon="inline-start" />
              {t("scheduleEditor.weekAdjustments", { count: weekAdjustmentCount })}
            </Button>
            {reviewCount > 0 && weekIssues[0] && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => openManager(weekIssues[0]?.patchId ?? null)}
              >
                <TriangleAlert data-icon="inline-start" />
                {t("scheduleEditor.reviewCount", {
                  count: reviewCount,
                })}
              </Button>
            )}
          </div>
        )}

      <ScheduleDragSurface
        editing={editing}
        enabled={editing && !activePending && !activeManager && !undoPatch}
        selectedWeek={selectedWeek || 1}
        totalWeeks={effective.totalWeeks}
        termStartDate={effective.termStartDate}
        courses={showOriginal ? [] : effective.courses}
        traces={showOriginal ? [] : effective.traces}
        patches={showOriginal ? [] : effective.patches}
        t={t}
        onShiftWeek={shiftWeek}
        onDrop={openAdjustment}
        onSelect={selectAdjustment}
        onTraceClick={openManager}
      >
        {(editor) =>
          isMobile ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <ScheduleMobile
                courses={courses}
                exams={examsQuery.data}
                periods={periods}
                currentWeekday={clock.weekday}
                currentWeek={currentWeek}
                weekAnchor={weekAnchor}
                selectedWeek={selectedWeek}
                termStartDate={termCalendar?.startDate}
                nowMinutes={clock.minutes}
                labels={labels}
                editor={editor}
                compact={compactMode || mobileFullscreen}
                fullscreen={mobileFullscreen}
                onPrevWeek={() => shiftWeek(-1)}
                onNextWeek={() => shiftWeek(1)}
                colorMap={courseColors}
                onCourseTap={handleCourseTap}
              />
            </div>
          ) : (
            <Card>
              <CardContent className="pt-6">
                <ScheduleTablet
                  courses={filteredCourses}
                  examBlocks={examBlocks}
                  periods={periods}
                  currentWeekday={clock.weekday}
                  currentWeek={currentWeek}
                  weekAnchor={weekAnchor}
                  selectedWeek={selectedWeek}
                  termStartDate={termCalendar?.startDate}
                  nowMinutes={clock.minutes}
                  labels={labels}
                  editor={editor}
                  colorMap={courseColors}
                  onCourseTap={handleCourseTap}
                />
              </CardContent>
            </Card>
          )
        }
      </ScheduleDragSurface>

      <ScheduleAdjustmentDialog
        drop={activePending && !undoPatch ? activePending.drop : null}
        courses={effective.courses}
        periods={periods}
        termStartDate={effective.termStartDate}
        totalWeeks={effective.totalWeeks}
        t={t}
        onClose={() => actions.setPendingDrop(null)}
        onSave={saveAdjustment}
      />

      <ScheduleAdjustmentsDialog
        view={adjustmentsView}
        patches={effective.patches}
        issues={effective.issues}
        t={t}
        onClose={() => {
          if (undoPatch) actions.setUndo(null)
          else actions.setManager(null)
        }}
        onConfirm={confirmUndo}
        onRemove={requestUndo}
        onToggle={(id, enabled) => {
          if (enabled) props.patchMutators.setPatchEnabled(mutationCtx, id, true)
          else requestUndo(id, false)
        }}
        onJump={(date) => {
          selectWeek(scheduleWeek(date, effective.termStartDate).week)
          actions.setManager(null)
        }}
        onShowOriginal={() => actions.setShowOriginal(true)}
      />

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

      <FilterDrawer
        open={filterDrawerOpen}
        onOpenChange={actions.setFilterDrawerOpen}
        title={t("schedule.title")}
        description={t("schedule.description")}
      >
        {renderFilterControls("schedule-drawer")}
      </FilterDrawer>

      <WidgetDiscovery
        isNative={props.isNative()}
        hidden={settings.widgetAssistantHidden}
        position={settings.widgetAssistantPosition}
        suspended={mobileFullscreen || editing || showOriginal}
        widgetsSettingsHref={props.widgetsSettingsHref}
        t={t}
        onSetHidden={props.setWidgetAssistantHidden}
        onSetPosition={props.setWidgetAssistantPosition}
        onRequestPinSchedule={props.requestPinScheduleWidget}
        onOpenWidgetsSettings={props.openWidgetsSettings}
      />
    </div>
  )
}

export interface ScheduleHeaderActionsInject {
  readonly hooks: {
    readonly location: ObservableSource<RouteLocation>
    readonly clockTick: ObservableSource<number>
    readonly settings: ObservableSource<ScheduleSettingsState>
    readonly patches: ObservableSource<SchedulePatchesState>
    readonly patchesHydrated: ObservableSource<boolean>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly session: ObservableSource<SessionSnapshot>
    readonly schedule: ObservableSource<QuerySnapshot<Course[]>>
    readonly currentWeek: ObservableSource<QuerySnapshot<CurrentWeek>>
    readonly termCalendar: ObservableSource<QuerySnapshot<TermCalendar>>
    readonly periods: ObservableSource<QuerySnapshot<ClassPeriod[]>>
  }
  readonly pluginId: string
  readonly setCompactMode: (compact: boolean) => void
  readonly openSchoolSchedule: () => void
  readonly openFreeRooms: (params: FreeRoomTargetParams) => void
}

export type ScheduleHeaderActionsProps = DerivedComponentProps<
  Record<string, never>,
  ScheduleDictionary,
  undefined,
  ScheduleViewStoreInstance,
  ScheduleHeaderActionsInject
>

export const ScheduleHeaderActions: SlotComponent<ScheduleHeaderActionsProps> = (props) => {
  const { t, useStore, actions } = props
  const location = props.useLocation()
  const clockTick = props.useClockTick()
  const settings = props.useSettings()
  const patchesState = props.usePatches()
  const patchesHydrated = props.usePatchesHydrated()
  const providerSnap = props.useProvider()
  const sessionSnap = props.useSession()
  const scheduleQuery = props.useSchedule()
  const currentWeekQuery = props.useCurrentWeek()
  const termCalendarQuery = props.useTermCalendar()
  const periodsQuery = props.usePeriods()

  const weekOverride = useStore((s) => s.weekOverride)
  const queriedTerm = useStore((s) => s.queriedTerm)
  const editScope = useStore((s) => s.editScope)
  const showOriginal = useStore((s) => s.showOriginal)

  const onSchedulePage =
    location.route === "schedule" || location.pluginId === props.pluginId
  const activeProvider = providerSnap.provider
  if (
    !onSchedulePage ||
    !supportsPlugin(activeProvider?.supportedPlugins, props.pluginId) ||
    !hasSlice(activeProvider, "timetable")
  ) {
    return null
  }

  const snapshot = currentWeekQuery.data ?? null
  const rawCalendar = termCalendarQuery.data
  const semester = queriedTerm || snapshot?.semester
  const termCalendar =
    semester && rawCalendar?.semester && rawCalendar.semester !== semester
      ? undefined
      : rawCalendar

  const clock = getAcademicClock(new Date(clockTick))
  const currentWeek = resolveAcademicWeek(snapshot, rawCalendar, clock.date, queriedTerm || undefined)
  const selectedWeek = weekOverride ?? currentWeek?.week ?? 1

  const effective = computeEffectiveScheduleSnapshot({
    rawCourses: scheduleQuery.data,
    calendar: termCalendar,
    currentWeek: snapshot,
    requestedSemester: queriedTerm || undefined,
    providerSnapshot: providerSnap,
    sessionSnapshot: sessionSnap,
    patchesState,
    patchesHydrated,
  })

  const editing =
    effective.ready && editScope !== null && editScope === effective.scope && !showOriginal
  const lastAdjustment = effective.patches.filter((patch) => patch.enabled).at(-1)
  const periods = (periodsQuery.data ?? []).filter(periodIsInUse).sort((a, b) => a.section - b.section)
  const currentSection = computeCurrentOrUpcomingSection(periods, clock.weekday, clock.minutes)

  return (
    <div className="flex items-center gap-0.5 md:hidden" data-schedule-header-actions="">
      {showOriginal ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => actions.setShowOriginal(false)}
        >
          {t("scheduleEditor.showEffective")}
        </Button>
      ) : editing ? (
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!lastAdjustment}
            onClick={() => {
              if (lastAdjustment && effective.scope) {
                actions.setUndo({
                  scope: effective.scope,
                  id: lastAdjustment.id,
                  remove: true,
                })
              }
            }}
            aria-label={t("scheduleEditor.undoLast")}
          >
            <Undo2 />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              if (effective.scope) {
                actions.setManager({ scope: effective.scope, id: null })
              }
            }}
            aria-label={t("scheduleEditor.manage")}
          >
            <History />
          </Button>
          <Button type="button" size="sm" onClick={() => actions.finishEditing()}>
            <Check data-icon="inline-start" />
            {t("scheduleEditor.done")}
          </Button>
        </div>
      ) : (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8"
                aria-label={t("schoolScheduleEntry")}
              >
                <CalendarDays className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={props.openSchoolSchedule}>
                {t("schoolScheduleEntry")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  props.openFreeRooms({
                    week: selectedWeek || currentWeek?.week || 1,
                    day: clock.weekday >= 1 ? clock.weekday : undefined,
                    section: currentSection ?? undefined,
                  })
                }
              >
                {t("freeRoomEntry")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => props.setCompactMode(!settings.compactMode)}
            className="h-8 w-8"
            aria-label={t("schedule.compactHint")}
          >
            {settings.compactMode ? (
              <Grid3x3 className="size-4" />
            ) : (
              <Grid3x2 className="size-4" />
            )}
          </Button>
          <FilterTrigger
            label={
              selectedWeek
                ? t("schedule.weekShort", { week: selectedWeek })
                : t("schedule.weekLabel")
            }
            onClick={() => actions.setFilterDrawerOpen(true)}
          />
        </>
      )}
    </div>
  )
}
