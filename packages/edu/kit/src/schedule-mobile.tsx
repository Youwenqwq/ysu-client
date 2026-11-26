import * as React from "react"
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type {
  AcademicScheduleRules,
  ClassPeriod,
  Course,
  CurrentWeek,
  Exam,
} from "@orahako/academic-sdk"
import type { ScheduleEntry } from "@orahako/sdk"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  cn,
} from "@orahako/ui-primitives"
import { CalendarOff, Layers } from "lucide-react"

import { courseBgClass, type CourseColorMap } from "./course-color"
import { computeExamBlocks, type ExamBlock } from "./exam-blocks"
import { formatExamTime } from "./exam-utils"
import {
  computeOverlayBlocks,
  computeWeekIsoDates,
  type ScheduleOverlayBlock,
} from "./schedule-entries"
import { scheduleDate, scheduleOccurrence } from "./schedule-patches"
import {
  buildSectionTimeMap,
  computeMergedBlocks,
  computeWeekDateLabels,
  isCourseActiveInWeek,
  isCourseCurrent,
  periodEndTime,
  periodStartTime,
  type ScheduleBlock,
} from "./schedule-utils"
import {
  DEFAULT_SCHEDULE_EDITOR_STATE,
  SCHEDULE_DAYS,
  ScheduleCourseAdjustedIndicator,
  ScheduleDayAdjustedIndicator,
  ScheduleDayHandle,
  ScheduleDayLabel,
  ScheduleGridTraces,
  ScheduleOnlineBadge,
  SchedulePatchedLabel,
  computeScheduleGridRows,
  courseHasScheduleTrace,
  type ScheduleEditorState,
  type ScheduleEmptyCellTarget,
  type ScheduleLabels,
} from "./schedule-view-shared"

export interface ScheduleMobileProps {
  courses: readonly Course[]
  exams?: readonly Exam[]
  overlayEntries?: readonly ScheduleEntry[]
  colorMap: CourseColorMap
  periods: readonly ClassPeriod[]
  currentWeekday: number
  currentWeek: CurrentWeek | null
  /** Cached dated anchor for browsing labels, never used for current-day highlights. */
  weekAnchor: CurrentWeek | null
  selectedWeek: number
  termStartDate?: string
  nowMinutes: number
  labels: ScheduleLabels
  editor?: ScheduleEditorState
  /** School timezone and break rows from the provider's timetable slice. */
  scheduleRules?: AcademicScheduleRules
  compact?: boolean
  /** Constrain the schedule to the mobile shell and scroll rows within it. */
  fullscreen?: boolean
  /** Keep the interactive grid visible even when a week has no courses or overlays. */
  showGridWhenEmpty?: boolean
  weekCornerLabel?: (week: number) => string
  onWeekTap?: () => void
  onPrevWeek?: () => void
  onNextWeek?: () => void
  onCourseTap?: (course: Course, week: number) => void
  onEntryTap?: (entry: ScheduleEntry) => void
  onEmptyCellTap?: (cell: ScheduleEmptyCellTarget) => void
}

const SWIPE_DISTANCE_RATIO = 0.25
const SWIPE_VELOCITY_THRESHOLD = 0.35
const SETTLE_DURATION_MS = 240
const SETTLE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"
const CLICK_SUPPRESS_MS = 400

type OverlapState = { day: number; section: number; courses: Course[] } | null

const NO_EXAMS: readonly Exam[] = []
const NO_OVERLAY_ENTRIES: readonly ScheduleEntry[] = []

interface GestureState {
  x: number
  y: number
  time: number
  dx: number
  dragging: boolean
}

