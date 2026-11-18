import type { ClassPeriod, Course } from "@orahako/academic-sdk"
import { Badge, cn } from "@orahako/ui-primitives"
import { GripVertical, History } from "lucide-react"

import {
  scheduleDate,
  scheduleOccurrence,
  scheduleWeek,
  type ScheduleOccurrence,
  type SchedulePatch,
  type ScheduleTrace,
} from "./schedule-patches"

export const SCHEDULE_DAYS = [1, 2, 3, 4, 5, 6, 7] as const
export const SCHEDULE_LUNCH_AFTER = 4
export const SCHEDULE_DINNER_AFTER = 8

export type WeekdayTuple = readonly [string, string, string, string, string, string, string]

export interface ScheduleEditorLabels {
  adjustmentMark: string
  dayAdjusted: string
  courseAdjusted: string
  dragDay: (date: string) => string
  traceKind: Record<ScheduleTrace["kind"], string>
  movedTo: (date: string) => string
}

export interface ScheduleLabels {
  weekdayShort: WeekdayTuple
  weekdayNames: WeekdayTuple
  noData: string
  lunchBreak: string
  dinnerBreak: string
  overlap: string
  overlapDialogTitle: (params: { weekday: string; section: number }) => string
  overlapCourses: (params: { count: number }) => string
  weeks?: string
  sections?: string
  examTag: string
  examTime: string
  examLocation: string
  examSeat: string
  closeDialog?: string
  editor?: ScheduleEditorLabels
}

