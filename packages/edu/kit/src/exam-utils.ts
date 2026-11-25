import type { Exam } from "@orahako/academic-sdk"

import { DEFAULT_ACADEMIC_TIME_ZONE, parseAcademicDateTime } from "./time"

function dateFromTimestamp(value: number | undefined): Date | null {
  if (value === undefined) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatTimeFromDateTime(value: string | undefined): string | null {
  if (!value) return null
  const match = value.match(/T(\d{2}:\d{2})/)
  return match?.[1] ?? null
}

export function getExamStartTime(
  exam: Exam,
  timeZone: string = DEFAULT_ACADEMIC_TIME_ZONE
): Date | null {
  return dateFromTimestamp(exam.startTimestamp) ?? parseAcademicDateTime(exam.startAt, timeZone)
}

export function getExamEndTime(
  exam: Exam,
  timeZone: string = DEFAULT_ACADEMIC_TIME_ZONE
): Date | null {
  return (
    dateFromTimestamp(exam.endTimestamp) ??
    parseAcademicDateTime(exam.endAt, timeZone) ??
    getExamStartTime(exam, timeZone)
  )
}

export function isExamCompleted(
  exam: Exam,
  now: Date = new Date(),
  timeZone: string = DEFAULT_ACADEMIC_TIME_ZONE
): boolean {
  const end = getExamEndTime(exam, timeZone)
  if (end) return end < now
  if (exam.status === "completed") return true
  if (exam.status === "upcoming") return false
  return false
}

export function compareExamStartTime(
  a: Exam,
  b: Exam,
  timeZone: string = DEFAULT_ACADEMIC_TIME_ZONE
): number {
  const aStart = getExamStartTime(a, timeZone)?.getTime() ?? Number.POSITIVE_INFINITY
  const bStart = getExamStartTime(b, timeZone)?.getTime() ?? Number.POSITIVE_INFINITY
  if (aStart !== bStart) return aStart - bStart

  const aEnd = getExamEndTime(a, timeZone)?.getTime() ?? Number.POSITIVE_INFINITY
  const bEnd = getExamEndTime(b, timeZone)?.getTime() ?? Number.POSITIVE_INFINITY
  return aEnd - bEnd
}

export function formatExamTime(exam: Exam): string {
  if (exam.timeText) return exam.timeText

  const start = formatTimeFromDateTime(exam.startAt)
  const end = formatTimeFromDateTime(exam.endAt)
  if (start && end) return `${start}-${end}`
  return start ?? end ?? ""
}
