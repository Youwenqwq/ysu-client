import { useMemo, useState } from "react"
import type { ClassPeriod, Course, CurrentWeek } from "@orahako/academic-sdk"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  cn,
} from "@orahako/ui-primitives"
import { CalendarOff, Layers } from "lucide-react"

import { courseBgClass, type CourseColorMap } from "./course-color"
import type { ExamBlock } from "./exam-blocks"
import { formatExamTime } from "./exam-utils"
import { scheduleDate, scheduleOccurrence } from "./schedule-patches"
import {
  buildSectionTimeMap,
  computeMergedBlocks,
  computeWeekDateLabels,
  courseEndSection,
  courseStartSection,
  isCourseCurrent,
  periodEndTime,
  periodStartTime,
  type ScheduleBlock,
} from "./schedule-utils"
import {
  DEFAULT_SCHEDULE_EDITOR_STATE,
  SCHEDULE_DAYS,
  ScheduleDayHandle,
  ScheduleDayLabel,
  ScheduleGridTraces,
  SchedulePatchedLabel,
  computeScheduleGridRows,
  courseHasScheduleTrace,
  type ScheduleEditorState,
  type ScheduleLabels,
} from "./schedule-view-shared"

export interface ScheduleTabletProps {
  courses: readonly Course[]
  colorMap: CourseColorMap
  examBlocks?: readonly ExamBlock[]
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
  onCourseTap?: (course: Course, week: number) => void
}

const NO_EXAM_BLOCKS: readonly ExamBlock[] = []

