"use client"

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { CalendarOff, Layers } from "lucide-react"
import { useTranslation } from "@/lib/i18n/use-translation"
import { cn } from "@/lib/utils"
import type { ClassPeriod, Course, CurrentWeek, Exam } from "@/providers/types"
import { computeExamBlocks, type ExamBlock } from "./exam-blocks"
import { formatExamTime } from "@/lib/academic/exam-utils"
import {
  computeMergedBlocks,
  buildSectionTimeMap,
  computeWeekDateLabels,
  isCourseActiveInWeek,
  isCourseCurrent,
  periodEndTime,
  periodStartTime,
  type ScheduleBlock,
} from "./schedule-utils"
import { courseBgClass, type CourseColorMap } from "./course-color"
import { ActivityModal } from "./activity-modal"
import { SigninModal } from "./signin-modal"
import { scheduleDate } from "@/lib/academic/schedule-patches"
import {
  ScheduleDayHandle,
  ScheduleDayLabel,
  ScheduleGridTraces,
  SchedulePatchedLabel,
  courseHasScheduleTrace,
  scheduleOccurrence,
  useScheduleEditor,
} from "./schedule-drag"

interface Props {
  /** 全学期课程（组件内按面板周过滤，用于跟手滑动时预渲染相邻周） */
  courses: Course[]
  /** 全学期考试（组件内按面板周计算网格块）；只读课表可不传 */
  exams?: Exam[]
  colorMap: CourseColorMap
  periods: ClassPeriod[]
  currentWeekday: number
  currentWeek: CurrentWeek | null
  /** Cached dated anchor for browsing labels, never used for current-day highlights. */
  weekAnchor: CurrentWeek | null
  selectedWeek: number
  termStartDate?: string
  nowMinutes: number
  compact?: boolean
  /** Constrain the schedule to the mobile shell and scroll rows within it. */
  fullscreen?: boolean
  onPrevWeek?: () => void
  onNextWeek?: () => void
  /** 提供时替代默认的活动弹窗，用于只读课表（如全校课表） */
  onCourseTap?: (course: Course) => void
}

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const
const LUNCH_AFTER = 4
const DINNER_AFTER = 8
/** 松手时位移超过屏宽该比例即翻页 */
const SWIPE_DISTANCE_RATIO = 0.25
/** 或末端速度超过该值（px/ms）即翻页 */
const SWIPE_VELOCITY_THRESHOLD = 0.35
/** 翻页/回弹动画时长与缓动 */
const SETTLE_DURATION_MS = 240
const SETTLE_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"
/** 拖拽松手后短时间内抑制 click（未发生原生滚动时浏览器仍会派发，避免误触课程块） */
const CLICK_SUPPRESS_MS = 400

type OverlapState = { day: number; section: number; courses: Course[] } | null