export function ScheduleMobile({
  courses,
  exams = NO_EXAMS,
  overlayEntries = NO_OVERLAY_ENTRIES,
  colorMap,
  periods,
  currentWeekday,
  currentWeek,
  weekAnchor,
  selectedWeek,
  termStartDate,
  nowMinutes,
  labels,
  editor = DEFAULT_SCHEDULE_EDITOR_STATE,
  scheduleRules,
  compact = false,
  fullscreen = false,
  showGridWhenEmpty = false,
  weekCornerLabel,
  onWeekTap,
  onPrevWeek,
  onNextWeek,
  onCourseTap,
  onEntryTap,
  onEmptyCellTap,
}: ScheduleMobileProps) {
  const [overlapDrawer, setOverlapDrawer] = useState<OverlapState>(null)
  const [examDrawer, setExamDrawer] = useState<ExamBlock | null>(null)

  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<GestureState | null>(null)
  const animatingRef = useRef(false)
  const pendingTargetRef = useRef<-1 | 0 | 1>(0)
  const expectedWeekRef = useRef<number | null>(null)
  const prevWeekRef = useRef(selectedWeek)
  const lastDragEndRef = useRef(0)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const safeWeek = selectedWeek >= 1 ? selectedWeek : 1
  const panelWeeks = useMemo(() => [safeWeek - 1, safeWeek, safeWeek + 1], [safeWeek])

  useEffect(() => () => clearTimeout(settleTimerRef.current), [])

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const prev = prevWeekRef.current
    prevWeekRef.current = selectedWeek
    const expected = expectedWeekRef.current
    expectedWeekRef.current = null
    const dir = selectedWeek - prev

    const recenter = () => {
      track.style.transition = "none"
      track.style.transform = "translateX(-100%)"
    }

    if (expected !== null || prev < 1 || selectedWeek < 1 || Math.abs(dir) !== 1) {
      recenter()
      return
    }
    track.style.transition = "none"
    track.style.transform = `translateX(${(dir - 1) * 100}%)`
    void track.offsetWidth
    track.style.transition = `transform ${SETTLE_DURATION_MS}ms ${SETTLE_EASING}`
    track.style.transform = "translateX(-100%)"
  }, [selectedWeek])

  const finishSettle = useCallback(() => {
    if (!animatingRef.current) return
    animatingRef.current = false
    clearTimeout(settleTimerRef.current)
    const target = pendingTargetRef.current
    pendingTargetRef.current = 0
    if (target === 1 && onNextWeek) {
      expectedWeekRef.current = safeWeek + 1
      onNextWeek()
    } else if (target === -1 && onPrevWeek) {
      expectedWeekRef.current = safeWeek - 1
      onPrevWeek()
    }
    if (target !== 0) {
      setTimeout(() => {
        if (expectedWeekRef.current !== null) {
          expectedWeekRef.current = null
          const track = trackRef.current
          if (track) {
            track.style.transition = "none"
            track.style.transform = "translateX(-100%)"
          }
        }
      }, 100)
    }
  }, [onNextWeek, onPrevWeek, safeWeek])

  const startSettle = useCallback(
    (target: -1 | 0 | 1) => {
      const track = trackRef.current
      animatingRef.current = true
      pendingTargetRef.current = target
      if (!track) {
        finishSettle()
        return
      }
      track.style.transition = `transform ${SETTLE_DURATION_MS}ms ${SETTLE_EASING}`
      track.style.transform = `translateX(${(-1 - target) * 100}%)`
      settleTimerRef.current = setTimeout(finishSettle, SETTLE_DURATION_MS + 80)
    },
    [finishSettle]
  )

  function handleTouchStart(e: React.TouchEvent) {
    if (editor.isDragging?.() || (editor.editing && !editor.enabled)) return
    if (
      editor.enabled &&
      e.target instanceof Element &&
      e.target.closest("[data-schedule-course], [data-schedule-day]")
    ) {
      gestureRef.current = null
      return
    }
    if (animatingRef.current) finishSettle()
    const touch = e.touches[0]
    if (!touch) return
    gestureRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
      dx: 0,
      dragging: false,
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (editor.isDragging?.() || (editor.editing && !editor.enabled)) {
      gestureRef.current = null
      return
    }
    const g = gestureRef.current
    const track = trackRef.current
    if (!g || !track) return
    const touch = e.touches[0]
    if (!touch) return
    const dx = touch.clientX - g.x
    const dy = touch.clientY - g.y
    if (!g.dragging) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
      if (Math.abs(dy) > Math.abs(dx)) {
        gestureRef.current = null
        return
      }
      g.dragging = true
      track.style.transition = "none"
    }
    const offset = safeWeek <= 1 && dx > 0 ? dx * 0.35 : dx
    g.dx = offset
    track.style.transform = `translateX(calc(-100% + ${offset}px))`
  }

  function handleTouchEnd() {
    if (editor.isDragging?.() || (editor.editing && !editor.enabled)) {
      gestureRef.current = null
      return
    }
    const g = gestureRef.current
    gestureRef.current = null
    if (!g || !g.dragging) return
    lastDragEndRef.current = Date.now()
    const width = viewportRef.current?.clientWidth ?? 0
    const dt = Math.max(Date.now() - g.time, 1)
    const velocity = g.dx / dt
    let target: -1 | 0 | 1 = 0
    if (g.dx < -width * SWIPE_DISTANCE_RATIO || velocity < -SWIPE_VELOCITY_THRESHOLD) {
      target = 1
    } else if (
      safeWeek > 1 &&
      (g.dx > width * SWIPE_DISTANCE_RATIO || velocity > SWIPE_VELOCITY_THRESHOLD)
    ) {
      target = -1
    }
    startSettle(target)
  }

  function handleClickCapture(e: React.SyntheticEvent) {
    if (Date.now() - lastDragEndRef.current < CLICK_SUPPRESS_MS) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  const handleCoursePress = useCallback(
    (course: Course, week: number) => {
      if (editor.editing && !editor.enabled) return
      if (editor.selectCourse?.(course)) return
      const occurrence = scheduleOccurrence(course)
      const sourceWeek = occurrence?.source.week ?? week
      onCourseTap?.(course, sourceWeek)
    },
    [onCourseTap, editor]
  )
  const handleOverlapPress = useCallback((day: number, section: number, list: Course[]) => {
    setOverlapDrawer({ day, section, courses: list })
  }, [])
  const handleExamPress = useCallback((block: ExamBlock) => {
    setExamDrawer(block)
  }, [])

  return (
    <>
      <div
        ref={viewportRef}
        className={cn(
          "flex min-h-0 flex-1 touch-pan-y flex-col select-none",
          fullscreen ? "overflow-x-hidden overflow-y-auto" : "overflow-hidden"
        )}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => {
          gestureRef.current = null
          startSettle(0)
        }}
        onClickCapture={handleClickCapture}
      >
        <div
          ref={trackRef}
          className={cn("flex flex-1 will-change-transform", fullscreen ? "min-h-min" : "min-h-0")}
          style={{ transform: "translateX(-100%)" }}
          onTransitionEnd={(e) => {
            if (e.target === trackRef.current) finishSettle()
          }}
        >
          {panelWeeks.map((week) => (
            <div key={week} className="flex w-full shrink-0 flex-col">
              <WeekGrid
                week={week}
                courses={courses}
                exams={exams}
                overlayEntries={overlayEntries}
                periods={periods}
                currentWeekday={currentWeekday}
                currentWeek={currentWeek}
                weekAnchor={weekAnchor}
                termStartDate={termStartDate}
                nowMinutes={nowMinutes}
                compact={compact}
                showGridWhenEmpty={showGridWhenEmpty}
                weekCornerLabel={weekCornerLabel}
                onWeekTap={onWeekTap}
                colorMap={colorMap}
                labels={labels}
                editor={editor}
                scheduleRules={scheduleRules}
                onCoursePress={handleCoursePress}
                onOverlapPress={handleOverlapPress}
                onExamPress={handleExamPress}
                onEntryPress={onEntryTap}
                onEmptyCellPress={onEmptyCellTap}
              />
            </div>
          ))}
        </div>
      </div>

      <Drawer open={!!examDrawer} onOpenChange={(v) => !v && setExamDrawer(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{examDrawer?.exam.name}</DrawerTitle>
            <DrawerDescription className={examDrawer?.exam.examName ? undefined : "sr-only"}>
              {examDrawer?.exam.examName || examDrawer?.exam.name || ""}
            </DrawerDescription>
          </DrawerHeader>
          {examDrawer && (
            <div className="flex flex-col gap-2 px-4 pb-6 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{labels.examTime}</span>
                <span>{formatExamTime(examDrawer.exam)}</span>
              </div>
              {examDrawer.exam.examLocation && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{labels.examLocation}</span>
                  <span>{examDrawer.exam.examLocation}</span>
                </div>
              )}
              {examDrawer.exam.seatNumber && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{labels.examSeat}</span>
                  <span>{examDrawer.exam.seatNumber}</span>
                </div>
              )}
            </div>
          )}
        </DrawerContent>
      </Drawer>

      <Drawer open={!!overlapDrawer} onOpenChange={(v) => !v && setOverlapDrawer(null)}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>
              {overlapDrawer &&
                labels.overlapDialogTitle({
                  weekday: labels.weekdayNames[overlapDrawer.day - 1] ?? "",
                  section: overlapDrawer.section,
                })}
            </DrawerTitle>
            <DrawerDescription>
              {overlapDrawer
                ? labels.overlapCourses({
                    count: overlapDrawer.courses.length,
                  })
                : ""}
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-2 px-4 pb-6">
            {overlapDrawer?.courses.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur()
                  setOverlapDrawer(null)
                  handleCoursePress(c, safeWeek)
                }}
                className={cn(
                  "flex flex-col gap-1 rounded-lg p-3 text-left transition-opacity active:opacity-60",
                  courseBgClass(colorMap, c)
                )}
              >
                <span className="text-sm font-medium text-foreground">
                  <SchedulePatchedLabel course={c} editor={editor} editorLabels={labels.editor} />
                  {c.name}
                </span>
                {(c.teacher || c.classroom) && (
                  <span className="text-xs text-foreground/70">
                    {[c.teacher, c.classroom].filter(Boolean).join(" · ")}
                  </span>
                )}
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}

