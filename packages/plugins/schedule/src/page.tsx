import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import {
  Bell,
  Calendar,
  CalendarSync,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Grid3x2,
  Grid3x3,
  History,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  TriangleAlert,
  Undo2,
} from "lucide-react"
import {
  buildCalendarSyncEvents,
  buildCourseColorMap,
  buildSharedSchedulePayload,
  courseIdentity,
  DEFAULT_STANDALONE_PERIODS,
  getAcademicClock,
  isCourseActiveInWeek,
  periodIsInUse,
  resolveAcademicWeek,
  scheduleOccurrence,
  schedulePatchAffectsWeek,
  scheduleWeek,
  ScheduleMobile,
  ScheduleTablet,
  serializeCalendarIcs,
  type CourseOverride,
  type ScheduleDrop,
  type ScheduleEmptyCellTarget,
  type ScheduleSelection,
  type SharedSchedulePayload,
} from "@orahako/academic-kit"
import {
  hasSlice,
  isProviderError,
  ProviderErrorCode,
  supportsPlugin,
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
  RouteLocation,
  ScheduleEffectiveSnapshot,
  ScheduleEntry,
  SlotComponent,
  Translator,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FilterDrawer,
  FilterTrigger,
  Input,
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  Skeleton,
  Spinner,
  Switch,
  useBackHandler,
  useIsMobile,
} from "@orahako/ui-primitives"
import type { CalendarSyncStatus } from "./controller"
import {
  ScheduleEntryDetailDialog,
  ScheduleItemFormDialog,
  type ScheduleItemFormTarget,
} from "./custom-dialogs"
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
import "./slots"
import {
  computeEffectiveScheduleSnapshot,
  customItemToCourse,
  isCustomItemActiveInScope,
  type CustomScheduleItem,
  type ScheduleCustomizationsState,
  type SchedulePatchDraft,
  type SchedulePatchesState,
  type SchedulePatchMutators,
  type ScheduleSettingsState,
  type ScheduleViewStoreInstance,
  type SharedScheduleLinkRecord,
  type WidgetAssistantPosition,
} from "./stores"
import { WidgetDiscovery } from "./widget-discovery"

export const SCHEDULE_PAGE_CHILDREN = {
  "schedule.toolbar.actions": { kind: "list" },
  "schedule.entry.detail": { kind: "list" },
} as const

const STANDALONE_TODAY_WEEK = 53
const STANDALONE_TOTAL_WEEKS = 105
const STANDALONE_SCOPE = "__personal__"

export interface SchedulePageInject {
  readonly hooks: {
    readonly clockTick: ObservableSource<number>
    readonly settings: ObservableSource<ScheduleSettingsState>
    readonly patches: ObservableSource<SchedulePatchesState>
    readonly patchesHydrated: ObservableSource<boolean>
    readonly customizations: ObservableSource<ScheduleCustomizationsState>
    readonly customizationsHydrated: ObservableSource<boolean>
    readonly scheduleState: ObservableSource<ScheduleEffectiveSnapshot>
    readonly calendarSyncStatus: ObservableSource<CalendarSyncStatus>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly session: ObservableSource<SessionSnapshot>
    readonly schedule: ObservableSource<QuerySnapshot<Course[]>>
    readonly currentWeek: ObservableSource<QuerySnapshot<CurrentWeek>>
    readonly termCalendar: ObservableSource<QuerySnapshot<TermCalendar>>
    readonly periods: ObservableSource<QuerySnapshot<ClassPeriod[]>>
  }
  readonly patchMutators: SchedulePatchMutators
  readonly upsertOverride: (scope: string, override: CourseOverride) => void
  readonly removeOverride: (scope: string, courseKey: string) => void
  readonly upsertCustomItem: (item: CustomScheduleItem) => void
  readonly removeCustomItem: (id: string) => void
  readonly onSemesterChange: (semester: string) => void
  readonly refreshSources: () => Promise<void>
  readonly mobileBridge: MobileLessonBridge
  readonly pluginId: string
  readonly isNative: () => boolean
  readonly assistantSrc: string
  readonly setCompactMode: (compact: boolean) => void
  readonly setWidgetAssistantHidden: (hidden: boolean) => void
  readonly setWidgetAssistantPosition: (position: WidgetAssistantPosition | null) => void
  readonly requestPinScheduleWidget: () => Promise<boolean>
  readonly widgetsSettingsHref: string
  readonly openWidgetsSettings: () => void
  readonly openNotificationsSettings?: () => void
  readonly exportIcsFile?: (
    fileName: string,
    content: string
  ) => Promise<{
    readonly savedToDownloads: boolean
    readonly shared: boolean
    readonly fileName: string
  }>
  readonly toggleCalendarSync?: (enabled: boolean) => Promise<boolean>
  readonly setCalendarSyncIncludeExams?: (include: boolean) => void
  readonly setCalendarSyncWriteReminders?: (write: boolean) => void
  readonly syncCalendarNow?: () => Promise<void>
  readonly clearSystemCalendar?: () => Promise<void>
  readonly calendarFeedEndpoint?: string
  readonly publishWebcalFeed?: (
    ics: string,
    count: number,
    rotate?: boolean
  ) => Promise<{ readonly readToken: string; readonly count: number }>
  readonly deleteWebcalFeed?: () => Promise<void>
  readonly setWebcalIncludeExams?: (include: boolean) => void
  readonly setWebcalWriteReminders?: (write: boolean) => void
  readonly shareViewerBaseUrl?: string
  readonly createScheduleShare?: (
    payload: SharedSchedulePayload,
    ttlSeconds: number,
    meta: { readonly includePersonal: boolean; readonly includeExams: boolean }
  ) => Promise<SharedScheduleLinkRecord>
  readonly revokeScheduleShare?: (shareId: string) => Promise<void>
  readonly setShareMaskEnabled?: (enabled: boolean) => void
  readonly setShareMaskShowTitle?: (show: boolean) => void
  readonly setShareMaskShowLocation?: (show: boolean) => void
  readonly setShareMaskShowSubtitle?: (show: boolean) => void
  readonly setShareIncludePersonal?: (include: boolean) => void
  readonly setShareIncludeExams?: (include: boolean) => void
  readonly setShareTtlDays?: (days: number) => void
}

export type SchedulePageProps = DerivedComponentProps<
  Record<string, never>,
  ScheduleDictionary,
  typeof SCHEDULE_PAGE_CHILDREN,
  ScheduleViewStoreInstance,
  SchedulePageInject
>

function isUnsupportedError(error: Error | null): boolean {
  if (!error) return false
  if (isProviderError(error)) return error.code === ProviderErrorCode.FEATURE_NOT_SUPPORTED
  return "code" in error && error.code === ProviderErrorCode.FEATURE_NOT_SUPPORTED
}

function computeStandaloneCalendarAnchor(
  isoToday: string,
  weekday: number
): {
  readonly termStartDate: string
  readonly currentWeek: CurrentWeek
} {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(isoToday)
  const year = match ? Number(match[1]) : new Date().getFullYear()
  const month = match ? Number(match[2]) - 1 : new Date().getMonth()
  const day = match ? Number(match[3]) : new Date().getDate()
  const todayDate = new Date(year, month, day, 12)
  const mondayThisWeek = new Date(todayDate)
  mondayThisWeek.setDate(todayDate.getDate() - (weekday - 1))
  const start = new Date(mondayThisWeek)
  start.setDate(mondayThisWeek.getDate() - (STANDALONE_TODAY_WEEK - 1) * 7)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return {
    termStartDate: fmt(start),
    currentWeek: {
      week: STANDALONE_TODAY_WEEK,
      weekday,
      date: fmt(todayDate),
      weekStartDate: fmt(mondayThisWeek),
    },
  }
}

function courseToDetailEntry(course: Course, pluginId: string): ScheduleEntry {
  const occ = scheduleOccurrence(course)
  return {
    id: occ?.occurrenceId ?? courseIdentity(course),
    seriesId: occ?.courseKey ?? courseIdentity(course),
    sourceId: occ?.customItemId ? "personal" : "academic-timetable",
    sourcePluginId: pluginId,
    category: occ?.customItemId ? "custom" : "course",
    title: course.name,
    ...(course.classroom ? { location: course.classroom } : {}),
    ...(course.teacher ? { subtitle: course.teacher } : {}),
    ...(course.deliveryMode ? { deliveryMode: course.deliveryMode } : {}),
    ...(course.note ? { note: course.note } : {}),
    ...(occ?.date ? { date: occ.date } : {}),
    weekDay: course.weekDay,
    ...(course.weekList ? { weekList: course.weekList } : {}),
    sections: { startSection: course.startSection, endSection: course.endSection },
  }
}

function ScheduleEditActionButtons({
  hasUndo,
  onUndo,
  onOpenManager,
  onDone,
  t,
}: {
  readonly hasUndo: boolean
  readonly onUndo: () => void
  readonly onOpenManager: () => void
  readonly onDone: () => void
  readonly t: Translator<ScheduleDictionary>
}): ReactNode {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={!hasUndo}
        onClick={onUndo}
        aria-label={t("scheduleEditor.undoLast")}
      >
        <Undo2 />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onOpenManager}
        aria-label={t("scheduleEditor.manage")}
      >
        <History />
      </Button>
      <Button type="button" size="sm" onClick={onDone}>
        <Check data-icon="inline-start" />
        {t("scheduleEditor.done")}
      </Button>
    </div>
  )
}