/** 未传 exams 时的稳定空引用，避免破坏 WeekGrid 的 memo */
const NO_EXAMS: Exam[] = []

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
  colorMap,
  periods,
  currentWeekday,
  currentWeek,
  weekAnchor,
  selectedWeek,
  termStartDate,
  nowMinutes,
  compact = false,
  fullscreen = false,
  onPrevWeek,
  onNextWeek,
  onCourseTap,
}: Props) {
  const { t } = useTranslation()
  const editor = useScheduleEditor()
  const [overlapDrawer, setOverlapDrawer] = useState<OverlapState>(null)
  const [examDrawer, setExamDrawer] = useState<ExamBlock | null>(null)
  const [activityCourse, setActivityCourse] = useState<Course | null>(null)
  const [activityWeek, setActivityWeek] = useState(selectedWeek)
  const [activityOpen, setActivityOpen] = useState(false)
  const [signinActivityId, setSigninActivityId] = useState<string | null>(null)
  const [signinType, setSigninType] = useState(1)
  const [signinOpen, setSigninOpen] = useState(false)

  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<GestureState | null>(null)
  const animatingRef = useRef(false)
  const pendingTargetRef = useRef<-1 | 0 | 1>(0)
  const expectedWeekRef = useRef<number | null>(null)
  const prevWeekRef = useRef(selectedWeek)
  const lastDragEndRef = useRef(0)
  const settleTimerRef = useRef<number | undefined>(undefined)

  // selectedWeek 为 0 表示周次尚未解析（等待当前周数据），先按第 1 周渲染
  const safeWeek = selectedWeek >= 1 ? selectedWeek : 1
  const panelWeeks = useMemo(() => [safeWeek - 1, safeWeek, safeWeek + 1], [safeWeek])

  useEffect(() => () => window.clearTimeout(settleTimerRef.current), [])

  // 周次变化后在绘制前归位 track：手势提交静默归位，外部 ±1 衔接滑动动画
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
      // 手势翻页提交（track 已停在目标面板，归位无视觉变化）、初始解析（0 → N）、
      // 跨周跳转（周数输入）：均不做位移动画
      recenter()
      return
    }
    // 页头按钮等外部 ±1：旧周此时位于 (1-dir) 号面板，从那里滑入中间
    track.style.transition = "none"
    track.style.transform = `translateX(${(dir - 1) * 100}%)`
    void track.offsetWidth // 强制 reflow，让无过渡的瞬移先生效
    track.style.transition = `transform ${SETTLE_DURATION_MS}ms ${SETTLE_EASING}`
    track.style.transform = "translateX(-100%)"
  }, [selectedWeek])

  const finishSettle = useCallback(() => {
    if (!animatingRef.current) return
    animatingRef.current = false
    window.clearTimeout(settleTimerRef.current)
    const target = pendingTargetRef.current
    pendingTargetRef.current = 0
    if (target === 1 && onNextWeek) {
      expectedWeekRef.current = safeWeek + 1
      onNextWeek()
    } else if (target === -1 && onPrevWeek) {
      expectedWeekRef.current = safeWeek - 1
      onPrevWeek()
    }
    // 兜底：回调未能改变周次（如边界钳制）时静默归位，避免 track 停在错误面板
    if (target !== 0) {
      window.setTimeout(() => {
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
      // transitionend 的兜底（动画被打断/不可见时不触发）
      settleTimerRef.current = window.setTimeout(finishSettle, SETTLE_DURATION_MS + 80)
    },
    [finishSettle]
  )

  function handleTouchStart(e: React.TouchEvent) {
    if (editor.isDragging() || (editor.editing && !editor.enabled)) return
    // 打断进行中的归位动画：立即结算（提交或回弹），新手势从稳定状态开始
    if (animatingRef.current) finishSettle()
    const t = e.touches[0]
    if (!t) return
    gestureRef.current = { x: t.clientX, y: t.clientY, time: Date.now(), dx: 0, dragging: false }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (editor.isDragging() || (editor.editing && !editor.enabled)) {
      gestureRef.current = null
      return
    }
    const g = gestureRef.current
    const track = trackRef.current
    if (!g || !track) return
    const t = e.touches[0]
    if (!t) return
    const dx = t.clientX - g.x
    const dy = t.clientY - g.y
    if (!g.dragging) {
      // 方向锁：偏纵向则让位给页面滚动（touch-action: pan-y），位移过小视为抖动
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
      if (Math.abs(dy) > Math.abs(dx)) {
        gestureRef.current = null
        return
      }
      g.dragging = true
      track.style.transition = "none"
    }
    // 第 1 周继续右滑：阻尼拖拽，松手回弹
    const offset = safeWeek <= 1 && dx > 0 ? dx * 0.35 : dx
    g.dx = offset
    track.style.transform = `translateX(calc(-100% + ${offset}px))`
  }

  function handleTouchEnd() {
    if (editor.isDragging() || (editor.editing && !editor.enabled)) {
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
      if (editor.selectCourse(course)) return
      const occurrence = scheduleOccurrence(course)
      const sourceCourse = occurrence?.source.course ?? course
      if (onCourseTap) {
        onCourseTap(sourceCourse)
        return
      }
      setActivityCourse(sourceCourse)
      setActivityWeek(occurrence?.source.week ?? week)
      setActivityOpen(true)
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
          editor.editing || fullscreen ? "overflow-x-hidden overflow-y-auto" : "overflow-hidden"
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
          className={cn(
            "flex flex-1 will-change-transform",
            editor.editing || fullscreen ? "min-h-min" : "min-h-0"
          )}
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
                periods={periods}
                currentWeekday={currentWeekday}
                currentWeek={currentWeek}
                weekAnchor={weekAnchor}
                termStartDate={termStartDate}
                nowMinutes={nowMinutes}
                compact={compact}
                colorMap={colorMap}
                onCoursePress={handleCoursePress}
                onOverlapPress={handleOverlapPress}
                onExamPress={handleExamPress}
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
                <span className="text-muted-foreground">{t("schedule.examTime")}</span>
                <span>{formatExamTime(examDrawer.exam)}</span>
              </div>
              {examDrawer.exam.examLocation && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("schedule.examLocation")}</span>
                  <span>{examDrawer.exam.examLocation}</span>
                </div>
              )}
              {examDrawer.exam.seatNumber && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("schedule.examSeat")}</span>
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
                t("schedule.overlapDialogTitle", {
                  weekday: t(`dashboard.weekdayNames.${overlapDrawer.day}`),
                  section: overlapDrawer.section,
                })}
            </DrawerTitle>
            <DrawerDescription>
              {overlapDrawer
                ? t("schedule.overlapCourses", {
                    count: overlapDrawer.courses.length,
                  })
                : ""}
            </DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-2 px-4 pb-6">
            {overlapDrawer?.courses.map((c, i) => {
              return (
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
                    <SchedulePatchedLabel course={c} />
                    {c.name}
                  </span>
                  {(c.teacher || c.classroom) && (
                    <span className="text-xs text-foreground/70">
                      {[c.teacher, c.classroom].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </DrawerContent>
      </Drawer>

      <ActivityModal
        course={activityCourse}
        week={activityWeek}
        open={activityOpen}
        onOpenChange={setActivityOpen}
        onSigninActivity={(id, type) => {
          setSigninActivityId(id)
          setSigninType(type)
          setSigninOpen(true)
        }}
      />

      <SigninModal
        activityId={signinActivityId}
        signinType={signinType}
        open={signinOpen}
        onOpenChange={setSigninOpen}
      />
    </>
  )
}

interface WeekGridProps {
  week: number
  courses: Course[]
  exams: Exam[]
  periods: ClassPeriod[]
  currentWeekday: number
  currentWeek: CurrentWeek | null
  weekAnchor: CurrentWeek | null
  termStartDate?: string
  nowMinutes: number
  compact: boolean
  colorMap: CourseColorMap
  onCoursePress: (course: Course, week: number) => void
  onOverlapPress: (day: number, section: number, courses: Course[]) => void
  onExamPress: (block: ExamBlock) => void
}

/** 单周课表网格。memo 化后滑动窗口重排时相邻周面板无需重渲染。 */
const WeekGrid = memo(function WeekGrid({
  week,
  courses,
  exams,
  periods,
  currentWeekday,
  currentWeek,
  weekAnchor,
  termStartDate,
  nowMinutes,
  compact,
  colorMap,
  onCoursePress,
  onOverlapPress,
  onExamPress,
}: WeekGridProps) {
  const { t } = useTranslation()
  const editor = useScheduleEditor()
  const dateForDay = (day: number) =>
    editor.termStartDate ? scheduleDate(editor.termStartDate, week, day) : undefined
  const hasTraces = editor.traces.some((trace) =>
    DAYS.some((day) => dateForDay(day) === trace.date)
  )

  const weekCourses = useMemo(
    () => (week >= 1 ? courses.filter((c) => isCourseActiveInWeek(c, week)) : []),
    [courses, week]
  )
  const examBlocks = useMemo(
    () => computeExamBlocks(exams, periods, weekAnchor, week, termStartDate),
    [exams, periods, weekAnchor, week, termStartDate]
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
    return isCourseCurrent(block.courses[0], nowMinutes, timeMap)
  }

  const { sectionToRow, totalRows, lunchRow, dinnerRow } = useMemo(() => {
    const map = new Map<number, number>()
    let row = 2
    let lunch: number | null = null
    let dinner: number | null = null
    const sectionSet = new Set(periods.map((p) => p.section))
    for (const p of periods) {
      if (p.section === LUNCH_AFTER + 1 && sectionSet.has(LUNCH_AFTER)) {
        lunch = row
        row++
      }
      if (p.section === DINNER_AFTER + 1 && sectionSet.has(DINNER_AFTER)) {
        dinner = row
        row++
      }
      map.set(p.section, row)
      row++
    }
    return {
      sectionToRow: map,
      totalRows: row - 1,
      lunchRow: lunch,
      dinnerRow: dinner,
    }
  }, [periods])

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

  // 第 0 周等无效面板：占位但不渲染内容（该面板不可达，仅窗口对齐用）
  if (week < 1) {
    return <div className="flex-1" />
  }

  // 课程为空但本周有考试时仍渲染网格，避免考试块被空态吞掉
  if (weekCourses.length === 0 && examBlocks.length === 0 && !editor.editing && !hasTraces) {
    return (
      <div className="flex flex-1">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarOff />
            </EmptyMedia>
            <EmptyTitle>{t("schedule.noData")}</EmptyTitle>
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
      <div className="border-r border-b border-border" />

      {DAYS.map((d, idx) => (
        <div
          key={d}
          className={cn(
            "flex flex-col items-center justify-center border-b border-border text-[10px] font-medium",
            compact ? "gap-0 py-0.5" : "gap-0.5 py-1.5",
            idx < 6 && "border-r",
            isCurrentWeek && d === currentWeekday
              ? "bg-primary/5 text-primary"
              : "text-muted-foreground"
          )}
        >
          <ScheduleDayLabel week={week} day={d} />
          {weekDates[d - 1] && <span className="text-[9px] opacity-70">{weekDates[d - 1]}</span>}
          <ScheduleDayHandle week={week} day={d} />
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
          {t("schedule.lunchBreak")}
        </div>
      )}

      {dinnerRow !== null && !compact && (
        <div
          className="flex items-center justify-center border-b border-border bg-muted/40 text-[9px] font-medium text-muted-foreground"
          style={{ gridRow: dinnerRow, gridColumn: "1 / -1" }}
        >
          {t("schedule.dinnerBreak")}
        </div>
      )}

      {DAYS.flatMap((d) =>
        periods.map((p) => {
          const row = sectionToRow.get(p.section)
          if (!row) return null
          return (
            <div
              key={`cell-${d}-${p.section}`}
              data-schedule-date={dateForDay(d)}
              data-schedule-section={p.section}
              className={cn(
                "border-b border-border",
                d < 7 && "border-r",
                isCurrentWeek && d === currentWeekday && "bg-primary/5"
              )}
              style={{ gridRow: row, gridColumn: d + 1 }}
            />
          )
        })
      )}

      {blocks.map((block, idx) => {
        if (block.courses.length === 1) {
          const c = block.courses[0]
          return (
            <button
              key={`block-${idx}`}
              type="button"
              data-schedule-course={
                editor.enabled ? scheduleOccurrence(c)?.occurrenceId : undefined
              }
              onClick={(e) => {
                e.currentTarget.blur()
                onCoursePress(c, week)
              }}
              className={cn(
                "relative z-10 m-0.5 flex flex-col gap-0.5 overflow-hidden rounded-md p-1 text-left transition-opacity active:opacity-60",
                courseBgClass(colorMap, c),
                courseHasScheduleTrace(c, editor.traces) && "pb-7",
                isBlockCurrent(block) && "ring-1 ring-primary"
              )}
              style={blockStyle(block)}
            >
              <span className="line-clamp-4 text-[10.5px] leading-tight font-medium text-foreground">
                <SchedulePatchedLabel course={c} />
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
              block.courses.some((course) => courseHasScheduleTrace(course, editor.traces)) &&
                "pb-7"
            )}
            style={blockStyle(block)}
          >
            <Layers className="size-3 text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">{block.courses.length}</span>
            <span className="text-[9px] text-muted-foreground">{t("schedule.overlap")}</span>
          </button>
        )
      })}
      <ScheduleGridTraces week={week} sectionToRow={sectionToRow} />
      {examBlocks.map((block, idx) => (
        <button
          key={`exam-${idx}`}
          type="button"
          onClick={(e) => {
            e.currentTarget.blur()
            onExamPress(block)
          }}
          className="relative z-20 m-0.5 flex flex-col gap-0.5 overflow-hidden rounded-md border border-amber-500/50 bg-amber-500/15 p-1 text-left transition-opacity active:opacity-60"
          style={blockStyle(block)}
        >
          <span className="line-clamp-1 text-[9px] font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">
            {t("schedule.examTag")}
          </span>
          <span className="line-clamp-3 text-[10.5px] leading-tight font-medium text-foreground">
            {block.exam.name}
          </span>
          {block.exam.examLocation && !compact && (
            <span className="line-clamp-1 text-[9px] leading-tight text-foreground/70">
              {block.exam.examLocation}
            </span>
          )}
        </button>
      ))}
    </div>
  )
})