interface WeekGridProps {
  week: number
  courses: readonly Course[]
  exams: readonly Exam[]
  overlayEntries: readonly ScheduleEntry[]
  periods: readonly ClassPeriod[]
  currentWeekday: number
  currentWeek: CurrentWeek | null
  weekAnchor: CurrentWeek | null
  termStartDate?: string
  nowMinutes: number
  compact: boolean
  showGridWhenEmpty: boolean
  weekCornerLabel?: (week: number) => string
  onWeekTap?: () => void
  colorMap: CourseColorMap
  labels: ScheduleLabels
  editor: ScheduleEditorState
  scheduleRules?: AcademicScheduleRules
  onCoursePress: (course: Course, week: number) => void
  onOverlapPress: (day: number, section: number, courses: Course[]) => void
  onExamPress: (block: ExamBlock) => void
  onEntryPress?: (entry: ScheduleEntry) => void
  onEmptyCellPress?: (cell: ScheduleEmptyCellTarget) => void
}

function overlayBlockClass(block: ScheduleOverlayBlock): string {
  if (block.entry.category === "exam") {
    return "bg-amber-500/15 ring-1 ring-inset ring-amber-500/50"
  }
  if (block.entry.category === "personal") {
    return "bg-indigo-500/12 ring-1 ring-inset ring-indigo-500/45"
  }
  return "bg-emerald-500/12 ring-1 ring-inset ring-emerald-500/45"
}