export function ScheduleTablet({
  courses,
  colorMap,
  examBlocks = NO_EXAM_BLOCKS,
  periods,
  currentWeekday,
  currentWeek,
  weekAnchor,
  selectedWeek,
  termStartDate,
  nowMinutes,
  labels,
  editor = DEFAULT_SCHEDULE_EDITOR_STATE,
  onCourseTap,
}: ScheduleTabletProps) {
  const dateForDay = (day: number) =>
    editor.termStartDate ? scheduleDate(editor.termStartDate, selectedWeek, day) : undefined
  const hasTraces = editor.traces.some((trace) =>
    SCHEDULE_DAYS.some((day) => dateForDay(day) === trace.date)
  )
  const [overlapDialog, setOverlapDialog] = useState<{
    day: number
    section: number
    courses: Course[]
  } | null>(null)
  const [examDialog, setExamDialog] = useState<ExamBlock | null>(null)

  const isCurrentWeek = currentWeek?.week === selectedWeek
  const timeMap = useMemo(() => buildSectionTimeMap(periods), [periods])
  const weekDates = useMemo(
    () => computeWeekDateLabels(weekAnchor, selectedWeek, termStartDate),
    [weekAnchor, selectedWeek, termStartDate]
  )

  const isBlockCurrent = (block: ScheduleBlock): boolean => {
    if (!isCurrentWeek || block.day !== currentWeek?.weekday) return false
    if (block.courses.length !== 1) return false
    const first = block.courses[0]
    return !!first && isCourseCurrent(first, nowMinutes, timeMap)
  }

  const { sectionToRow, totalRows, lunchRow, dinnerRow } = useMemo(
    () => computeScheduleGridRows(periods),
    [periods]
  )

  const gridTemplateRows = useMemo(() => {
    const sizes: string[] = ["auto"]
    for (let r = 2; r <= totalRows; r++) {
      if (r === lunchRow || r === dinnerRow) {
        sizes.push("18px")
      } else {
        sizes.push("minmax(52px, 1fr)")
      }
    }
    return sizes.join(" ")
  }, [totalRows, lunchRow, dinnerRow])

  const mergedBlocks = useMemo(() => computeMergedBlocks(courses, periods), [courses, periods])

  function openCourse(course: Course) {
    if (editor.editing && !editor.enabled) return
    if (editor.selectCourse?.(course)) return
    const occurrence = scheduleOccurrence(course)
    const sourceCourse = occurrence?.source.course ?? course
    const sourceWeek = occurrence?.source.week ?? selectedWeek
    onCourseTap?.(sourceCourse, sourceWeek)
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

  if (courses.length === 0 && examBlocks.length === 0 && !editor.editing && !hasTraces) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarOff />
          </EmptyMedia>
          <EmptyTitle>{labels.noData}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <>
      <div className="overflow-auto">
        <div
          className="grid w-full"
          data-schedule-grid={selectedWeek}
          style={{
            gridTemplateColumns: "minmax(48px, 0.4fr) repeat(7, minmax(0, 1fr))",
            gridTemplateRows,
          }}
        >
          <div className="border-r border-b border-border" />

          {SCHEDULE_DAYS.map((d, idx) => (
            <div
              key={d}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 border-b border-border py-1.5 text-[10px] font-medium",
                idx < 6 && "border-r",
                isCurrentWeek && d === currentWeekday
                  ? "bg-primary/5 text-primary"
                  : "text-muted-foreground"
              )}
            >
              <ScheduleDayLabel
                week={selectedWeek}
                day={d}
                weekdayShort={labels.weekdayShort}
                editor={editor}
                editorLabels={labels.editor}
              />
              {weekDates[d - 1] && (
                <span className="text-[9px] opacity-70">{weekDates[d - 1]}</span>
              )}
              <ScheduleDayHandle
                week={selectedWeek}
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
                {periodStartTime(p) && <span>{periodStartTime(p)}</span>}
                {periodEndTime(p) && <span>{periodEndTime(p)}</span>}
              </div>
            )
          })}

          {lunchRow !== null && (
            <div
              className="flex items-center justify-center border-b border-border bg-muted/40 text-[9px] font-medium text-muted-foreground"
              style={{ gridRow: lunchRow, gridColumn: "1 / -1" }}
            >
              {labels.lunchBreak}
            </div>
          )}

          {dinnerRow !== null && (
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

          {mergedBlocks.map((block, idx) => {
            if (block.courses.length === 1) {
              const c = block.courses[0]!
              return (
                <button
                  key={`block-${idx}`}
                  type="button"
                  data-schedule-course={
                    editor.enabled ? scheduleOccurrence(c)?.occurrenceId : undefined
                  }
                  className={cn(
                    "relative z-10 m-0.5 flex flex-col gap-0.5 overflow-hidden rounded-md p-1.5 text-left transition-opacity active:opacity-60",
                    courseBgClass(colorMap, c),
                    courseHasScheduleTrace(c, editor.traces) && "pb-7",
                    isBlockCurrent(block) && "ring-1 ring-primary"
                  )}
                  style={blockStyle(block)}
                  onClick={() => openCourse(c)}
                >
                  <span className="line-clamp-3 text-[11px] leading-tight font-medium text-foreground">
                    <SchedulePatchedLabel course={c} editor={editor} editorLabels={labels.editor} />
                    {c.name}
                  </span>
                  {c.classroom && (
                    <span className="line-clamp-1 text-[9px] leading-tight text-foreground/70">
                      {c.classroom}
                    </span>
                  )}
                  {c.teacher && (
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
                className={cn(
                  "relative z-10 m-0.5 flex flex-col items-center justify-center gap-0.5 rounded-md bg-accent p-1 text-center transition-opacity active:opacity-60",
                  block.courses.some((course) => courseHasScheduleTrace(course, editor.traces)) &&
                    "pb-7"
                )}
                style={blockStyle(block)}
                onClick={() =>
                  setOverlapDialog({
                    day: block.day,
                    section: block.start,
                    courses: block.courses,
                  })
                }
              >
                <Layers className="size-3 text-muted-foreground" />
                <span className="text-xs font-semibold text-foreground">
                  {block.courses.length}
                </span>
                <span className="text-[9px] text-muted-foreground">{labels.overlap}</span>
              </button>
            )
          })}
          <ScheduleGridTraces
            week={selectedWeek}
            sectionToRow={sectionToRow}
            editor={editor}
            editorLabels={labels.editor}
          />
          {examBlocks.map((block, idx) => (
            <button
              key={`exam-${idx}`}
              type="button"
              className="relative z-20 m-0.5 flex flex-col gap-0.5 overflow-hidden rounded-md border border-amber-500/50 bg-amber-500/15 p-1.5 text-left transition-opacity active:opacity-60"
              style={blockStyle(block)}
              onClick={(e) => {
                e.currentTarget.blur()
                setExamDialog(block)
              }}
            >
              <span className="line-clamp-1 text-[9px] font-semibold tracking-wide text-amber-600 uppercase dark:text-amber-400">
                {labels.examTag}
              </span>
              <span className="line-clamp-3 text-[11px] leading-tight font-medium text-foreground">
                {block.exam.name}
              </span>
              {block.exam.examLocation && (
                <span className="line-clamp-1 text-[9px] leading-tight text-foreground/70">
                  {block.exam.examLocation}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <Dialog open={!!examDialog} onOpenChange={(v) => !v && setExamDialog(null)}>
        <DialogContent closeLabel={labels.closeDialog}>
          <DialogHeader>
            <DialogTitle>{examDialog?.exam.name}</DialogTitle>
            <DialogDescription className={examDialog?.exam.examName ? undefined : "sr-only"}>
              {examDialog?.exam.examName || examDialog?.exam.name || ""}
            </DialogDescription>
          </DialogHeader>
          {examDialog && (
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{labels.examTime}</span>
                <span>{formatExamTime(examDialog.exam)}</span>
              </div>
              {examDialog.exam.examLocation && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{labels.examLocation}</span>
                  <span>{examDialog.exam.examLocation}</span>
                </div>
              )}
              {examDialog.exam.seatNumber && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{labels.examSeat}</span>
                  <span>{examDialog.exam.seatNumber}</span>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!overlapDialog} onOpenChange={(v) => !v && setOverlapDialog(null)}>
        <DialogContent closeLabel={labels.closeDialog}>
          <DialogHeader>
            <DialogTitle>
              {overlapDialog &&
                labels.overlapDialogTitle({
                  weekday: labels.weekdayNames[overlapDialog.day - 1] ?? "",
                  section: overlapDialog.section,
                })}
            </DialogTitle>
            <DialogDescription>
              {overlapDialog
                ? labels.overlapCourses({
                    count: overlapDialog.courses.length,
                  })
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {overlapDialog?.courses.map((c, i) => {
              const metaItems = [
                labels.weeks && c.weeks ? `${labels.weeks}: ${c.weeks}` : c.weeks,
                labels.sections
                  ? `${labels.sections}: ${courseStartSection(c)}-${courseEndSection(c)}`
                  : `${courseStartSection(c)}-${courseEndSection(c)}`,
              ].filter(Boolean)
              return (
                <Card
                  key={i}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      setOverlapDialog(null)
                      openCourse(c)
                    }
                  }}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                  onClick={() => {
                    setOverlapDialog(null)
                    openCourse(c)
                  }}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      <SchedulePatchedLabel
                        course={c}
                        editor={editor}
                        editorLabels={labels.editor}
                      />
                      {c.name}
                    </CardTitle>
                    <CardDescription>
                      {[c.teacher, c.classroom].filter(Boolean).join(" · ")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">
                    {metaItems.join(" · ")}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
