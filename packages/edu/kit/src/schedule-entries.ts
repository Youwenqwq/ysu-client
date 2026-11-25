import type { ClassPeriod, CurrentWeek } from "@orahako/academic-sdk"
import type { ScheduleEntry } from "@orahako/sdk"

import { scheduleDate } from "./schedule-patches"
import { buildSectionTimeMap } from "./schedule-utils"

export interface ScheduleOverlayBlock {
  readonly entry: ScheduleEntry
  /** Weekday (`1` = Monday ... `7` = Sunday). */
  readonly day: number
  /** Starting grid section. */
  readonly start: number
  /** Ending grid section. */
  readonly end: number
  /** Formatted clock time range (e.g. `19:30-21:00`) when the entry carries clock minutes. */
  readonly timeLabel?: string
}

/** Default hourly timeline used when no school provider supplies class periods. */
export const DEFAULT_STANDALONE_PERIODS: readonly ClassPeriod[] = [
  {
    section: 1,
    name: "1",
    startTime: "08:00",
    endTime: "08:50",
    startMinute: 480,
    endMinute: 530,
    isInUse: true,
  },
  {
    section: 2,
    name: "2",
    startTime: "09:00",
    endTime: "09:50",
    startMinute: 540,
    endMinute: 590,
    isInUse: true,
  },
  {
    section: 3,
    name: "3",
    startTime: "10:00",
    endTime: "10:50",
    startMinute: 600,
    endMinute: 650,
    isInUse: true,
  },
  {
    section: 4,
    name: "4",
    startTime: "11:00",
    endTime: "11:50",
    startMinute: 660,
    endMinute: 710,
    isInUse: true,
  },
  {
    section: 5,
    name: "5",
    startTime: "14:00",
    endTime: "14:50",
    startMinute: 840,
    endMinute: 890,
    isInUse: true,
  },
  {
    section: 6,
    name: "6",
    startTime: "15:00",
    endTime: "15:50",
    startMinute: 900,
    endMinute: 950,
    isInUse: true,
  },
  {
    section: 7,
    name: "7",
    startTime: "16:00",
    endTime: "16:50",
    startMinute: 960,
    endMinute: 1010,
    isInUse: true,
  },
  {
    section: 8,
    name: "8",
    startTime: "17:00",
    endTime: "17:50",
    startMinute: 1020,
    endMinute: 1070,
    isInUse: true,
  },
  {
    section: 9,
    name: "9",
    startTime: "19:00",
    endTime: "19:50",
    startMinute: 1140,
    endMinute: 1190,
    isInUse: true,
  },
  {
    section: 10,
    name: "10",
    startTime: "20:00",
    endTime: "20:50",
    startMinute: 1200,
    endMinute: 1250,
    isInUse: true,
  },
  {
    section: 11,
    name: "11",
    startTime: "21:00",
    endTime: "21:50",
    startMinute: 1260,
    endMinute: 1310,
    isInUse: true,
  },
]

export function formatClockMinute(minute: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minute)))
  const hours = Math.floor(clamped / 60)
  const mins = clamped % 60
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`
}

export function formatMinuteRange(startMinute: number, endMinute: number): string {
  return `${formatClockMinute(startMinute)}-${formatClockMinute(endMinute)}`
}

export function mapTimeRangeToSections(
  startMinute: number,
  endMinute: number,
  timeMap: Record<number, [number, number]>
): { readonly start: number; readonly end: number } | null {
  const sections = Object.keys(timeMap)
    .map(Number)
    .sort((a, b) => a - b)
  if (sections.length === 0) return null

  const overlapping = sections.filter((section) => {
    const [ps, pe] = timeMap[section]!
    return ps < endMinute && pe > startMinute
  })
  if (overlapping.length > 0) {
    return { start: overlapping[0]!, end: overlapping[overlapping.length - 1]! }
  }

  let nearest = sections[0]!
  let nearestDist = Infinity
  for (const section of sections) {
    const [ps, pe] = timeMap[section]!
    const dist = startMinute >= pe ? startMinute - pe : ps >= endMinute ? ps - endMinute : 0
    if (dist < nearestDist) {
      nearestDist = dist
      nearest = section
    }
  }
  return { start: nearest, end: nearest }
}

function resolveWeekMondayDate(
  currentWeek: CurrentWeek | null,
  selectedWeek: number,
  termStartDate?: string
): string | null {
  if (termStartDate && selectedWeek >= 1) {
    const date = scheduleDate(termStartDate, selectedWeek, 1)
    if (date) return date
  }
  if (!currentWeek || selectedWeek < 1) return null
  const anchor = currentWeek.weekStartDate ?? currentWeek.weekDates?.[0]
  if (anchor) {
    const deltaDays = (selectedWeek - currentWeek.week) * 7
    const shifted = addDaysIso(anchor, deltaDays)
    if (shifted) return shifted
  }
  if (currentWeek.date) {
    const deltaDays = (selectedWeek - currentWeek.week) * 7 - (currentWeek.weekday - 1)
    return addDaysIso(currentWeek.date, deltaDays)
  }
  return null
}

function addDaysIso(isoDate: string, deltaDays: number): string | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(isoDate)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day, 12)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null
  }
  date.setDate(date.getDate() + deltaDays)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function computeWeekIsoDates(
  weekAnchor: CurrentWeek | null,
  selectedWeek: number,
  termStartDate?: string
): readonly string[] | null {
  const monday = resolveWeekMondayDate(weekAnchor, selectedWeek, termStartDate)
  if (!monday) return null
  const dates: string[] = []
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDaysIso(monday, offset)
    if (!date) return null
    dates.push(date)
  }
  return dates
}

export function isScheduleEntryActiveOnDate(
  entry: ScheduleEntry,
  date: string,
  weekday: number,
  academicWeek?: number
): boolean {
  if (entry.date) {
    return entry.date === date
  }
  if (entry.weekDay !== weekday) return false
  if (entry.weekList && entry.weekList.length > 0) {
    return academicWeek !== undefined && entry.weekList.includes(academicWeek)
  }
  return true
}

export function computeOverlayBlocks(
  entries: readonly ScheduleEntry[],
  periods: readonly ClassPeriod[],
  weekAnchor: CurrentWeek | null,
  selectedWeek: number,
  termStartDate?: string
): ScheduleOverlayBlock[] {
  if (entries.length === 0 || selectedWeek < 1) return []
  const weekDates = computeWeekIsoDates(weekAnchor, selectedWeek, termStartDate)
  const timeMap = buildSectionTimeMap(periods)
  const blocks: ScheduleOverlayBlock[] = []

  for (const entry of entries) {
    let day: number | null = null
    if (entry.date) {
      if (!weekDates) continue
      const idx = weekDates.indexOf(entry.date)
      if (idx < 0) continue
      day = idx + 1
    } else {
      if (entry.weekDay < 1 || entry.weekDay > 7) continue
      if (entry.weekList && entry.weekList.length > 0 && !entry.weekList.includes(selectedWeek)) {
        continue
      }
      day = entry.weekDay
    }

    const mapped = entry.sections
      ? { start: entry.sections.startSection, end: entry.sections.endSection }
      : entry.time
        ? mapTimeRangeToSections(entry.time.startMinute, entry.time.endMinute, timeMap)
        : null
    if (!mapped) continue

    blocks.push({
      entry,
      day,
      start: mapped.start,
      end: mapped.end,
      ...(entry.time
        ? { timeLabel: formatMinuteRange(entry.time.startMinute, entry.time.endMinute) }
        : {}),
    })
  }

  return blocks
}
