import type { ClassPeriod, CurrentWeek, Exam } from "@orahako/academic-sdk"

import { getAcademicClock } from "./academic-time"
import { getExamEndTime, getExamStartTime } from "./exam-utils"
import { buildSectionTimeMap } from "./schedule-utils"

export interface ExamBlock {
  exam: Exam
  /** Weekday (`1` = Monday ... `7` = Sunday). */
  day: number
  /** Starting class period section. */
  start: number
  /** Ending class period section. */
  end: number
}

function mondayOfWeek(
  currentWeek: CurrentWeek | null,
  selectedWeek: number,
  termStartDate?: string
): number | null {
  if (termStartDate) {
    const firstMonday = Date.parse(termStartDate)
    if (Number.isFinite(firstMonday)) {
      return firstMonday + (selectedWeek - 1) * 7 * 86_400_000
    }
  }
  if (!currentWeek) return null
  const anchor = currentWeek.weekStartDate ?? currentWeek.weekDates?.[0]
  const start = Date.parse(anchor ?? currentWeek.date ?? "")
  if (!Number.isFinite(start)) return null
  const weekdayOffset = anchor ? 0 : currentWeek.weekday - 1
  return start + ((selectedWeek - currentWeek.week) * 7 - weekdayOffset) * 86_400_000
}

function mapExamToSections(
  startMin: number,
  endMin: number,
  timeMap: Record<number, [number, number]>
): { start: number; end: number } | null {
  const sections = Object.keys(timeMap)
    .map(Number)
    .sort((a, b) => a - b)
  if (sections.length === 0) return null

  const overlapping = sections.filter((s) => {
    const [ps, pe] = timeMap[s]!
    return ps < endMin && pe > startMin
  })
  if (overlapping.length > 0) {
    return { start: overlapping[0]!, end: overlapping[overlapping.length - 1]! }
  }

  let nearest = sections[0]!
  let nearestDist = Infinity
  for (const s of sections) {
    const [ps, pe] = timeMap[s]!
    const dist = startMin >= pe ? startMin - pe : ps >= endMin ? ps - endMin : 0
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = s
    }
  }
  return { start: nearest, end: nearest }
}

export function computeExamBlocks(
  exams: readonly Exam[],
  periods: readonly ClassPeriod[],
  currentWeek: CurrentWeek | null,
  selectedWeek: number,
  termStartDate?: string
): ExamBlock[] {
  if (selectedWeek <= 0 || (!termStartDate && !currentWeek?.week)) return []
  const monday = mondayOfWeek(currentWeek, selectedWeek, termStartDate)
  if (monday === null) return []

  const timeMap = buildSectionTimeMap(periods)
  const blocks: ExamBlock[] = []
  for (const exam of exams) {
    const date = getExamStartTime(exam)
    if (!date) continue
    const start = getAcademicClock(date)
    const dayDiff = (Date.parse(start.date) - monday) / 86_400_000
    if (dayDiff < 0 || dayDiff > 6) continue
    const end = getExamEndTime(exam)
    if (!end) continue
    const sections = mapExamToSections(start.minutes, getAcademicClock(end).minutes, timeMap)
    if (!sections) continue
    blocks.push({ exam, day: dayDiff + 1, ...sections })
  }
  return blocks
}