export const SchedulePage: SlotComponent<SchedulePageProps> = (props) => {
  const { t, useStore, actions, renderSlot } = props
  const isMobile = useIsMobile()
  const clockTick = props.useClockTick()
  const settings = props.useSettings()
  const patchesState = props.usePatches()
  const patchesHydrated = props.usePatchesHydrated()
  const customizationsState = props.useCustomizations()
  const customizationsHydrated = props.useCustomizationsHydrated()
  const scheduleState = props.useScheduleState()
  const calendarSyncStatus = props.useCalendarSyncStatus()
  const providerSnap = props.useProvider()
  const sessionSnap = props.useSession()
  const scheduleQuery = props.useSchedule()
  const currentWeekQuery = props.useCurrentWeek()
  const termCalendarQuery = props.useTermCalendar()
  const periodsQuery = props.usePeriods()

  const weekOverride = useStore((s) => s.weekOverride)
  const termInput = useStore((s) => s.termInput)
  const queriedTerm = useStore((s) => s.queriedTerm)
  const weekPickerOpen = useStore((s) => s.weekPickerOpen)
  const menuOpen = useStore((s) => s.menuOpen)
  const editScope = useStore((s) => s.editScope)
  const showOriginal = useStore((s) => s.showOriginal)
  const pendingDrop = useStore((s) => s.pendingDrop)
  const manager = useStore((s) => s.manager)
  const undo = useStore((s) => s.undo)
  const createRequestNonce = useStore((s) => s.createRequestNonce)
  const shareRequestNonce = useStore((s) => s.shareRequestNonce)

  const [activityCourse, setActivityCourse] = useState<Course | null>(null)
  const [activityWeek, setActivityWeek] = useState(1)
  const [activityOpen, setActivityOpen] = useState(false)
  const [signinActivityId, setSigninActivityId] = useState<string | null>(null)
  const [signinType, setSigninType] = useState(1)
  const [signinOpen, setSigninOpen] = useState(false)
  const [itemFormTarget, setItemFormTarget] = useState<ScheduleItemFormTarget>(null)
  const [detailEntry, setDetailEntry] = useState<ScheduleEntry | null>(null)
  const [calendarSyncOpen, setCalendarSyncOpen] = useState(false)
  const [calendarSyncPending, setCalendarSyncPending] = useState(false)
  const [webcalOpen, setWebcalOpen] = useState(false)
  const [webcalPending, setWebcalPending] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [sharePending, setSharePending] = useState(false)
  const [shareCustomRange, setShareCustomRange] = useState(false)
  const [shareSelectedWeeks, setShareSelectedWeeks] = useState<number[]>([])
  const lastCreateNonceRef = useRef(createRequestNonce)
  const lastShareNonceRef = useRef(shareRequestNonce)

  const activeProvider = providerSnap.provider
  const hasAcademicTimetable = Boolean(
    activeProvider &&
    hasSlice(activeProvider, "timetable") &&
    supportsPlugin(activeProvider.supportedPlugins, props.pluginId)
  )

  const compactMode = settings.compactMode
  const rawCourses = useMemo(() => scheduleQuery.data ?? [], [scheduleQuery.data])
  const snapshot = currentWeekQuery.data ?? null
  const rawCalendar = termCalendarQuery.data
  const semester = queriedTerm || snapshot?.semester
  const termCalendar =
    semester && rawCalendar?.semester && rawCalendar.semester !== semester ? undefined : rawCalendar
  const weekAnchor =
    queriedTerm && snapshot?.semester && snapshot.semester !== queriedTerm ? null : snapshot

  const scheduleRules = activeProvider?.slices.timetable?.scheduleRules
  const timeZone = scheduleRules?.timeZone
  const clock = useMemo(
    () => getAcademicClock(new Date(clockTick), timeZone),
    [clockTick, timeZone]
  )

  const standaloneAnchor = useMemo(
    () => computeStandaloneCalendarAnchor(clock.date, clock.weekday),
    [clock.date, clock.weekday]
  )

  const academicCurrentWeek = useMemo(
    () => resolveAcademicWeek(snapshot, rawCalendar, clock.date, queriedTerm || undefined),
    [clock.date, queriedTerm, rawCalendar, snapshot]
  )
  const isStandalone = !hasAcademicTimetable
  const currentWeek = isStandalone ? standaloneAnchor.currentWeek : academicCurrentWeek
  const effectiveWeekAnchor = isStandalone ? standaloneAnchor.currentWeek : weekAnchor
  const effectiveTermStartDate = isStandalone
    ? standaloneAnchor.termStartDate
    : termCalendar?.startDate
  const effectiveTotalWeeks = isStandalone
    ? STANDALONE_TOTAL_WEEKS
    : (termCalendar?.totalWeeks ?? 0)
  const selectedWeek =
    weekOverride ?? currentWeek?.week ?? (isStandalone ? STANDALONE_TODAY_WEEK : 1)

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
        customizationsState,
        customizationsHydrated,
      }),
    [
      customizationsHydrated,
      customizationsState,
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

  const providerPeriods = useMemo(
    () => (periodsQuery.data ?? []).filter(periodIsInUse).sort((a, b) => a.section - b.section),
    [periodsQuery.data]
  )
  const periods = providerPeriods.length > 0 ? providerPeriods : DEFAULT_STANDALONE_PERIODS

  const activeScope = effective.scope ?? (isStandalone ? STANDALONE_SCOPE : null)

  const standaloneCustomCourses = useMemo(
    () =>
      isStandalone
        ? customizationsState.customItems
            .filter(
              (item) =>
                isCustomItemActiveInScope(item, null) &&
                item.timeMode === "section" &&
                item.recurrence !== "once"
            )
            .map((item) => customItemToCourse(item, STANDALONE_TOTAL_WEEKS))
            .filter((course): course is Course => course !== null)
        : [],
    [customizationsState.customItems, isStandalone]
  )

  const canEdit = hasAcademicTimetable && effective.ready && providerPeriods.length > 0
  const editing =
    effective.ready && editScope !== null && editScope === effective.scope && !showOriginal
  const courses = isStandalone
    ? standaloneCustomCourses
    : effective.ready && !showOriginal
      ? effective.courses
      : rawCourses
  const overlayEntries = showOriginal ? [] : scheduleState.entries

  const activePending = pendingDrop?.scope === effective.scope ? pendingDrop : null
  const activeManager = manager?.scope === activeScope ? manager : null
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
  const totalCustomizationCount =
    effective.overrides.length + effective.customItems.length + effective.patches.length

  const adjustmentsView = useMemo<ScheduleAdjustmentsDialogView>(
    () =>
      undoPatch && undo
        ? { kind: "confirmation", patch: undoPatch, remove: undo.remove }
        : activeManager
          ? { kind: "manager", selectedPatchId: activeManager.id }
          : null,
    [undoPatch, undo, activeManager]
  )

  useEffect(() => {
    if (createRequestNonce !== lastCreateNonceRef.current) {
      lastCreateNonceRef.current = createRequestNonce
      setItemFormTarget({
        mode: "create",
        initialKind: isStandalone ? "event" : "course",
        initialDay: clock.weekday,
        initialDate: clock.date,
        initialWeek: selectedWeek,
      })
    }
  }, [clock.date, clock.weekday, createRequestNonce, isStandalone, selectedWeek])

  useEffect(() => {
    if (shareRequestNonce !== lastShareNonceRef.current) {
      lastShareNonceRef.current = shareRequestNonce
      setShareOpen(true)
    }
  }, [shareRequestNonce])

  useLayoutEffect(() => {
    if (!showOriginal) return
    if (typeof window !== "undefined") {
      window.scrollTo?.(0, 0)
    }
    if (typeof document !== "undefined") {
      const shellMain = document.querySelector?.("[data-shell-main]")
      if (shellMain instanceof HTMLElement) {
        shellMain.scrollTop = 0
      }
    }
  }, [showOriginal])

  useBackHandler(() => actions.finishEditing(), editing)
  useBackHandler(() => actions.setShowOriginal(false), showOriginal)

  const mutationCtx = {
    expectedScope: effective.scope,
    rawCourses: scheduleQuery.data,
    termStartDate: effective.termStartDate,
    totalWeeks: effective.totalWeeks,
    overrides: effective.overrides,
    customCourses: effective.customCourses,
  }

  const enterEditor = (): void => {
    if (!canEdit || !effective.scope) return
    actions.enterEditor(effective.scope, Math.min(effective.totalWeeks, Math.max(1, selectedWeek)))
  }

  const openManager = (id: string | null = null): void => {
    if (activeScope) {
      actions.setManager({ scope: activeScope, id })
    }
  }

  const openAdjustment = (drop: ScheduleDrop): void => {
    if (effective.scope) {
      actions.setPendingDrop({ scope: effective.scope, drop })
    }
  }

  const selectAdjustment = (selection: ScheduleSelection): void => {
    if (
      selection.kind === "course" &&
      selection.courses.length === 1 &&
      selection.courses[0] &&
      !selection.courses[0].customItemId
    ) {
      handleEditCourseFromModal(selection.courses[0], "once")
      return
    }
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

  const handleSaveCustomItem = (item: CustomScheduleItem): void => {
    props.upsertCustomItem(item)
    toast.success(t("scheduleCustom.savedToast"))
  }

  const handleDeleteCustomItem = (id: string, title: string): void => {
    const existing = customizationsState.customItems.find((item) => item.id === id)
    props.removeCustomItem(id)
    toast.success(t("scheduleCustom.deletedToast", { name: title }), {
      ...(existing
        ? {
            action: {
              label: t("scheduleEditor.undo"),
              onClick: () => props.upsertCustomItem(existing),
            },
          }
        : {}),
    })
  }

  const handleSaveOverride = (override: CourseOverride): void => {
    if (!effective.scope) return
    props.upsertOverride(effective.scope, override)
    toast.success(t("scheduleCustom.savedToast"))
  }

  const handleRestoreOverride = (courseKey: string, name: string): void => {
    if (!effective.scope) return
    props.removeOverride(effective.scope, courseKey)
    toast.success(t("scheduleCustom.restoredToast", { name }))
  }

  const handleHideCourse = (course: Course): void => {
    if (!effective.scope) return
    const occ = scheduleOccurrence(course)
    const courseKey = occ?.courseKey ?? courseIdentity(course)
    const originalCourse = rawCourses.find((raw) => courseIdentity(raw) === courseKey) ?? course
    props.upsertOverride(effective.scope, {
      courseKey,
      originalName: originalCourse.name,
      hidden: true,
      updatedAt: new Date().toISOString(),
    })
    toast.success(t("scheduleCustom.hiddenToast", { name: course.name }), {
      action: {
        label: t("scheduleEditor.undo"),
        onClick: () => {
          if (effective.scope) props.removeOverride(effective.scope, courseKey)
        },
      },
    })
  }

  const handleEditCourseFromModal = (
    course: Course,
    initialScope: "whole" | "once" = "whole"
  ): void => {
    const occ = scheduleOccurrence(course)
    const courseKey = occ?.courseKey ?? courseIdentity(course)
    const rawCourse = rawCourses.find((raw) => courseIdentity(raw) === courseKey) ?? course
    const existingOverride = effective.overrides.find((item) => item.courseKey === courseKey)
    setItemFormTarget({
      mode: "override-course",
      courseKey,
      rawCourse,
      ...(occ ? { occurrence: occ } : {}),
      existingOverride,
      initialScope,
    })
  }

  const handleEditOverrideByRecord = (override: CourseOverride): void => {
    const rawCourse = rawCourses.find((raw) => courseIdentity(raw) === override.courseKey)
    if (!rawCourse) return
    setItemFormTarget({
      mode: "override-course",
      courseKey: override.courseKey,
      rawCourse,
      existingOverride: override,
    })
  }

  const handleEditCustomById = (customItemId: string): void => {
    const found = customizationsState.customItems.find((item) => item.id === customItemId)
    if (found) {
      setItemFormTarget({ mode: "edit-custom", item: found })
    }
  }

  const handleCancelSingleFromModal = (course: Course): void => {
    const occ = scheduleOccurrence(course)
    if (!occ || !effective.scope) return
    try {
      saveAdjustment({
        kind: "course",
        mode: "clear",
        sourceDate: occ.date,
        targetDate: occ.date,
        note: "",
        source: [occ],
        replaced: [],
        dependsOn: [...occ.patchIds],
      })
    } catch (error) {
      toast.error(formatScheduleEditorError(t, error))
    }
  }

  const handleEmptyCellTap = (cell: ScheduleEmptyCellTarget): void => {
    setItemFormTarget({
      mode: "create",
      initialKind: isStandalone ? "event" : "course",
      initialDay: cell.day,
      initialDate: cell.date,
      initialSection: cell.section,
      initialWeek: cell.week,
    })
  }

  const loading =
    hasAcademicTimetable &&
    (scheduleQuery.isLoading ||
      scheduleQuery.isRefreshing ||
      currentWeekQuery.isLoading ||
      currentWeekQuery.isRefreshing ||
      termCalendarQuery.isLoading ||
      termCalendarQuery.isRefreshing ||
      periodsQuery.isLoading ||
      periodsQuery.isRefreshing)

  const selectWeek = (week: number): void => {
    const maxW = effectiveTotalWeeks || Infinity
    const nextWeek = Math.min(maxW, Math.max(1, week))
    actions.setWeekOverride(!editing && nextWeek === currentWeek?.week ? null : nextWeek)
  }

  const shiftWeek = (delta: number): void => {
    selectWeek(selectedWeek + delta)
  }

  useEffect(() => {
    if (!hasAcademicTimetable) return
    const errors = [
      scheduleQuery.error,
      currentWeekQuery.error,
      termCalendarQuery.error,
      periodsQuery.error,
    ].filter((err): err is Error => err !== null && !isUnsupportedError(err))
    if (errors.length === 0) return
    toast.error(errors[0]?.message || t("updating"))
  }, [
    currentWeekQuery.error,
    hasAcademicTimetable,
    periodsQuery.error,
    scheduleQuery.error,
    t,
    termCalendarQuery.error,
  ])

  const handleRefreshSchedule = async (): Promise<void> => {
    actions.setMenuOpen(false)
    actions.setWeekPickerOpen(false)
    await Promise.allSettled([
      scheduleQuery.refresh(),
      currentWeekQuery.refresh(),
      termCalendarQuery.refresh(),
      periodsQuery.refresh(),
      props.refreshSources(),
    ])
  }

  const handleQuery = async (): Promise<void> => {
    const nextTerm = termInput.trim()
    props.onSemesterChange(nextTerm)
    if (nextTerm === queriedTerm) {
      await handleRefreshSchedule()
    } else {
      actions.commitQueriedTerm(nextTerm)
    }
  }

  const labels = useMemo(() => buildScheduleLabels(t), [t])

  const filteredCourses = useMemo(() => {
    if (selectedWeek <= 0) return courses
    return courses.filter((course) => isCourseActiveInWeek(course, selectedWeek))
  }, [courses, selectedWeek])

  const courseColors = useMemo(() => buildCourseColorMap(courses), [courses])

  const handleCourseTap = (course: Course, week: number): void => {
    setActivityCourse(course)
    setActivityWeek(week)
    setActivityOpen(true)
  }

  const handleExportIcs = async (): Promise<void> => {
    const events = buildCalendarSyncEvents({
      courses,
      extraEntries: overlayEntries,
      periods,
      currentWeek: currentWeek ?? snapshot,
      calendar: termCalendar,
      timeZone,
      now: new Date(clockTick),
      includeExams: true,
      examTitlePrefix: t("schedule.examTitlePrefix"),
      remindMinutes: settings.classReminderEnabled ? settings.classReminderMinutes : undefined,
    })
    if (events.length === 0) {
      toast.info(t("schedule.exportIcsEmpty"))
      return
    }
    const calendarLabel = semester ? `${semester} 日程` : t("navTitle")
    const icsContent = serializeCalendarIcs(events, {
      calendarName: calendarLabel,
      now: new Date(clockTick),
    })
    const fileName = `orahako-schedule-${semester || clock.date}.ics`
    try {
      if (props.exportIcsFile) {
        const res = await props.exportIcsFile(fileName, icsContent)
        if (props.isNative() && res.savedToDownloads) {
          toast.success(
            t("schedule.exportIcsSavedDownloads", { count: events.length, fileName: res.fileName })
          )
        } else {
          toast.success(
            t("schedule.exportIcsSuccess", { count: events.length, fileName: res.fileName })
          )
        }
        return
      }
      if (typeof document !== "undefined" && typeof URL !== "undefined") {
        const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement("a")
        anchor.href = url
        anchor.download = fileName
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
      }
      toast.success(t("schedule.exportIcsSuccess", { count: events.length, fileName }))
    } catch {
      toast.error(t("schedule.exportIcsFailed"))
    }
  }

  const handleToggleCalendarSync = async (enabled: boolean): Promise<void> => {
    if (!props.toggleCalendarSync) return
    setCalendarSyncPending(true)
    try {
      const ok = await props.toggleCalendarSync(enabled)
      if (!ok && enabled) {
        toast.error(t("settings.calendarSyncPermissionDenied"))
      } else if (ok && !enabled) {
        toast.success(t("settings.calendarSyncCleared"))
      }
    } catch {
      toast.error(t("settings.calendarSyncFailed"))
    } finally {
      setCalendarSyncPending(false)
    }
  }

  const handleSyncCalendarNow = async (): Promise<void> => {
    if (!props.syncCalendarNow) return
    setCalendarSyncPending(true)
    try {
      await props.syncCalendarNow()
    } catch {
      toast.error(t("settings.calendarSyncFailed"))
    } finally {
      setCalendarSyncPending(false)
    }
  }

  const handleClearSystemCalendar = async (): Promise<void> => {
    if (!props.clearSystemCalendar) return
    setCalendarSyncPending(true)
    try {
      await props.clearSystemCalendar()
      toast.success(t("settings.calendarSyncCleared"))
    } catch {
      toast.error(t("settings.calendarSyncFailed"))
    } finally {
      setCalendarSyncPending(false)
    }
  }

  const buildWebcalIcsPayload = (includeExams: boolean, writeReminders: boolean) => {
    const events = buildCalendarSyncEvents({
      courses,
      extraEntries: overlayEntries,
      periods,
      currentWeek: currentWeek ?? snapshot,
      calendar: termCalendar,
      timeZone,
      now: new Date(clockTick),
      includeExams,
      examTitlePrefix: t("schedule.examTitlePrefix"),
      remindMinutes: writeReminders ? settings.classReminderMinutes : undefined,
    })
    const calendarLabel = semester ? `酸橙盒 · ${semester}` : "酸橙盒 · 日程"
    const ics = serializeCalendarIcs(events, {
      calendarName: calendarLabel,
      now: new Date(clockTick),
    })
    return { ics, count: events.length }
  }

  const handlePublishWebcal = async (rotate = false): Promise<void> => {
    if (!props.publishWebcalFeed) return
    const { ics, count } = buildWebcalIcsPayload(
      settings.webcalIncludeExams,
      settings.webcalWriteReminders
    )
    if (count === 0) {
      toast.info(t("schedule.exportIcsEmpty"))
      return
    }
    setWebcalPending(true)
    try {
      await props.publishWebcalFeed(ics, count, rotate)
      toast.success(
        rotate ? t("schedule.webcalRotatedToast") : t("schedule.webcalUpdatedToast", { count })
      )
    } catch {
      toast.error(t("schedule.webcalFailedToast"))
    } finally {
      setWebcalPending(false)
    }
  }

  const handleDeleteWebcal = async (): Promise<void> => {
    if (!props.deleteWebcalFeed) return
    setWebcalPending(true)
    try {
      await props.deleteWebcalFeed()
      toast.success(t("schedule.webcalClearedToast"))
    } catch {
      toast.error(t("schedule.webcalFailedToast"))
    } finally {
      setWebcalPending(false)
    }
  }

  const webcalHttpsUrl =
    settings.webcalReadToken && props.calendarFeedEndpoint
      ? `${props.calendarFeedEndpoint}?token=${encodeURIComponent(settings.webcalReadToken)}`
      : null
  const webcalSchemeUrl = webcalHttpsUrl
    ? webcalHttpsUrl.replace(/^https?:\/\//i, "webcal://")
    : null

  const handleCopyWebcalUrl = async (): Promise<void> => {
    if (!webcalSchemeUrl) return
    try {
      await navigator.clipboard?.writeText(webcalSchemeUrl)
      toast.success(t("schedule.webcalCopied"))
    } catch {
      toast.error(t("schedule.webcalFailedToast"))
    }
  }

  const sharedLinks = Array.isArray(settings.sharedLinks) ? settings.sharedLinks : []

  const buildShareUrl = (shareId: string): string =>
    props.shareViewerBaseUrl ? `${props.shareViewerBaseUrl}?id=${encodeURIComponent(shareId)}` : ""

  const handleToggleShareCustomRange = (enabled: boolean): void => {
    setShareCustomRange(enabled)
    if (enabled && shareSelectedWeeks.length === 0) {
      const defaultWeek =
        currentWeek?.week && currentWeek.week >= 1 ? currentWeek.week : selectedWeek || 1
      setShareSelectedWeeks([defaultWeek])
    }
  }

  const handleToggleShareWeek = (weekNum: number): void => {
    setShareSelectedWeeks((prev) =>
      prev.includes(weekNum)
        ? prev.filter((w) => w !== weekNum)
        : [...prev, weekNum].sort((a, b) => a - b)
    )
  }

  const handleCreateShare = async (): Promise<void> => {
    if (!props.createScheduleShare) return
    if (shareCustomRange && shareSelectedWeeks.length === 0) {
      toast.info(t("schedule.shareRangeEmpty"))
      return
    }
    const payload = buildSharedSchedulePayload({
      courses,
      extraEntries: overlayEntries,
      periods,
      currentWeek: currentWeek ?? snapshot,
      calendar: termCalendar,
      timeZone,
      privacy: {
        enabled: settings.shareMaskEnabled,
        showTitle: settings.shareMaskShowTitle,
        showLocation: settings.shareMaskShowLocation,
        showSubtitle: settings.shareMaskShowSubtitle,
      },
      ...(shareCustomRange ? { allowedWeeks: shareSelectedWeeks } : {}),
      includePersonal: settings.shareIncludePersonal,
      includeExams: settings.shareIncludeExams,
      examTitlePrefix: t("schedule.examTitlePrefix"),
      busyLabel: t("schedule.shareBusyLabel"),
      now: new Date(clockTick),
    })
    if (payload.items.length === 0) {
      toast.info(t("schedule.exportIcsEmpty"))
      return
    }
    setSharePending(true)
    try {
      const ttlSeconds = Math.min(7, Math.max(1, settings.shareTtlDays)) * 86400
      const created = await props.createScheduleShare(payload, ttlSeconds, {
        includePersonal: settings.shareIncludePersonal,
        includeExams: settings.shareIncludeExams,
      })
      const url = buildShareUrl(created.shareId)
      if (url) {
        await navigator.clipboard?.writeText(url).catch(() => {})
      }
      toast.success(t("schedule.shareCreatedToast"))
    } catch {
      toast.error(t("schedule.shareFailedToast"))
    } finally {
      setSharePending(false)
    }
  }

  const handleRevokeShare = async (shareId: string): Promise<void> => {
    if (!props.revokeScheduleShare) return
    setSharePending(true)
    try {
      await props.revokeScheduleShare(shareId)
      toast.success(t("schedule.shareRevokedToast"))
    } catch {
      toast.error(t("schedule.shareFailedToast"))
    } finally {
      setSharePending(false)
    }
  }

  const handleCopyShareUrl = async (shareId: string): Promise<void> => {
    const url = buildShareUrl(shareId)
    if (!url) return
    try {
      await navigator.clipboard?.writeText(url)
      toast.success(t("schedule.shareCopied"))
    } catch {
      toast.error(t("schedule.shareFailedToast"))
    }
  }

  if (activeProvider && !supportsPlugin(activeProvider.supportedPlugins, props.pluginId)) {
    return null
  }

  if (loading && courses.length === 0 && overlayEntries.length === 0) {
    return (
      <div className="flex flex-col gap-4" data-page="schedule-loading">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const toolbarExtraActions = renderSlot("schedule.toolbar.actions")
  const detailCustomItem =
    detailEntry && typeof detailEntry.metadata?.customItemId === "string"
      ? (customizationsState.customItems.find(
          (item) => item.id === detailEntry.metadata?.customItemId
        ) ?? null)
      : null

  const isViewingCurrentWeek = isStandalone
    ? selectedWeek === STANDALONE_TODAY_WEEK
    : Boolean(currentWeek && currentWeek.week >= 1 && selectedWeek === currentWeek.week)

  const handleBackToCurrentWeek = (): void => {
    if (isStandalone) {
      selectWeek(STANDALONE_TODAY_WEEK)
    } else if (currentWeek && currentWeek.week >= 1) {
      selectWeek(currentWeek.week)
    }
    actions.setWeekPickerOpen(false)
  }

  const renderDesktopToolbar = (): ReactNode => (
    <div className="flex flex-wrap items-center justify-between gap-3">
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => actions.setWeekPickerOpen(true)}
            className="min-w-24 justify-between gap-1"
          >
            <span>
              {isStandalone
                ? t("schedule.today")
                : t("schedule.weekShort", { week: selectedWeek || 1 })}
            </span>
            <ChevronDown className="size-3.5 opacity-60" />
          </Button>
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
        {!isViewingCurrentWeek && (
          <Button type="button" variant="secondary" size="sm" onClick={handleBackToCurrentWeek}>
            {t("schedule.backToCurrentWeek")}
          </Button>
        )}
        {hasAcademicTimetable && semester && (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            {semester}
          </Badge>
        )}
      </div>

      {editing ? (
        <ScheduleEditActionButtons
          hasUndo={Boolean(lastAdjustment)}
          onUndo={() => {
            if (lastAdjustment) requestUndo(lastAdjustment.id)
          }}
          onOpenManager={() => openManager()}
          onDone={() => actions.finishEditing()}
          t={t}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {toolbarExtraActions}
          <Button
            type="button"
            variant={hasAcademicTimetable ? "outline" : "default"}
            size="sm"
            data-schedule-add-item=""
            onClick={() =>
              setItemFormTarget({
                mode: "create",
                initialKind: isStandalone ? "event" : "course",
                initialDay: clock.weekday,
                initialDate: clock.date,
                initialWeek: selectedWeek,
              })
            }
          >
            <Plus data-icon="inline-start" />
            {t("schedule.addEntry")}
          </Button>
          {props.createScheduleShare && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={courses.length === 0 && overlayEntries.length === 0}
              onClick={() => setShareOpen(true)}
            >
              <Share2 data-icon="inline-start" />
              {t("schedule.shareTitle")}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!activeScope}
                data-schedule-manage-menu=""
              >
                <MoreHorizontal data-icon="inline-start" />
                {t("schedule.moreMenu")}
                {totalCustomizationCount > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {totalCustomizationCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {hasAcademicTimetable && (
                <>
                  <DropdownMenuItem
                    disabled={loading}
                    onSelect={() => void handleRefreshSchedule()}
                  >
                    <RefreshCw className={cn("mr-2 size-4", loading && "animate-spin")} />
                    {t("schedule.refreshSchedule")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t("schedule.manageSectionEdit")}
              </DropdownMenuLabel>
              {hasAcademicTimetable && (
                <DropdownMenuItem disabled={!canEdit} onSelect={() => enterEditor()}>
                  <Pencil className="mr-2 size-4" />
                  {t("schedule.manageDragAdjust")}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem disabled={!activeScope} onSelect={() => openManager()}>
                <History className="mr-2 size-4" />
                <span className="flex-1">{t("schedule.manageRecords")}</span>
                {totalCustomizationCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {totalCustomizationCount}
                  </Badge>
                )}
              </DropdownMenuItem>
              {hasAcademicTimetable && (
                <DropdownMenuItem
                  disabled={!effective.ready}
                  onSelect={() => actions.setShowOriginal(true)}
                >
                  <Eye className="mr-2 size-4" />
                  {t("scheduleEditor.showOriginal")}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {t("schedule.manageSectionSync")}
              </DropdownMenuLabel>
              {props.isNative() && props.toggleCalendarSync && (
                <DropdownMenuItem onSelect={() => setCalendarSyncOpen(true)}>
                  <CalendarSync className="mr-2 size-4" />
                  <span className="flex-1">{t("schedule.syncSystemCalendar")}</span>
                  {settings.calendarSyncEnabled && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      ON
                    </Badge>
                  )}
                </DropdownMenuItem>
              )}
              {props.publishWebcalFeed && (
                <DropdownMenuItem onSelect={() => setWebcalOpen(true)}>
                  <Link2 className="mr-2 size-4" />
                  <span className="flex-1">{t("schedule.webcalSubscribe")}</span>
                  {settings.webcalEnabled && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      ON
                    </Badge>
                  )}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                disabled={courses.length === 0 && overlayEntries.length === 0}
                onSelect={() => void handleExportIcs()}
              >
                <Download className="mr-2 size-4" />
                {t("schedule.exportIcs")}
              </DropdownMenuItem>
              {props.isNative() && props.openNotificationsSettings && (
                <DropdownMenuItem onSelect={() => props.openNotificationsSettings?.()}>
                  <Bell className="mr-2 size-4" />
                  {t("schedule.reminderSettingsShortcut")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  )

  return (
    <div
      data-page="schedule"
      className={isMobile && compactMode ? "flex min-h-0 flex-1 flex-col" : "flex flex-col gap-6"}
    >
      <Card className="hidden md:block">
        <CardHeader className="pb-3">
          <CardTitle>{t("schedule.title")}</CardTitle>
          <CardDescription>
            {isStandalone ? t("schedule.standaloneHint") : t("schedule.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>{renderDesktopToolbar()}</CardContent>
      </Card>

      {showOriginal && !isMobile && (
        <Alert className="shrink-0">
          <AlertTitle>{t("scheduleEditor.showOriginal")}</AlertTitle>
          <AlertDescription>
            <p>{t("scheduleEditor.originalNotice")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => actions.setShowOriginal(false)}
            >
              {t("scheduleEditor.showEffective")}
            </Button>
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
        enabled={editing && !activePending && !activeManager && !undoPatch && !itemFormTarget}
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
            <div
              className={cn(
                "-mx-4 -mt-4 -mb-4 flex flex-col md:m-0",
                compactMode && "min-h-0 flex-1 overflow-hidden"
              )}
              style={
                compactMode
                  ? undefined
                  : {
                      minHeight:
                        "calc(100dvh - 3rem - var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) - var(--mobile-bottom-nav-height, calc(4rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))))",
                    }
              }
            >
              {showOriginal && (
                <Alert className="shrink-0 rounded-none border-x-0 border-t-0">
                  <AlertTitle>{t("scheduleEditor.showOriginal")}</AlertTitle>
                  <AlertDescription>
                    <p>{t("scheduleEditor.originalNotice")}</p>
                  </AlertDescription>
                </Alert>
              )}
              {editing && (
                <p className="shrink-0 border-b border-border/60 bg-muted/40 px-3 py-1.5 text-center text-xs text-muted-foreground">
                  {t("scheduleEditor.dragHint")}
                </p>
              )}
              <ScheduleMobile
                courses={courses}
                overlayEntries={overlayEntries}
                periods={periods}
                scheduleRules={scheduleRules}
                currentWeekday={clock.weekday}
                currentWeek={currentWeek}
                weekAnchor={effectiveWeekAnchor}
                selectedWeek={selectedWeek}
                termStartDate={effectiveTermStartDate}
                nowMinutes={clock.minutes}
                labels={labels}
                editor={editor}
                compact={compactMode}
                showGridWhenEmpty={periods.length > 0}
                weekCornerLabel={
                  isStandalone ? undefined : (week) => t("schedule.weekShort", { week })
                }
                onWeekTap={() => actions.setWeekPickerOpen(true)}
                onPrevWeek={() => shiftWeek(-1)}
                onNextWeek={() => shiftWeek(1)}
                colorMap={courseColors}
                onCourseTap={handleCourseTap}
                onEntryTap={setDetailEntry}
                onEmptyCellTap={showOriginal ? undefined : handleEmptyCellTap}
              />
            </div>
          ) : (
            <Card>
              <CardContent className="pt-6">
                {editing && (
                  <p className="mb-3 rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
                    {t("scheduleEditor.dragHint")}
                  </p>
                )}
                <ScheduleTablet
                  courses={filteredCourses}
                  overlayEntries={overlayEntries}
                  periods={periods}
                  scheduleRules={scheduleRules}
                  currentWeekday={clock.weekday}
                  currentWeek={currentWeek}
                  weekAnchor={effectiveWeekAnchor}
                  selectedWeek={selectedWeek}
                  termStartDate={effectiveTermStartDate}
                  nowMinutes={clock.minutes}
                  labels={labels}
                  editor={editor}
                  showGridWhenEmpty={periods.length > 0}
                  colorMap={courseColors}
                  onCourseTap={handleCourseTap}
                  onEntryTap={setDetailEntry}
                  onEmptyCellTap={showOriginal ? undefined : handleEmptyCellTap}
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
        overrides={effective.overrides}
        customItems={
          isStandalone
            ? customizationsState.customItems.filter((item) =>
                isCustomItemActiveInScope(item, null)
              )
            : effective.customItems
        }
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
          if (effective.termStartDate) {
            selectWeek(scheduleWeek(date, effective.termStartDate).week)
          }
          actions.setManager(null)
        }}
        onShowOriginal={() => actions.setShowOriginal(true)}
        onEditOverride={hasAcademicTimetable ? handleEditOverrideByRecord : undefined}
        onRestoreOverride={hasAcademicTimetable ? handleRestoreOverride : undefined}
        onEditCustomItem={(item) => setItemFormTarget({ mode: "edit-custom", item })}
        onDeleteCustomItem={handleDeleteCustomItem}
      />

      <ScheduleItemFormDialog
        target={itemFormTarget}
        courses={effective.courses}
        periods={periods}
        termStartDate={effective.termStartDate}
        totalWeeks={effective.totalWeeks || 20}
        hasAcademicScope={Boolean(effective.scope)}
        semesterScope={effective.scope}
        t={t}
        onClose={() => setItemFormTarget(null)}
        onSaveCustom={handleSaveCustomItem}
        onDeleteCustom={handleDeleteCustomItem}
        onSaveOverride={handleSaveOverride}
        onRestoreOverride={handleRestoreOverride}
        onSaveSinglePatch={canEdit ? saveAdjustment : undefined}
      />

      <ScheduleEntryDetailDialog
        entry={detailEntry}
        customItem={detailCustomItem}
        t={t}
        extraDetailNode={
          detailEntry
            ? renderSlot("schedule.entry.detail", {
                entry: detailEntry,
                ...(detailEntry.date ? { date: detailEntry.date } : {}),
                week: selectedWeek,
              })
            : null
        }
        onClose={() => setDetailEntry(null)}
        onEditCustom={(item) => setItemFormTarget({ mode: "edit-custom", item })}
        onDeleteCustom={handleDeleteCustomItem}
      />

      <CourseActivityModal
        course={activityCourse}
        week={activityWeek}
        open={activityOpen}
        mobileBridge={props.mobileBridge}
        t={t}
        extraDetailNode={
          activityCourse
            ? renderSlot("schedule.entry.detail", {
                entry: courseToDetailEntry(activityCourse, props.pluginId),
                ...(scheduleOccurrence(activityCourse)?.date
                  ? { date: scheduleOccurrence(activityCourse)!.date }
                  : {}),
                week: activityWeek,
              })
            : null
        }
        onOpenChange={setActivityOpen}
        onSigninActivity={(activityId, type) => {
          setSigninActivityId(activityId)
          setSigninType(type)
          setSigninOpen(true)
        }}
        onEditCourse={
          hasAcademicTimetable && effective.ready && !showOriginal
            ? handleEditCourseFromModal
            : undefined
        }
        onCancelSingle={canEdit && !showOriginal ? handleCancelSingleFromModal : undefined}
        onHideCourse={
          hasAcademicTimetable && effective.ready && !showOriginal ? handleHideCourse : undefined
        }
        onEditCustomCourse={handleEditCustomById}
        onDeleteCustomCourse={handleDeleteCustomItem}
      />

      <CourseSigninModal
        activityId={signinActivityId}
        signinType={signinType}
        open={signinOpen}
        mobileBridge={props.mobileBridge}
        t={t}
        onOpenChange={setSigninOpen}
      />

      <ResponsiveModal open={weekPickerOpen} onOpenChange={actions.setWeekPickerOpen}>
        <ResponsiveModalContent className="sm:max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{t("schedule.weekPickerTitle")}</ResponsiveModalTitle>
          </ResponsiveModalHeader>
          <ResponsiveModalBody className="flex min-w-0 flex-col gap-4">
            {isStandalone ? (
              <div className="flex items-center justify-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => shiftWeek(-1)}>
                  <ChevronLeft className="mr-1 size-4" />
                  {t("schedule.weekPrev")}
                </Button>
                <Button type="button" size="sm" onClick={handleBackToCurrentWeek}>
                  {t("schedule.today")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => shiftWeek(1)}>
                  {t("schedule.weekNext")}
                  <ChevronRight className="ml-1 size-4" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("schedule.weekLabel")}
                  </span>
                  {!isViewingCurrentWeek && currentWeek && currentWeek.week >= 1 && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={handleBackToCurrentWeek}
                    >
                      {t("schedule.backToCurrentWeek")}
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {Array.from({ length: Math.max(1, effectiveTotalWeeks || 20) }, (_, idx) => {
                    const weekNum = idx + 1
                    const isSelected = weekNum === selectedWeek
                    const isCurrent = Boolean(currentWeek && currentWeek.week === weekNum)
                    return (
                      <Button
                        key={weekNum}
                        type="button"
                        size="sm"
                        variant={isSelected ? "default" : "outline"}
                        className={cn(
                          "relative h-9 px-0 text-xs",
                          isCurrent && !isSelected && "border-primary/60 font-semibold"
                        )}
                        onClick={() => {
                          selectWeek(weekNum)
                          actions.setWeekPickerOpen(false)
                        }}
                      >
                        {weekNum}
                        {isCurrent && (
                          <span
                            className={cn(
                              "absolute bottom-1 h-1 w-1 rounded-full",
                              isSelected ? "bg-primary-foreground" : "bg-primary"
                            )}
                          />
                        )}
                      </Button>
                    )
                  })}
                </div>
              </div>
            )}

            {hasAcademicTimetable && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("schedule.termLabel")}
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    value={termInput}
                    onChange={(event) => actions.setTermInput(event.target.value)}
                    placeholder={semester || t("schedule.termPlaceholder")}
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={loading}
                    onClick={() => void handleQuery()}
                  >
                    {loading ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Search data-icon="inline-start" />
                    )}
                    {t("schedule.query")}
                  </Button>
                </div>
              </div>
            )}
          </ResponsiveModalBody>
        </ResponsiveModalContent>
      </ResponsiveModal>

      <FilterDrawer
        open={menuOpen}
        onOpenChange={actions.setMenuOpen}
        title={t("schedule.moreMenu")}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border bg-card">
            <button
              type="button"
              onClick={() => {
                actions.setMenuOpen(false)
                actions.setWeekPickerOpen(true)
              }}
              className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors active:bg-muted"
            >
              <Calendar className="size-4 text-muted-foreground" />
              <span className="flex-1">{t("schedule.weekPickerTitle")}</span>
              <span className="text-xs text-muted-foreground">
                {isStandalone
                  ? t("schedule.today")
                  : t("schedule.weekShort", { week: selectedWeek || 1 })}
              </span>
              <ChevronRight className="size-4 text-muted-foreground/70" />
            </button>
            {hasAcademicTimetable && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleRefreshSchedule()}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors active:bg-muted disabled:opacity-50"
              >
                <RefreshCw
                  className={cn("size-4 text-muted-foreground", loading && "animate-spin")}
                />
                <span className="flex-1">{t("schedule.refreshSchedule")}</span>
                {semester && <span className="text-xs text-muted-foreground">{semester}</span>}
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <span className="px-1 text-xs font-medium text-muted-foreground">
              {t("schedule.manageSectionView")}
            </span>
            <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border bg-card">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="flex items-center gap-3 text-sm">
                  {settings.compactMode ? (
                    <Grid3x3 className="size-4 text-muted-foreground" />
                  ) : (
                    <Grid3x2 className="size-4 text-muted-foreground" />
                  )}
                  {t("schedule.compactHint")}
                </span>
                <Switch
                  aria-label={t("schedule.compactHint")}
                  checked={settings.compactMode}
                  onCheckedChange={(checked) => props.setCompactMode(checked)}
                />
              </div>
              {hasAcademicTimetable && (
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => {
                    actions.setMenuOpen(false)
                    enterEditor()
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors active:bg-muted disabled:opacity-40"
                >
                  <Pencil className="size-4 text-muted-foreground" />
                  <span className="flex-1">{t("schedule.manageDragAdjust")}</span>
                </button>
              )}
              <button
                type="button"
                disabled={!activeScope}
                onClick={() => {
                  actions.setMenuOpen(false)
                  openManager()
                }}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors active:bg-muted disabled:opacity-40"
              >
                <History className="size-4 text-muted-foreground" />
                <span className="flex-1">{t("schedule.manageRecords")}</span>
                {totalCustomizationCount > 0 && (
                  <Badge variant="secondary">{totalCustomizationCount}</Badge>
                )}
              </button>
              {hasAcademicTimetable && (
                <button
                  type="button"
                  disabled={!effective.ready}
                  onClick={() => {
                    actions.setMenuOpen(false)
                    actions.setShowOriginal(true)
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors active:bg-muted disabled:opacity-40"
                >
                  <Eye className="size-4 text-muted-foreground" />
                  <span className="flex-1">{t("scheduleEditor.showOriginal")}</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="px-1 text-xs font-medium text-muted-foreground">
              {t("schedule.manageSectionSync")}
            </span>
            <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border bg-card">
              {props.isNative() && props.toggleCalendarSync && (
                <button
                  type="button"
                  onClick={() => {
                    actions.setMenuOpen(false)
                    setCalendarSyncOpen(true)
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors active:bg-muted"
                >
                  <CalendarSync className="size-4 text-muted-foreground" />
                  <span className="flex-1">{t("schedule.syncSystemCalendar")}</span>
                  {settings.calendarSyncEnabled && (
                    <Badge variant="secondary" className="text-[10px]">
                      ON
                    </Badge>
                  )}
                </button>
              )}
              {props.publishWebcalFeed && (
                <button
                  type="button"
                  onClick={() => {
                    actions.setMenuOpen(false)
                    setWebcalOpen(true)
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors active:bg-muted"
                >
                  <Link2 className="size-4 text-muted-foreground" />
                  <span className="flex-1">{t("schedule.webcalSubscribe")}</span>
                  {settings.webcalEnabled && (
                    <Badge variant="secondary" className="text-[10px]">
                      ON
                    </Badge>
                  )}
                </button>
              )}
              <button
                type="button"
                disabled={courses.length === 0 && overlayEntries.length === 0}
                onClick={() => {
                  actions.setMenuOpen(false)
                  void handleExportIcs()
                }}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors active:bg-muted disabled:opacity-40"
              >
                <Download className="size-4 text-muted-foreground" />
                <span className="flex-1">{t("schedule.exportIcs")}</span>
              </button>
              {props.isNative() && props.openNotificationsSettings && (
                <button
                  type="button"
                  onClick={() => {
                    actions.setMenuOpen(false)
                    props.openNotificationsSettings?.()
                  }}
                  className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm transition-colors active:bg-muted"
                >
                  <Bell className="size-4 text-muted-foreground" />
                  <span className="flex-1">{t("schedule.reminderSettingsShortcut")}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </FilterDrawer>

      {props.isNative() && props.toggleCalendarSync && (
        <ResponsiveModal open={calendarSyncOpen} onOpenChange={setCalendarSyncOpen}>
          <ResponsiveModalContent className="sm:max-w-md">
            <ResponsiveModalHeader>
              <ResponsiveModalTitle className="flex items-center justify-center gap-2 md:justify-start">
                <CalendarSync className="size-4 text-primary" />
                {t("settings.calendarSyncTitle")}
              </ResponsiveModalTitle>
            </ResponsiveModalHeader>
            <ResponsiveModalBody className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 py-1">
                <span className="text-sm font-medium">{t("settings.calendarSyncEnabled")}</span>
                <Switch
                  aria-label={t("settings.calendarSyncEnabled")}
                  checked={settings.calendarSyncEnabled}
                  disabled={calendarSyncPending}
                  onCheckedChange={(enabled) => void handleToggleCalendarSync(enabled)}
                />
              </div>

              {settings.calendarSyncEnabled && (
                <>
                  <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                    <span className="flex items-center gap-2 text-sm">
                      <Calendar className="size-4 text-muted-foreground" />
                      {t("settings.calendarSyncIncludeExams")}
                    </span>
                    <Switch
                      checked={settings.calendarSyncIncludeExams}
                      onCheckedChange={(checked) => props.setCalendarSyncIncludeExams?.(checked)}
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm">{t("settings.calendarSyncWriteReminders")}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("settings.calendarSyncWriteRemindersHint")}
                      </span>
                    </div>
                    <Switch
                      checked={settings.calendarSyncWriteReminders}
                      onCheckedChange={(checked) => props.setCalendarSyncWriteReminders?.(checked)}
                    />
                  </div>

                  {settings.classReminderEnabled && settings.calendarSyncWriteReminders && (
                    <Alert>
                      <TriangleAlert className="size-4" />
                      <AlertDescription className="text-xs">
                        {t("settings.calendarSyncDuplicateWarning")}
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                    <span className="text-xs text-muted-foreground">
                      {calendarSyncStatus.syncing
                        ? t("settings.calendarSyncSyncing")
                        : calendarSyncStatus.error
                          ? calendarSyncStatus.error
                          : calendarSyncStatus.lastSyncedCount !== null
                            ? t("settings.calendarSyncSyncedCount", {
                                count: calendarSyncStatus.lastSyncedCount,
                              })
                            : t("settings.calendarSyncTitle")}
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={calendarSyncPending || calendarSyncStatus.syncing}
                        onClick={() => void handleSyncCalendarNow()}
                      >
                        <RefreshCw className="mr-1 size-3.5" />
                        {t("settings.calendarSyncNow")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={calendarSyncPending || calendarSyncStatus.syncing}
                        onClick={() => void handleClearSystemCalendar()}
                      >
                        <Trash2 className="mr-1 size-3.5" />
                        {t("settings.calendarSyncClear")}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </ResponsiveModalBody>
            <ResponsiveModalFooter>
              {props.openNotificationsSettings && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setCalendarSyncOpen(false)
                    props.openNotificationsSettings?.()
                  }}
                >
                  <Bell className="mr-1.5 size-4" />
                  {t("schedule.reminderSettingsShortcut")}
                </Button>
              )}
              <Button type="button" onClick={() => setCalendarSyncOpen(false)}>
                {t("closeDialog")}
              </Button>
            </ResponsiveModalFooter>
          </ResponsiveModalContent>
        </ResponsiveModal>
      )}

      {props.publishWebcalFeed && (
        <ResponsiveModal open={webcalOpen} onOpenChange={setWebcalOpen}>
          <ResponsiveModalContent className="sm:max-w-md">
            <ResponsiveModalHeader>
              <ResponsiveModalTitle className="flex items-center justify-center gap-2 md:justify-start">
                <Link2 className="size-4 text-primary" />
                {t("schedule.webcalTitle")}
              </ResponsiveModalTitle>
              <ResponsiveModalDescription>{t("schedule.webcalDesc")}</ResponsiveModalDescription>
            </ResponsiveModalHeader>
            <ResponsiveModalBody className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm">
                  <Calendar className="size-4 text-muted-foreground" />
                  {t("settings.calendarSyncIncludeExams")}
                </span>
                <Switch
                  checked={settings.webcalIncludeExams}
                  onCheckedChange={(checked) => props.setWebcalIncludeExams?.(checked)}
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm">{t("settings.calendarSyncWriteReminders")}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("settings.calendarSyncWriteRemindersHint")}
                  </span>
                </div>
                <Switch
                  checked={settings.webcalWriteReminders}
                  onCheckedChange={(checked) => props.setWebcalWriteReminders?.(checked)}
                />
              </div>

              {webcalSchemeUrl ? (
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <div className="rounded-md border bg-muted/40 px-2.5 py-2 font-mono text-[11px] break-all text-muted-foreground">
                    {webcalSchemeUrl}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button asChild size="sm">
                      <a href={webcalSchemeUrl}>
                        <ExternalLink className="mr-1.5 size-3.5" />
                        {t("schedule.webcalOpenApp")}
                      </a>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handleCopyWebcalUrl()}
                    >
                      <Copy className="mr-1.5 size-3.5" />
                      {t("schedule.webcalCopyLink")}
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-xs text-muted-foreground">
                      {settings.webcalLastSyncedCount !== null
                        ? t("settings.calendarSyncSyncedCount", {
                            count: settings.webcalLastSyncedCount,
                          })
                        : ""}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={webcalPending}
                        onClick={() => void handlePublishWebcal(false)}
                      >
                        <RefreshCw className="mr-1 size-3.5" />
                        {t("schedule.webcalUpdateNow")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={webcalPending}
                        onClick={() => void handlePublishWebcal(true)}
                      >
                        <RotateCcw className="mr-1 size-3.5" />
                        {t("schedule.webcalRotateLink")}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  disabled={webcalPending}
                  onClick={() => void handlePublishWebcal(false)}
                >
                  <Link2 className="mr-1.5 size-4" />
                  {t("schedule.webcalEnable")}
                </Button>
              )}
            </ResponsiveModalBody>
            <ResponsiveModalFooter>
              {settings.webcalEnabled && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={webcalPending}
                  onClick={() => void handleDeleteWebcal()}
                >
                  <Trash2 className="mr-1.5 size-4" />
                  {t("schedule.webcalClear")}
                </Button>
              )}
              <Button type="button" onClick={() => setWebcalOpen(false)}>
                {t("closeDialog")}
              </Button>
            </ResponsiveModalFooter>
          </ResponsiveModalContent>
        </ResponsiveModal>
      )}

      {props.createScheduleShare && (
        <ResponsiveModal open={shareOpen} onOpenChange={setShareOpen}>
          <ResponsiveModalContent className="overflow-hidden sm:max-w-md">
            <ResponsiveModalHeader>
              <ResponsiveModalTitle className="flex items-center justify-center gap-2 md:justify-start">
                <Share2 className="size-4 text-primary" />
                {t("schedule.shareTitle")}
              </ResponsiveModalTitle>
            </ResponsiveModalHeader>
            <ResponsiveModalBody className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{t("schedule.shareMask")}</span>
                  <Switch
                    checked={settings.shareMaskEnabled}
                    onCheckedChange={(checked) => props.setShareMaskEnabled?.(checked)}
                  />
                </div>
                {settings.shareMaskEnabled && (
                  <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 px-3 py-2.5">
                    <span className="text-xs text-muted-foreground">
                      {t("schedule.shareMaskFieldsLabel")}
                    </span>
                    <div className="grid grid-cols-3 gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant={settings.shareMaskShowTitle ? "default" : "outline"}
                        onClick={() => props.setShareMaskShowTitle?.(!settings.shareMaskShowTitle)}
                      >
                        {t("schedule.shareMaskShowTitle")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={settings.shareMaskShowLocation ? "default" : "outline"}
                        onClick={() =>
                          props.setShareMaskShowLocation?.(!settings.shareMaskShowLocation)
                        }
                      >
                        {t("schedule.shareMaskShowLocation")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={settings.shareMaskShowSubtitle ? "default" : "outline"}
                        onClick={() =>
                          props.setShareMaskShowSubtitle?.(!settings.shareMaskShowSubtitle)
                        }
                      >
                        {t("schedule.shareMaskShowSubtitle")}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <span className="text-sm">{t("schedule.shareIncludePersonal")}</span>
                <Switch
                  checked={settings.shareIncludePersonal}
                  onCheckedChange={(checked) => props.setShareIncludePersonal?.(checked)}
                />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <span className="text-sm">{t("schedule.shareIncludeExams")}</span>
                <Switch
                  checked={settings.shareIncludeExams}
                  onCheckedChange={(checked) => props.setShareIncludeExams?.(checked)}
                />
              </div>

              {hasAcademicTimetable && (
                <div className="flex flex-col gap-2.5 border-t border-border pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm">{t("schedule.shareCustomRange")}</span>
                    <Switch
                      checked={shareCustomRange}
                      onCheckedChange={handleToggleShareCustomRange}
                    />
                  </div>
                  {shareCustomRange && (
                    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-2.5">
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs"
                          onClick={() => {
                            const w =
                              currentWeek?.week && currentWeek.week >= 1
                                ? currentWeek.week
                                : selectedWeek || 1
                            setShareSelectedWeeks([w])
                          }}
                        >
                          {t("schedule.shareRangeThisWeek")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 px-2.5 text-xs"
                          onClick={() =>
                            setShareSelectedWeeks(
                              Array.from(
                                { length: Math.max(1, effectiveTotalWeeks || 20) },
                                (_, i) => i + 1
                              )
                            )
                          }
                        >
                          {t("schedule.shareRangeAll")}
                        </Button>
                      </div>
                      <div className="grid grid-cols-5 gap-1">
                        {Array.from(
                          { length: Math.max(1, effectiveTotalWeeks || 20) },
                          (_, idx) => {
                            const weekNum = idx + 1
                            const active = shareSelectedWeeks.includes(weekNum)
                            return (
                              <Button
                                key={weekNum}
                                type="button"
                                size="sm"
                                variant={active ? "default" : "outline"}
                                className="h-7 px-0 text-xs"
                                onClick={() => handleToggleShareWeek(weekNum)}
                              >
                                {weekNum}
                              </Button>
                            )
                          }
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-2 border-t border-border pt-3">
                <span className="text-sm">{t("schedule.shareTtlLabel")}</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(
                    [
                      { days: 1, label: t("schedule.shareTtl1d") },
                      { days: 3, label: t("schedule.shareTtl3d") },
                      { days: 7, label: t("schedule.shareTtl7d") },
                    ] as const
                  ).map((opt) => (
                    <Button
                      key={opt.days}
                      type="button"
                      size="sm"
                      variant={
                        Math.min(7, settings.shareTtlDays) === opt.days ? "default" : "outline"
                      }
                      onClick={() => props.setShareTtlDays?.(opt.days)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>

              <Button
                type="button"
                disabled={sharePending}
                onClick={() => void handleCreateShare()}
              >
                <Share2 className="mr-1.5 size-4" />
                {t("schedule.shareGenerate")}
              </Button>

              {sharedLinks.length > 0 && (
                <div className="flex min-w-0 flex-col gap-2 border-t border-border pt-3">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("schedule.shareLinksTitle")}
                  </span>
                  <div className="flex max-h-52 min-w-0 flex-col gap-2 overflow-y-auto pr-0.5">
                    {sharedLinks.map((link) => {
                      const url = buildShareUrl(link.shareId)
                      const expired = clockTick > link.expiresAt
                      return (
                        <div
                          key={link.shareId}
                          className="flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-lg border bg-muted/25 p-2.5"
                        >
                          <div className="flex min-w-0 items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-1">
                              {expired ? (
                                <Badge variant="outline" className="text-[10px]">
                                  {t("schedule.shareExpiredBadge")}
                                </Badge>
                              ) : (
                                <span className="text-[11px] text-muted-foreground">
                                  {t("schedule.shareExpiresAt", {
                                    date: new Date(link.expiresAt).toISOString().slice(0, 10),
                                  })}
                                </span>
                              )}
                              {link.masked && (
                                <Badge variant="secondary" className="text-[10px]">
                                  {t("schedule.shareTagMasked")}
                                </Badge>
                              )}
                              {link.includePersonal && (
                                <Badge variant="secondary" className="text-[10px]">
                                  {t("schedule.shareTagPersonal")}
                                </Badge>
                              )}
                              {link.includeExams && (
                                <Badge variant="secondary" className="text-[10px]">
                                  {t("schedule.shareTagExams")}
                                </Badge>
                              )}
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
                              {!expired && (
                                <>
                                  <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={t("schedule.shareCopyLink")}
                                    onClick={() => void handleCopyShareUrl(link.shareId)}
                                  >
                                    <Copy className="size-3.5" />
                                  </Button>
                                  <Button
                                    asChild
                                    size="icon-sm"
                                    variant="ghost"
                                    aria-label={t("schedule.shareOpenLink")}
                                  >
                                    <a href={url} target="_blank" rel="noopener noreferrer">
                                      <ExternalLink className="size-3.5" />
                                    </a>
                                  </Button>
                                </>
                              )}
                              <Button
                                type="button"
                                size="icon-sm"
                                variant="ghost"
                                disabled={sharePending}
                                aria-label={
                                  expired
                                    ? t("schedule.shareRemoveExpired")
                                    : t("schedule.shareRevoke")
                                }
                                onClick={() => void handleRevokeShare(link.shareId)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </div>
                          </div>
                          <div className="w-0 min-w-full truncate font-mono text-[11px] text-muted-foreground">
                            {url}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </ResponsiveModalBody>
            <ResponsiveModalFooter>
              <Button type="button" onClick={() => setShareOpen(false)}>
                {t("closeDialog")}
              </Button>
            </ResponsiveModalFooter>
          </ResponsiveModalContent>
        </ResponsiveModal>
      )}

      <WidgetDiscovery
        isNative={props.isNative()}
        hidden={settings.widgetAssistantHidden}
        position={settings.widgetAssistantPosition}
        suspended={editing || showOriginal || isStandalone}
        assistantSrc={props.assistantSrc}
        widgetsSettingsHref={props.widgetsSettingsHref}
        t={t}
        onSetHidden={props.setWidgetAssistantHidden}
        onSetPosition={props.setWidgetAssistantPosition}
        onRequestPinSchedule={props.requestPinScheduleWidget}
        onOpenWidgetsSettings={props.openWidgetsSettings}
        onOpenCalendarSync={props.toggleCalendarSync ? () => setCalendarSyncOpen(true) : undefined}
        onOpenRemindersSettings={props.openNotificationsSettings}
        onExportIcs={() => void handleExportIcs()}
        onQuickAdd={() =>
          setItemFormTarget({
            mode: "create",
            initialKind: isStandalone ? "event" : "course",
            initialDay: clock.weekday,
            initialDate: clock.date,
            initialWeek: selectedWeek,
          })
        }
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
    readonly customizations: ObservableSource<ScheduleCustomizationsState>
    readonly customizationsHydrated: ObservableSource<boolean>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly session: ObservableSource<SessionSnapshot>
    readonly schedule: ObservableSource<QuerySnapshot<Course[]>>
    readonly currentWeek: ObservableSource<QuerySnapshot<CurrentWeek>>
    readonly termCalendar: ObservableSource<QuerySnapshot<TermCalendar>>
  }
  readonly pluginId: string
  readonly setCompactMode: (compact: boolean) => void
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
  const patchesState = props.usePatches()
  const patchesHydrated = props.usePatchesHydrated()
  const customizationsState = props.useCustomizations()
  const customizationsHydrated = props.useCustomizationsHydrated()
  const providerSnap = props.useProvider()
  const sessionSnap = props.useSession()
  const scheduleQuery = props.useSchedule()
  const currentWeekQuery = props.useCurrentWeek()
  const termCalendarQuery = props.useTermCalendar()

  const weekOverride = useStore((s) => s.weekOverride)
  const queriedTerm = useStore((s) => s.queriedTerm)
  const editScope = useStore((s) => s.editScope)
  const showOriginal = useStore((s) => s.showOriginal)

  const onSchedulePage = location.route === "schedule" || location.pluginId === props.pluginId
  const activeProvider = providerSnap.provider
  if (
    !onSchedulePage ||
    (activeProvider && !supportsPlugin(activeProvider.supportedPlugins, props.pluginId))
  ) {
    return null
  }

  const hasAcademicTimetable = Boolean(activeProvider && hasSlice(activeProvider, "timetable"))
  const snapshot = currentWeekQuery.data ?? null
  const rawCalendar = termCalendarQuery.data
  const semester = queriedTerm || snapshot?.semester
  const termCalendar =
    semester && rawCalendar?.semester && rawCalendar.semester !== semester ? undefined : rawCalendar

  const timeZone = activeProvider?.slices.timetable?.scheduleRules?.timeZone
  const clock = getAcademicClock(new Date(clockTick), timeZone)
  const currentWeek = resolveAcademicWeek(
    snapshot,
    rawCalendar,
    clock.date,
    queriedTerm || undefined
  )
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
    customizationsState,
    customizationsHydrated,
  })

  const editing =
    effective.ready && editScope !== null && editScope === effective.scope && !showOriginal
  const lastAdjustment = effective.patches.filter((patch) => patch.enabled).at(-1)

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
        <>
          <ScheduleEditActionButtons
            hasUndo={Boolean(lastAdjustment)}
            onUndo={() => {
              if (lastAdjustment && effective.scope) {
                actions.setUndo({
                  scope: effective.scope,
                  id: lastAdjustment.id,
                  remove: true,
                })
              }
            }}
            onOpenManager={() => {
              if (effective.scope) {
                actions.setManager({ scope: effective.scope, id: null })
              }
            }}
            onDone={() => actions.finishEditing()}
            t={t}
          />
          <FilterTrigger
            label={
              hasAcademicTimetable && selectedWeek
                ? t("schedule.weekShort", { week: selectedWeek })
                : t("schedule.today")
            }
            onClick={() => actions.setWeekPickerOpen(true)}
          />
        </>
      ) : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8"
            onClick={() => actions.requestCreate()}
            aria-label={t("schedule.addEntry")}
          >
            <Plus className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8"
            onClick={() => actions.requestShare()}
            aria-label={t("schedule.shareTitle")}
          >
            <Share2 className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8"
            onClick={() => actions.setMenuOpen(true)}
            aria-label={t("schedule.moreMenu")}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </>
      )}
    </div>
  )
}
