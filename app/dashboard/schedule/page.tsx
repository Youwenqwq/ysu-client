"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "sonner"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { FilterDrawer, FilterTrigger } from "@/components/academic/filter-drawer"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useIsMobile } from "@/hooks/use-mobile"
import { useBackHandler } from "@/hooks/use-back-handler"
import { useAcademicTime } from "@/hooks/use-academic-time"
import { useMobileHeaderLayout, useMobileHeaderRight } from "@/lib/stores/mobile-header"
import { useEffectiveSchedule } from "@/providers/hooks/use-effective-schedule"
import {
  schedulePatchAffectsWeek,
  scheduleWeek,
  type ScheduleDrop,
  type SchedulePatch,
  type ScheduleSelection,
} from "@/lib/academic/schedule-patches"
import {
  useClassPeriods,
  useCurrentWeek,
  useExams,
  useSchedule,
  useTermCalendar,
} from "@/providers/hooks"
import {
  CalendarDays,
  CalendarSearch,
  ChevronLeft,
  ChevronRight,
  Search,
  Grid3x2,
  Grid3x3,
  Check,
  History,
  Pencil,
  Undo2,
  TriangleAlert,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { isCourseActiveInWeek, parseTimeToMinutes, periodIsInUse } from "./schedule-utils"
import { computeExamBlocks } from "./exam-blocks"
import { buildCourseColorMap } from "./course-color"
import { ScheduleTablet } from "./schedule-tablet"
import { ScheduleMobile } from "./schedule-mobile"
import { ScheduleDragProvider } from "./schedule-drag"
import { ScheduleAdjustmentDialog, ScheduleAdjustmentsDialog } from "./schedule-editor-dialogs"
import { syncExamsToWidget, syncScheduleToWidget } from "@/lib/native/widget-bridge"
import { syncClassAlarmsToNative } from "@/lib/native/notify"
import { useSettingsStore } from "@/lib/stores/settings"

export default function SchedulePage() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const compactMode = useSettingsStore((s) => s.scheduleCompactMode)
  const setCompactMode = useSettingsStore((s) => s.setScheduleCompactMode)
  const widgetSyncReminderHours = useSettingsStore((s) => s.widgetSyncReminderHours)
  // null follows the live academic week; a number is an explicit browsing selection.
  const [weekOverride, setWeekOverride] = useState<number | null>(null)
  const [term, setTerm] = useState("")
  const [queriedTerm, setQueriedTerm] = useState("")
  const isDefaultTerm = queriedTerm === ""
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false)
  const [editScope, setEditScope] = useState<string | null>(null)
  const [pending, setPending] = useState<{ scope: string; drop: ScheduleDrop } | null>(null)
  const [manager, setManager] = useState<{ scope: string; id: string | null } | null>(null)
  const [showOriginal, setShowOriginal] = useState(false)
  const [undo, setUndo] = useState<{ scope: string; id: string; remove: boolean } | null>(null)

  const scheduleQuery = useSchedule({
    semester: queriedTerm || undefined,
    courseCategory: "all",
    includeLabSchedule: true,
  })
  const currentWeekQuery = useCurrentWeek({
    semester: queriedTerm || undefined,
  })
  const termCalendarQuery = useTermCalendar({
    semester: queriedTerm || undefined,
  })
  const periodsQuery = useClassPeriods()
  const examsQuery = useExams({ semester: queriedTerm || undefined })

  const rawCourses = useMemo(() => scheduleQuery.data ?? [], [scheduleQuery.data])
  const snapshot = currentWeekQuery.data ?? null
  const rawCalendar = termCalendarQuery.data
  const semester = queriedTerm || snapshot?.semester
  const termCalendar =
    semester && rawCalendar?.semester && rawCalendar.semester !== semester ? undefined : rawCalendar
  const weekAnchor =
    queriedTerm && snapshot?.semester && snapshot.semester !== queriedTerm ? null : snapshot
  const { currentWeek, weekday, nowMinutes } = useAcademicTime(snapshot, rawCalendar, queriedTerm)
  const selectedWeek = weekOverride ?? currentWeek?.week ?? 1
  const effective = useEffectiveSchedule(scheduleQuery.data, termCalendar, snapshot, queriedTerm)
  const canEdit = effective.ready && !!periodsQuery.data?.some(periodIsInUse)
  const editing =
    effective.ready && editScope !== null && editScope === effective.scope && !showOriginal
  const mobileFullscreen = isMobile && (editing || showOriginal)
  const courses = effective.ready && !showOriginal ? effective.courses : rawCourses
  const activePending = pending?.scope === effective.scope ? pending : null
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
  const adjustmentsView = useMemo(
    () =>
      undoPatch && undo
        ? { kind: "confirmation" as const, patch: undoPatch, remove: undo.remove }
        : activeManager
          ? { kind: "manager" as const, selectedPatchId: activeManager.id }
          : null,
    [undoPatch, undo, activeManager]
  )
  const titleHint =
    effective.ready && !showOriginal && (weekAdjustmentCount > 0 || reviewCount > 0)
      ? [
          t("scheduleEditor.weekAdjustments", { count: weekAdjustmentCount }),
          ...(reviewCount > 0 ? [t("scheduleEditor.reviewCount", { count: reviewCount })] : []),
        ].join(" · ")
      : null
  useMobileHeaderLayout(
    isMobile
      ? showOriginal
        ? t("scheduleEditor.originalTitle")
        : editing
          ? t("scheduleEditor.title")
          : null
      : null,
    mobileFullscreen,
    isMobile ? titleHint : null
  )

  function finishEditing() {
    setEditScope(null)
    setPending(null)
  }

  useBackHandler(finishEditing, editing)
  useBackHandler(() => setShowOriginal(false), showOriginal)

  function enterEditor() {
    if (!canEdit) return
    setWeekOverride(Math.min(effective.totalWeeks, Math.max(1, selectedWeek)))
    setShowOriginal(false)
    setFilterDrawerOpen(false)
    setEditScope(effective.scope)
  }

  function openManager(id: string | null = null) {
    if (effective.scope) setManager({ scope: effective.scope, id })
  }

  function openAdjustment(drop: ScheduleDrop) {
    if (editing && effective.scope) setPending({ scope: effective.scope, drop })
  }

  function selectAdjustment(selection: ScheduleSelection) {
    openAdjustment({
      selection,
      targetDate: selection.date,
      targetStartSection: selection.courses[0]?.startSection ?? 1,
    })
  }

  function saveAdjustment(draft: Omit<SchedulePatch, "id" | "createdAt" | "enabled">) {
    const id = effective.addPatch(draft)
    setPending(null)
    toast.success(t("scheduleEditor.saved"), {
      action: { label: t("scheduleEditor.undo"), onClick: () => requestUndo(id) },
    })
  }

  function requestUndo(id: string, remove = true) {
    if (effective.scope) setUndo({ scope: effective.scope, id, remove })
  }

  function confirmUndo() {
    if (!undoPatch || !undo) return
    try {
      if (undo.remove) effective.removePatch(undoPatch.id)
      else effective.setPatchEnabled(undoPatch.id, false)
      setUndo(null)
      toast.success(t("scheduleEditor.undone"))
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message.startsWith("scheduleEditor.")
            ? t(error.message)
            : error.message
          : t("scheduleEditor.saveFailed")
      )
    }
  }

  const loading =
    scheduleQuery.isLoading ||
    scheduleQuery.isValidating ||
    currentWeekQuery.isLoading ||
    currentWeekQuery.isValidating ||
    termCalendarQuery.isLoading ||
    termCalendarQuery.isValidating ||
    periodsQuery.isLoading ||
    periodsQuery.isValidating ||
    examsQuery.isLoading ||
    examsQuery.isValidating

  // In compact mode, adjust <main> padding-bottom to match the actual nav bar height,
  // so the content area ends exactly at the nav top edge.
  useEffect(() => {
    if (!compactMode || mobileFullscreen) return
    const main = document.querySelector("main")
    const nav = document.querySelector('nav[aria-label="Primary"]')
    if (!main || !nav) return
    const adjust = () => {
      main.style.paddingBottom = `${nav.getBoundingClientRect().height}px`
    }
    adjust()
    const observer = new ResizeObserver(adjust)
    observer.observe(nav)
    return () => {
      observer.disconnect()
      main.style.paddingBottom = ""
    }
  }, [compactMode, mobileFullscreen])

  const periods = useMemo(() => {
    if (!periodsQuery.data) return []
    return periodsQuery.data.filter(periodIsInUse).sort((a, b) => a.section - b.section)
  }, [periodsQuery.data])

  function selectWeek(week: number) {
    const nextWeek = Math.max(1, week)
    setWeekOverride(!editing && nextWeek === currentWeek?.week ? null : nextWeek)
  }

  function shiftWeek(delta: number) {
    selectWeek(Math.min(effective.totalWeeks || Infinity, Math.max(1, selectedWeek + delta)))
  }

  useEffect(() => {
    const errors = [
      scheduleQuery.error,
      currentWeekQuery.error,
      termCalendarQuery.error,
      periodsQuery.error,
      examsQuery.error,
    ].filter(Boolean)
    if (errors.length === 0) return
    toast.error(errors[0]?.message || t("app.updating"))
  }, [
    scheduleQuery.error,
    currentWeekQuery.error,
    termCalendarQuery.error,
    periodsQuery.error,
    examsQuery.error,
    t,
  ])

  useEffect(() => {
    if (!isDefaultTerm || (!effective.ready && currentWeek)) return
    syncScheduleToWidget(
      effective.courses,
      currentWeek,
      periods,
      useSettingsStore.getState().widgetSyncReminderHours,
      useSettingsStore.getState().widgetShowNextDaySchedule,
      termCalendar
    ).catch(() => {})
  }, [isDefaultTerm, effective.ready, effective.courses, currentWeek, periods, termCalendar])

  useEffect(() => {
    if (!isDefaultTerm || (!effective.ready && currentWeek)) return
    void syncClassAlarmsToNative(effective.courses, currentWeek, periods, termCalendar).catch(
      () => {}
    )
  }, [isDefaultTerm, effective.ready, effective.courses, currentWeek, periods, termCalendar])

  useEffect(() => {
    if (!isDefaultTerm || !examsQuery.data) return
    syncExamsToWidget(examsQuery.data, widgetSyncReminderHours).catch(() => {})
  }, [isDefaultTerm, examsQuery.data, widgetSyncReminderHours])

  async function handleQuery() {
    const nextTerm = term.trim()
    if (nextTerm === queriedTerm) {
      await Promise.all([
        scheduleQuery.mutate(),
        currentWeekQuery.mutate(),
        termCalendarQuery.mutate(),
        periodsQuery.mutate(),
        examsQuery.mutate(),
      ])
    } else {
      setQueriedTerm(nextTerm)
      setWeekOverride(null)
    }
    setFilterDrawerOpen(false)
  }

  const headerWeekday = weekday
  const currentSection = useMemo(() => {
    if (headerWeekday <= 0) return null
    for (const p of periods) {
      const start = parseTimeToMinutes(p.startTime)
      const end = parseTimeToMinutes(p.endTime)
      if (start === null || end === null) continue
      if (nowMinutes >= start && nowMinutes < end) return p.section
    }
    const upcoming = periods.find((p) => {
      const start = parseTimeToMinutes(p.startTime)
      return start !== null && start > nowMinutes
    })
    return upcoming?.section ?? null
  }, [periods, nowMinutes, headerWeekday])
  const freeRoomHref = useMemo(() => {
    const params = new URLSearchParams({
      tab: "room",
      week: String(selectedWeek || currentWeek?.week || 1),
    })
    if (headerWeekday >= 1) params.set("day", String(headerWeekday))
    if (currentSection) params.set("section", String(currentSection))
    return `/dashboard/school-schedule?${params.toString()}`
  }, [selectedWeek, currentWeek?.week, headerWeekday, currentSection])

  const editorActions = (
    <div className="flex items-center gap-1">
      <Button
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
        variant="ghost"
        size="icon-sm"
        onClick={() => openManager()}
        aria-label={t("scheduleEditor.manage")}
      >
        <History />
      </Button>
      <Button size="sm" onClick={finishEditing}>
        <Check data-icon="inline-start" />
        {t("scheduleEditor.done")}
      </Button>
    </div>
  )

  useMobileHeaderRight(
    showOriginal ? (
      <Button size="sm" variant="outline" onClick={() => setShowOriginal(false)}>
        {t("scheduleEditor.showEffective")}
      </Button>
    ) : editing ? (
      editorActions
    ) : (
      <div className="flex items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8"
              aria-label={t("app.schoolSchedule")}
            >
              <CalendarDays className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href="/dashboard/school-schedule">{t("app.schoolSchedule")}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={freeRoomHref}>{t("schoolSchedule.freeRoomEntry")}</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCompactMode(!compactMode)}
          className="h-8 w-8"
          aria-label={t("schedule.compactHint")}
        >
          {compactMode ? <Grid3x3 className="size-4" /> : <Grid3x2 className="size-4" />}
        </Button>
        <FilterTrigger
          label={
            selectedWeek ? t("schedule.weekShort", { week: selectedWeek }) : t("schedule.weekLabel")
          }
          onClick={() => setFilterDrawerOpen(true)}
        />
      </div>
    ),
    [
      selectedWeek,
      t,
      compactMode,
      setCompactMode,
      currentSection,
      freeRoomHref,
      editing,
      showOriginal,
      effective.patches,
      effective.scope,
    ]
  )

  const filteredCourses = useMemo(() => {
    if (selectedWeek <= 0) return courses
    return courses.filter((c) => isCourseActiveInWeek(c, selectedWeek))
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
    [examsQuery.data, periods, weekAnchor, selectedWeek, termCalendar?.startDate]
  )

  const currentWeekday = weekday

  if (loading && courses.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const renderFilterControls = (idPrefix: string) => (
    <FieldGroup className="flex flex-row flex-wrap items-end gap-3">
      <Field className="w-48">
        <FieldLabel htmlFor={`${idPrefix}-term`}>{t("schedule.termLabel")}</FieldLabel>
        <Input
          id={`${idPrefix}-term`}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
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
              onChange={(e) => selectWeek(parseInt(e.target.value, 10) || 1)}
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
      <Button onClick={handleQuery} disabled={loading}>
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
          setFilterDrawerOpen(false)
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
      className={
        isMobile && (compactMode || mobileFullscreen)
          ? "flex min-h-0 flex-1 flex-col"
          : "flex flex-col gap-6"
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
            <Button variant="outline" asChild>
              <Link href={freeRoomHref}>
                <CalendarSearch data-icon="inline-start" />
                {t("schoolSchedule.freeRoomEntry")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard/school-schedule">
                <CalendarDays data-icon="inline-start" />
                {t("app.schoolSchedule")}
              </Link>
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
              <Button variant="outline" size="sm" onClick={() => setShowOriginal(false)}>
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
          <div
            className={cn("flex shrink-0 flex-wrap items-center gap-2", isMobile && "px-2 py-1")}
          >
            <Button variant="ghost" size="sm" onClick={() => openManager()}>
              <History data-icon="inline-start" />
              {t("scheduleEditor.weekAdjustments", { count: weekAdjustmentCount })}
            </Button>
            {reviewCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openManager(weekIssues[0].patchId)}
              >
                <TriangleAlert data-icon="inline-start" />
                {t("scheduleEditor.reviewCount", {
                  count: reviewCount,
                })}
              </Button>
            )}
          </div>
        )}
      <ScheduleDragProvider
        editing={editing}
        enabled={editing && !activePending && !activeManager && !undoPatch}
        selectedWeek={selectedWeek || 1}
        totalWeeks={effective.totalWeeks}
        termStartDate={effective.termStartDate}
        courses={showOriginal ? [] : effective.courses}
        traces={showOriginal ? [] : effective.traces}
        patches={showOriginal ? [] : effective.patches}
        onShiftWeek={shiftWeek}
        onDrop={openAdjustment}
        onSelect={selectAdjustment}
        onTraceClick={openManager}
      >
        {isMobile ? (
          <div
            className={cn(
              mobileFullscreen
                ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                : "-mx-4 -mt-4 -mb-4 flex flex-col md:m-0",
              compactMode && "min-h-0 flex-1 overflow-hidden"
            )}
            style={
              compactMode || mobileFullscreen
                ? undefined
                : {
                    minHeight:
                      "calc(100dvh - 3rem - var(--safe-area-inset-top, env(safe-area-inset-top, 0px)) - var(--mobile-bottom-nav-height, calc(4rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))))",
                  }
            }
          >
            <ScheduleMobile
              courses={courses}
              exams={examsQuery.data}
              periods={periods}
              currentWeekday={currentWeekday}
              currentWeek={currentWeek}
              weekAnchor={weekAnchor}
              selectedWeek={selectedWeek}
              termStartDate={termCalendar?.startDate}
              nowMinutes={nowMinutes}
              compact={compactMode || mobileFullscreen}
              fullscreen={mobileFullscreen}
              onPrevWeek={() => shiftWeek(-1)}
              onNextWeek={() => shiftWeek(1)}
              colorMap={courseColors}
            />
          </div>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <ScheduleTablet
                courses={filteredCourses}
                examBlocks={examBlocks}
                periods={periods}
                currentWeekday={currentWeekday}
                currentWeek={currentWeek}
                weekAnchor={weekAnchor}
                selectedWeek={selectedWeek}
                termStartDate={termCalendar?.startDate}
                nowMinutes={nowMinutes}
                colorMap={courseColors}
              />
            </CardContent>
          </Card>
        )}
      </ScheduleDragProvider>

      <ScheduleAdjustmentDialog
        drop={activePending && !undoPatch ? activePending.drop : null}
        courses={effective.courses}
        periods={periods}
        termStartDate={effective.termStartDate}
        totalWeeks={effective.totalWeeks}
        onClose={() => setPending(null)}
        onSave={saveAdjustment}
      />
      <ScheduleAdjustmentsDialog
        view={adjustmentsView}
        patches={effective.patches}
        issues={effective.issues}
        onClose={() => {
          if (undoPatch) setUndo(null)
          else setManager(null)
        }}
        onConfirm={confirmUndo}
        onRemove={requestUndo}
        onToggle={(id, enabled) => {
          if (enabled) effective.setPatchEnabled(id, true)
          else requestUndo(id, false)
        }}
        onJump={(date) => {
          selectWeek(scheduleWeek(date, effective.termStartDate).week)
          setManager(null)
        }}
        onShowOriginal={() => {
          setShowOriginal(true)
          setManager(null)
        }}
      />

      <FilterDrawer
        open={filterDrawerOpen}
        onOpenChange={setFilterDrawerOpen}
        title={t("schedule.title")}
        description={t("schedule.description")}
      >
        {renderFilterControls("schedule-drawer")}
      </FilterDrawer>
    </div>
  )
}
