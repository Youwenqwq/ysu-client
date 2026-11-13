"use client"

import { createContext, useContext } from "react"
import { GripVertical, History } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { useTranslation } from "@/lib/i18n/use-translation"
import { cn } from "@/lib/utils"
import {
  scheduleDate,
  scheduleOccurrence,
  scheduleWeek,
  type ScheduleOccurrence,
  type SchedulePatch,
  type ScheduleTrace,
} from "@/lib/academic/schedule-patches"
import type { Course } from "@orahako/plugin-sdk/academic"

export interface ScheduleEditorValue {
  enabled: boolean
  editing: boolean
  adjustedDates: ReadonlySet<string>
  adjustedCourses: ReadonlySet<string>
  coursePatchIds: ReadonlySet<string>
  termStartDate: string
  traces: ScheduleTrace[]
  courses: ScheduleOccurrence[]
  isDragging: () => boolean
  selectCourse: (course: Course) => boolean
  selectDay: (date: string) => void
  onTraceClick: (id: string) => void
}

export const ScheduleEditorContext = createContext<ScheduleEditorValue>({
  enabled: false,
  editing: false,
  adjustedDates: new Set(),
  adjustedCourses: new Set(),
  coursePatchIds: new Set(),
  termStartDate: "",
  traces: [],
  courses: [],
  isDragging: () => false,
  selectCourse: () => false,
  selectDay: () => {},
  onTraceClick: () => {},
})

export function useScheduleEditor() {
  return useContext(ScheduleEditorContext)
}

export function courseHasScheduleTrace(course: Course, traces: ScheduleTrace[]): boolean {
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

function ScheduleAdjustmentBadge({ kind }: { kind: SchedulePatch["kind"] }) {
  const { t } = useTranslation()
  const label = t(kind === "day" ? "scheduleEditor.dayAdjusted" : "scheduleEditor.courseAdjusted")
  return (
    <Badge
      variant="secondary"
      className="mr-0.5 h-[11px] rounded-[3px] px-0.5 py-0 align-baseline text-[8px] leading-none"
      title={label}
      aria-label={label}
    >
      {t("scheduleEditor.adjustmentMark")}
    </Badge>
  )
}

export function ScheduleDayLabel({ week, day }: { week: number; day: number }) {
  const editor = useScheduleEditor()
  const { t } = useTranslation()
  const adjusted =
    editor.termStartDate && editor.adjustedDates.has(scheduleDate(editor.termStartDate, week, day))
  return (
    <span className="inline-flex items-center text-[11px]">
      {adjusted && <ScheduleAdjustmentBadge kind="day" />}
      {t(`dashboard.weekdayShort.${day}`)}
    </span>
  )
}

export function ScheduleDayHandle({ week, day }: { week: number; day: number }) {
  const editor = useScheduleEditor()
  const { t } = useTranslation()
  if (!editor.editing || !editor.termStartDate) return null
  const date = scheduleDate(editor.termStartDate, week, day)
  return (
    <button
      type="button"
      data-schedule-day={date}
      disabled={!editor.enabled}
      className="flex min-h-7 w-full touch-none items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring enabled:hover:bg-accent disabled:opacity-50"
      aria-label={t("scheduleEditor.dragDay", { date })}
      onClick={() => editor.selectDay(date)}
    >
      <GripVertical className="size-3.5" />
    </button>
  )
}

export function SchedulePatchedLabel({ course }: { course: Course }) {
  const editor = useScheduleEditor()
  const occurrence = scheduleOccurrence(course)
  if (!occurrence || !editor.adjustedCourses.has(occurrence.occurrenceId)) return null
  return <ScheduleAdjustmentBadge kind="course" />
}

export function ScheduleGridTraces({
  week,
  sectionToRow,
}: {
  week: number
  sectionToRow: Map<number, number>
}) {
  const editor = useScheduleEditor()
  const { t } = useTranslation()
  if (!editor.termStartDate) return null
  const groups = new Map<
    string,
    { day: number; start: number; end: number; traces: ScheduleTrace[] }
  >()
  for (const trace of editor.traces) {
    const position = scheduleWeek(trace.date, editor.termStartDate)
    if (position.week !== week) continue
    const start = sectionToRow.get(trace.startSection),
      end = sectionToRow.get(trace.endSection)
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
        {group.traces.map((trace, index) => (
          <button
            key={`${trace.patchId}:${index}`}
            type="button"
            disabled={editor.editing && !editor.enabled}
            className={cn(
              "pointer-events-auto flex flex-col rounded-sm bg-background/95 px-0.5 py-0.5 text-left text-[9px] leading-tight text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              occupied && "border border-dashed border-muted-foreground/60"
            )}
            title={`${trace.name} · ${t(`scheduleEditor.${trace.kind}`)} · ${trace.targetDate}`}
            onClick={() => editor.onTraceClick(trace.patchId)}
          >
            {!occupied && (
              <span className="line-clamp-3 font-medium">
                {editor.coursePatchIds.has(trace.patchId) && (
                  <ScheduleAdjustmentBadge kind="course" />
                )}
                {trace.name}
              </span>
            )}
            <span className="flex items-start gap-0.5">
              <History className="mt-px size-2.5 shrink-0" />
              <span>
                {trace.kind === "moved"
                  ? t("scheduleEditor.movedTo", {
                      date: occupied ? trace.targetDate.slice(5) : trace.targetDate,
                    })
                  : t(`scheduleEditor.${trace.kind}`)}
              </span>
            </span>
          </button>
        ))}
      </div>
    )
  })
}