function overlayTagClass(block: ScheduleOverlayBlock): string {
  if (block.entry.category === "exam") {
    return "text-amber-600 dark:text-amber-400"
  }
  if (block.entry.category === "personal") {
    return "text-indigo-600 dark:text-indigo-400"
  }
  return "text-emerald-600 dark:text-emerald-400"
}

const WeekGrid = memo(function WeekGrid({
  week,
  courses,
  exams,
  overlayEntries,
  periods,
  currentWeekday,
  currentWeek,
  weekAnchor,
  termStartDate,
  nowMinutes,
  compact,
  showGridWhenEmpty,
  weekCornerLabel,
  onWeekTap,
  colorMap,
  labels,
  editor,
  scheduleRules,
  onCoursePress,
  onOverlapPress,
  onExamPress,
  onEntryPress,
  onEmptyCellPress,
}: WeekGridProps) {
  const weekIsoDates = useMemo(
    () => computeWeekIsoDates(weekAnchor, week, termStartDate ?? editor.termStartDate),
    [weekAnchor, week, termStartDate, editor.termStartDate]
  )
  const dateForDay = (day: number) =>
    editor.termStartDate ? scheduleDate(editor.termStartDate, week, day) : weekIsoDates?.[day - 1]
  const hasTraces =
    editor.editing &&
    editor.traces.some((trace) => SCHEDULE_DAYS.some((day) => dateForDay(day) === trace.date))

  const weekCourses = useMemo(
    () => (week >= 1 ? courses.filter((c) => isCourseActiveInWeek(c, week)) : []),
    [courses, week]
  )
  const examBlocks = useMemo(
    () =>
      computeExamBlocks(exams, periods, weekAnchor, week, termStartDate, scheduleRules?.timeZone),
    [exams, periods, weekAnchor, week, termStartDate, scheduleRules]
  )
  const overlayBlocks = useMemo(
    () => computeOverlayBlocks(overlayEntries, periods, weekAnchor, week, termStartDate),
    [overlayEntries, periods, weekAnchor, week, termStartDate]
  )
  const weekDates = useMemo(
    () => computeWeekDateLabels(weekAnchor, week, termStartDate),
    [weekAnchor, week, termStartDate]
  )

  const isCurrentWeek = currentWeek?.week === week
  const timeMap = useMemo(() => buildSectionTimeMap(periods), [periods])

  const isBlockCurrent = (block: ScheduleBlock): boolean => {
    if (!isCurrentWeek || block.day !== currentWeek?.weekday) return false
    if (block.courses.length !== 1) return false
    const first = block.courses[0]
    return !!first && isCourseCurrent(first, nowMinutes, timeMap)
  }

  const { sectionToRow, totalRows, lunchRow, dinnerRow } = useMemo(
    () => computeScheduleGridRows(periods, scheduleRules),
    [periods, scheduleRules]
  )

  const gridTemplateRows = useMemo(() => {
    const sizes: string[] = ["auto"]
    for (let r = 2; r <= totalRows; r++) {
      if (r === lunchRow || r === dinnerRow) {
        sizes.push(compact ? "0px" : "18px")
      } else {
        sizes.push(compact ? "minmax(36px, 1fr)" : "minmax(52px, 1fr)")
      }
    }
    return sizes.join(" ")
  }, [totalRows, lunchRow, dinnerRow, compact])

  const blocks = useMemo(() => computeMergedBlocks(weekCourses, periods), [weekCourses, periods])

  if (week < 1) {
    return <div className="flex-1" />
  }

  if (
    !showGridWhenEmpty &&
    weekCourses.length === 0 &&
    examBlocks.length === 0 &&
    overlayBlocks.length === 0 &&
    !editor.editing &&
    !hasTraces
  ) {
    return (
      <div className="flex flex-1">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarOff />
            </EmptyMedia>
            <EmptyTitle>{labels.noData}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  function blockStyle(block: { day: number; start: number; end: number }) {
    const startRow = sectionToRow.get(block.start)
    const endRow = sectionToRow.get(block.end)
    if (!startRow || !endRow) return { display: "none" as const }
    return {
      gridRow: `${startRow} / ${endRow + 1}`,
      gridColumn: `${block.day + 1}`,
    }
  }

  return (
    <div
      className="grid w-full flex-1"
      data-schedule-grid={week}
      style={{
        gridTemplateColumns: compact
          ? "minmax(28px, 0.4fr) repeat(7, minmax(0, 1fr))"
          : "minmax(36px, 0.6fr) repeat(7, minmax(0, 1fr))",
        gridTemplateRows,
      }}
    >
      {onWeekTap && week >= 1 ? (
        <button
          type="button"
          onClick={onWeekTap}
          className="@container flex items-center justify-center overflow-hidden border-r border-b border-border px-0.5 text-[10px] font-semibold whitespace-nowrap text-foreground transition-colors active:bg-muted"
          aria-label={weekCornerLabel ? weekCornerLabel(week) : String(week)}
        >
          {weekCornerLabel ? (
            <>
              <span className="hidden @[40px]:inline">{weekCornerLabel(week)}</span>
              <span className="@[40px]:hidden">{week}</span>
            </>
          ) : (
            <span>{week}</span>
          )}
        </button>
      ) : (
        <div className="border-r border-b border-border" />
      )}

      {SCHEDULE_DAYS.map((d, idx) => (
        <div
          key={d}
          className={cn(
            "relative flex flex-col items-center justify-center border-b border-border text-[10px] font-medium",
            compact ? "gap-0 py-0.5" : "gap-0.5 py-1.5",
            idx < 6 && "border-r",
            isCurrentWeek && d === currentWeekday
              ? "bg-primary/5 text-primary"
              : "text-muted-foreground"
          )}
        >
          <ScheduleDayLabel day={d} weekdayShort={labels.weekdayShort} />
          {weekDates[d - 1] && <span className="text-[9px] opacity-70">{weekDates[d - 1]}</span>}
          <ScheduleDayHandle week={week} day={d} editor={editor} editorLabels={labels.editor} />
          <ScheduleDayAdjustedIndicator
            week={week}
            day={d}
            editor={editor}
            editorLabels={labels.editor}
          />
        </div>
      ))}

      {periods.map((p) => {
        const row = sectionToRow.get(p.section)
        if (!row) return null
        return (
          <div
            key={p.section}
            className="flex flex-col items-center justify-center gap-0.5 border-r border-b border-border py-1 text-[9px] leading-tight text-muted-foreground"
            style={{ gridRow: row, gridColumn: 1 }}
          >
            <span className="text-xs font-semibold text-foreground">{p.section}</span>
            {!compact && periodStartTime(p) && <span>{periodStartTime(p)}</span>}
            {!compact && periodEndTime(p) && <span>{periodEndTime(p)}</span>}
          </div>
        )
      })}

      {lunchRow !== null && !compact && (
        <div
          className="flex items-center justify-center border-b border-border bg-muted/40 text-[9px] font-medium text-muted-foreground"
          style={{ gridRow: lunchRow, gridColumn: "1 / -1" }}
        >
          {labels.lunchBreak}
        </div>
      )}

      {dinnerRow !== null && !compact && (
        <div
          className="flex items-center justify-center border-b border-border bg-muted/40 text-[9px] font-medium text-muted-foreground"
          style={{ gridRow: dinnerRow, gridColumn: "1 / -1" }}
        >
          {labels.dinnerBreak}
        </div>
      )}

      {SCHEDULE_DAYS.flatMap((d) =>
        periods.map((p) => {
          const row = sectionToRow.get(p.section)
          if (!row) return null
          const cellDate = dateForDay(d)
          return (
            <div
              key={`cell-${d}-${p.section}`}
              data-schedule-date={cellDate}
              data-schedule-section={p.section}
              onClick={
                onEmptyCellPress && !editor.editing
                  ? () =>
                      onEmptyCellPress({
                        week,
                        day: d,
                        section: p.section,
                        ...(cellDate ? { date: cellDate } : {}),
                      })
                  : undefined
              }
              className={cn(
                "border-b border-border",
                d < 7 && "border-r",
                isCurrentWeek && d === currentWeekday && "bg-primary/5",
                onEmptyCellPress && !editor.editing && "cursor-pointer active:bg-accent/40"
              )}
              style={{ gridRow: row, gridColumn: d + 1 }}
            />
          )
        })
      )}

      {blocks.map((block, idx) => {
        if (block.courses.length === 1) {
          const c = block.courses[0]!
          const occurrenceId = editor.enabled ? scheduleOccurrence(c)?.occurrenceId : undefined
          const isBeingDragged = Boolean(
            occurrenceId && editor.draggingOccurrenceIds?.has(occurrenceId)
          )
          return (
            <button
              key={`block-${idx}`}
              type="button"
              draggable={false}
              data-schedule-course={occurrenceId}
              onClick={(e) => {
                e.currentTarget.blur()
                onCoursePress(c, week)
              }}
              className={cn(
                "relative z-10 m-0.5 flex flex-col gap-0.5 overflow-hidden rounded-md p-1 text-left transition-[opacity,transform] active:opacity-60",
                courseBgClass(colorMap, c),
                editor.editing && courseHasScheduleTrace(c, editor.traces) && "pb-7",
                isBlockCurrent(block) && "ring-1 ring-primary",
                occurrenceId &&
                  "cursor-grab touch-none ring-1 ring-primary/30 active:cursor-grabbing",
                isBeingDragged && "scale-[0.97] opacity-35 ring-2 ring-primary/60"
              )}
              style={blockStyle(block)}
            >
              <span className="line-clamp-4 text-[10.5px] leading-tight font-medium text-foreground">
                <ScheduleOnlineBadge course={c} label={labels.onlineTag} />
                {c.name}
              </span>
              {c.classroom && (
                <span
                  className={cn(
                    "text-[9px] leading-tight text-foreground/70",
                    compact ? "line-clamp-3" : "line-clamp-2"
                  )}
                >
                  {c.classroom}
                </span>
              )}
              {!compact && c.teacher && (
                <span className="line-clamp-1 text-[9px] leading-tight text-foreground/60">
                  {c.teacher}
                </span>
              )}
              <ScheduleCourseAdjustedIndicator
                course={c}
                editor={editor}
                editorLabels={labels.editor}
              />
            </button>
          )
        }
        return (
          <button
            key={`block-${idx}`}
            type="button"
            onClick={(e) => {
              e.currentTarget.blur()
              onOverlapPress(block.day, block.start, block.courses)
            }}
            className={cn(
              "relative z-10 m-0.5 flex flex-col items-center justify-center gap-0.5 rounded-md bg-accent p-1 text-center transition-opacity active:opacity-60",
              editor.editing &&
                block.courses.some((course) => courseHasScheduleTrace(course, editor.traces)) &&
                "pb-7"
            )}
            style={blockStyle(block)}
          >
            <Layers className="size-3 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">{block.courses.length}</span>
            <span className="text-[9px] text-muted-foreground">{labels.overlap}</span>
          </button>
        )
      })}
      <ScheduleGridTraces
        week={week}
        sectionToRow={sectionToRow}
        editor={editor}
        editorLabels={labels.editor}
      />
      {examBlocks.map((block, idx) => (
        <button
          key={`exam-${idx}`}
          type="button"
          onClick={(e) => {
            e.currentTarget.blur()
            onExamPress(block)
          }}
          className="relative z-20 m-0.5 flex flex-col gap-0.5 overflow-hidden rounded-md bg-amber-500/15 p-1 text-left ring-1 ring-amber-500/50 transition-opacity ring-inset active:opacity-60"
          style={blockStyle(block)}
        >
          <span className="line-clamp-1 text-[9px] leading-tight font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">
            {labels.examTag}
          </span>
          <span className="line-clamp-4 text-[10.5px] leading-tight font-medium text-foreground">
            {block.exam.name}
          </span>
          {block.exam.examLocation && (
            <span className="line-clamp-2 text-[9px] leading-tight text-foreground/70">
              {block.exam.examLocation}
            </span>
          )}
        </button>
      ))}
      {overlayBlocks.map((block) => {
        const tag =
          block.entry.badge ||
          (block.entry.category === "exam"
            ? labels.examTag
            : block.entry.deliveryMode === "online"
              ? labels.onlineTag
              : labels.personalTag)
        return (
          <button
            key={`overlay-${block.entry.id}`}
            type="button"
            data-schedule-entry={block.entry.id}
            onClick={(e) => {
              e.currentTarget.blur()
              onEntryPress?.(block.entry)
            }}
            className={cn(
              "relative z-20 m-0.5 flex flex-col gap-0.5 overflow-hidden rounded-md p-1 text-left transition-opacity active:opacity-60",
              overlayBlockClass(block)
            )}
            style={blockStyle(block)}
          >
            {tag && (
              <span
                className={cn(
                  "line-clamp-1 text-[9px] leading-tight font-semibold tracking-wide",
                  overlayTagClass(block)
                )}
              >
                {tag}
              </span>
            )}
            <span className="line-clamp-4 text-[10.5px] leading-tight font-medium text-foreground">
              {block.entry.title}
            </span>
            {block.entry.location && (
              <span className="line-clamp-2 text-[9px] leading-tight text-foreground/70">
                {block.entry.location}
              </span>
            )}
            {!compact && block.timeLabel && (
              <span className="line-clamp-1 text-[8.5px] leading-tight text-foreground/60 tabular-nums">
                {block.timeLabel}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
})