export interface ScheduleEditorState {
  enabled: boolean
  editing: boolean
  adjustedDates: ReadonlySet<string>
  adjustedCourses: ReadonlySet<string>
  coursePatchIds: ReadonlySet<string>
  termStartDate: string
  traces: readonly ScheduleTrace[]
  courses: readonly ScheduleOccurrence[]
  isDragging?: () => boolean
  selectCourse?: (course: Course) => boolean
  selectDay?: (date: string) => void
  onTraceClick?: (id: string) => void
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>()
const EMPTY_TRACES: readonly ScheduleTrace[] = []
const EMPTY_OCCURRENCES: readonly ScheduleOccurrence[] = []

export const DEFAULT_SCHEDULE_EDITOR_STATE: ScheduleEditorState = {
  enabled: false,
  editing: false,
  adjustedDates: EMPTY_SET,
  adjustedCourses: EMPTY_SET,
  coursePatchIds: EMPTY_SET,
  termStartDate: "",
  traces: EMPTY_TRACES,
  courses: EMPTY_OCCURRENCES,
}

export function courseHasScheduleTrace(course: Course, traces: readonly ScheduleTrace[]): boolean {
  const occurrence = scheduleOccurrence(course)
  return (
    !!occurrence &&
    traces.some(
      (trace) =>
        trace.date === occurrence.date &&
        trace.startSection <= course.endSection &&
        trace.endSection >= course.startSection
    )
  )
}

export function computeScheduleGridRows(periods: readonly ClassPeriod[]) {
  const sectionToRow = new Map<number, number>()
  let row = 2
  let lunchRow: number | null = null
  let dinnerRow: number | null = null
  const sectionSet = new Set(periods.map((p) => p.section))
  for (const p of periods) {
    if (p.section === SCHEDULE_LUNCH_AFTER + 1 && sectionSet.has(SCHEDULE_LUNCH_AFTER)) {
      lunchRow = row
      row++
    }
    if (p.section === SCHEDULE_DINNER_AFTER + 1 && sectionSet.has(SCHEDULE_DINNER_AFTER)) {
      dinnerRow = row
      row++
    }
    sectionToRow.set(p.section, row)
    row++
  }
  return {
    sectionToRow,
    totalRows: row - 1,
    lunchRow,
    dinnerRow,
  }
}

export function ScheduleAdjustmentBadge({
  kind,
  editorLabels,
}: {
  kind: SchedulePatch["kind"]
  editorLabels?: ScheduleEditorLabels
}) {
  if (!editorLabels) return null
  const label = kind === "day" ? editorLabels.dayAdjusted : editorLabels.courseAdjusted
  return (
    <Badge
      variant="secondary"
      className="mr-0.5 h-[11px] rounded-[3px] px-0.5 py-0 align-baseline text-[8px] leading-none"
      title={label}
      aria-label={label}
    >
      {editorLabels.adjustmentMark}
    </Badge>
  )
}

export function ScheduleDayLabel({
  week,
  day,
  weekdayShort,
  editor,
  editorLabels,
}: {
  week: number
  day: (typeof SCHEDULE_DAYS)[number]
  weekdayShort: WeekdayTuple
  editor: ScheduleEditorState
  editorLabels?: ScheduleEditorLabels
}) {
  const adjusted =
    Boolean(editor.termStartDate) &&
    editor.adjustedDates.has(scheduleDate(editor.termStartDate, week, day))
  return (
    <span className="inline-flex items-center text-[11px]">
      {adjusted && <ScheduleAdjustmentBadge kind="day" editorLabels={editorLabels} />}
      {weekdayShort[day - 1]}
    </span>
  )
}

export function ScheduleDayHandle({
  week,
  day,
  editor,
  editorLabels,
}: {
  week: number
  day: (typeof SCHEDULE_DAYS)[number]
  editor: ScheduleEditorState
  editorLabels?: ScheduleEditorLabels
}) {
  if (!editor.editing || !editor.termStartDate) return null
  const date = scheduleDate(editor.termStartDate, week, day)
  return (
    <button
      type="button"
      data-schedule-day={date}
      disabled={!editor.enabled}
      className="flex min-h-7 w-full touch-none items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring enabled:hover:bg-accent disabled:opacity-50"
      aria-label={editorLabels ? editorLabels.dragDay(date) : date}
      onClick={() => editor.selectDay?.(date)}
    >
      <GripVertical className="size-3.5" />
    </button>
  )
}

export function SchedulePatchedLabel({
  course,
  editor,
  editorLabels,
}: {
  course: Course
  editor: ScheduleEditorState
  editorLabels?: ScheduleEditorLabels
}) {
  const occurrence = scheduleOccurrence(course)
  if (!occurrence || !editor.adjustedCourses.has(occurrence.occurrenceId)) return null
  return <ScheduleAdjustmentBadge kind="course" editorLabels={editorLabels} />
}

export function ScheduleGridTraces({
  week,
  sectionToRow,
  editor,
  editorLabels,
}: {
  week: number
  sectionToRow: Map<number, number>
  editor: ScheduleEditorState
  editorLabels?: ScheduleEditorLabels
}) {
  if (!editor.termStartDate || editor.traces.length === 0) return null
  const groups = new Map<
    string,
    { day: number; start: number; end: number; traces: ScheduleTrace[] }
  >()
  for (const trace of editor.traces) {
    const position = scheduleWeek(trace.date, editor.termStartDate)
    if (position.week !== week) continue
    const start = sectionToRow.get(trace.startSection)
    const end = sectionToRow.get(trace.endSection)
    if (!start || !end) continue
    const key = `${position.weekday}:${start}:${end}`
    const group = groups.get(key)
    if (group) group.traces.push(trace)
    else groups.set(key, { day: position.weekday, start, end, traces: [trace] })
  }
  return Array.from(groups.entries()).map(([key, group]) => {
    const occupied = editor.courses.some((course) =>
      group.traces.some(
        (trace) =>
          course.date === trace.date &&
          course.startSection <= trace.endSection &&
          course.endSection >= trace.startSection
      )
    )
    return (
      <div
        key={key}
        className={cn(
          "pointer-events-none relative z-30 m-0.5 flex flex-col gap-0.5 rounded-md",
          occupied
            ? "justify-end"
            : "justify-center border border-dashed border-muted-foreground/60"
        )}
        style={{ gridColumn: group.day + 1, gridRow: `${group.start} / ${group.end + 1}` }}
      >
        {group.traces.map((trace, index) => {
          const kindText = editorLabels?.traceKind[trace.kind] ?? trace.kind
          const statusText =
            trace.kind === "moved" && editorLabels
              ? editorLabels.movedTo(occupied ? trace.targetDate.slice(5) : trace.targetDate)
              : kindText
          return (
            <button
              key={`${trace.patchId}:${index}`}
              type="button"
              disabled={editor.editing && !editor.enabled}
              className={cn(
                "pointer-events-auto flex flex-col rounded-sm bg-background/95 px-0.5 py-0.5 text-left text-[9px] leading-tight text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                occupied && "border border-dashed border-muted-foreground/60"
              )}
              title={`${trace.name} · ${kindText} · ${trace.targetDate}`}
              onClick={() => editor.onTraceClick?.(trace.patchId)}
            >
              {!occupied && (
                <span className="line-clamp-3 font-medium">
                  {editor.coursePatchIds.has(trace.patchId) && (
                    <ScheduleAdjustmentBadge kind="course" editorLabels={editorLabels} />
                  )}
                  {trace.name}
                </span>
              )}
              <span className="flex items-start gap-0.5">
                <History className="mt-px size-2.5 shrink-0" />
                <span>{statusText}</span>
              </span>
            </button>
          )
        })}
      </div>
    )
  })
}
