import type { Course, CurrentWeek, Exam, Grade, StudentInfo } from "@orahako/plugin-sdk/academic"
import { ProviderError, ProviderErrorCode } from "@orahako/plugin-sdk/provider-errors"

export type RawRow = Record<string, unknown>

export interface ZmuTermContext {
  code: string
  semester: string
  week: number
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim()
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(text(value))
  return text(value) !== "" && Number.isFinite(parsed) ? parsed : undefined
}

export function semesterCode(semester: string): string {
  const value = semester.trim()
  if (/^\d{4}0[12]$/.test(value)) return value
  const match = /^(\d{4})-(\d{4})-([12])$/.exec(value)
  if (!match || Number(match[2]) !== Number(match[1]) + 1) {
    throw new ProviderError(
      ProviderErrorCode.BACKEND_PROTOCOL_ERROR,
      `Unsupported ZMU semester: ${semester}`
    )
  }
  return `${match[1]}0${match[3]}`
}

export function semesterName(code: string): string {
  const match = /^(\d{4})0([12])$/.exec(code)
  if (!match) {
    throw new ProviderError(
      ProviderErrorCode.BACKEND_PROTOCOL_ERROR,
      `Unsupported ZMU semester code: ${code}`
    )
  }
  return `${match[1]}-${Number(match[1]) + 1}-${match[2]}`
}

function decodeHtml(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (entity, token: string) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
      }
      const lower = token.toLowerCase()
      if (named[lower]) return named[lower]
      const code = lower.startsWith("#x")
        ? Number.parseInt(lower.slice(2), 16)
        : lower.startsWith("#")
          ? Number.parseInt(lower.slice(1), 10)
          : Number.NaN
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity
    }
  )
}

function htmlText(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function profileLabel(html: string, label: string): string | undefined {
  const match = new RegExp(
    `<td\\b[^>]*>\\s*${escapeRegExp(label)}[：:]\\s*</td>\\s*<td\\b[^>]*>([\\s\\S]*?)</td>`,
    "i"
  ).exec(html)
  return match ? htmlText(match[1]!) || undefined : undefined
}

function selectedOption(html: string, id: string): string | undefined {
  const select = new RegExp(
    `<select\\b[^>]*id=['"]${escapeRegExp(id)}['"][^>]*>([\\s\\S]*?)</select>`,
    "i"
  ).exec(html)
  if (!select) return undefined
  for (const option of select[1]!.matchAll(/<option\b[^>]*>[\s\S]*?<\/option>/gi)) {
    if (/\bselected(?:\s|=|>)/i.test(option[0])) return htmlText(option[0]) || undefined
  }
  return undefined
}

function inputValue(html: string, id: string): string | undefined {
  const input = new RegExp(`<input\\b[^>]*id=['"]${escapeRegExp(id)}['"][^>]*>`, "i").exec(
    html
  )?.[0]
  if (!input) return undefined
  return decodeHtml(/\bvalue=['"]([\s\S]*?)['"]/i.exec(input)?.[1] ?? "") || undefined
}

function dateValue(value: string | undefined): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value ?? "")
  return match ? `${match[1]}-${match[2]}-${match[3]}` : value
}

export function parseStudentInfo(html: string): StudentInfo {
  const studentId = profileLabel(html, "学号")
  const name = profileLabel(html, "姓名")
  if (!studentId || !name) {
    throw new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, "ZMU profile fields missing")
  }
  return {
    studentId,
    name,
    namePinyin: inputValue(html, "py"),
    gender: selectedOption(html, "xbdm"),
    nation: selectedOption(html, "mzdm"),
    department: profileLabel(html, "院系名称"),
    major: profileLabel(html, "专业"),
    className: profileLabel(html, "班级"),
    gradeLevel: profileLabel(html, "所在年级"),
    enrollmentDate: dateValue(inputValue(html, "rxrq")),
    expectedGraduation: dateValue(profileLabel(html, "毕业日期")),
    educationLevel: profileLabel(html, "培养层次"),
    campus: profileLabel(html, "所在校区"),
    studentStatus: profileLabel(html, "学生状态"),
    studyDuration: profileLabel(html, "学制"),
    foreignLanguage: profileLabel(html, "外语语种"),
  }
}

export function parseTermContext(html: string): ZmuTermContext {
  let selected: { code: string; semester: string } | undefined
  for (const option of html.matchAll(/<option\b[^>]*>[\s\S]*?<\/option>/gi)) {
    if (!/\bselected(?:\s|=|>)/i.test(option[0])) continue
    const code = /\bvalue=['"](\d{6})['"]/i.exec(option[0])?.[1]
    if (code) selected = { code, semester: semesterName(code) }
  }
  const weekExpression = /var\s+val\s*=\s*([^;]+);/i.exec(html)?.[1] ?? ""
  const week = Number(
    [...weekExpression.matchAll(/['"](\d*)['"]/g)].map((match) => match[1]).find((value) => value)
  )
  if (!selected || !Number.isInteger(week) || week < 1) {
    throw new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, "ZMU term anchors missing")
  }
  return { ...selected, week }
}

export function discoverCurrentSemester(html: string): string {
  const code = /getXsgrbkList\.action\?xnxqdm=(\d{6})/i.exec(html)?.[1]
  if (!code) {
    throw new ProviderError(
      ProviderErrorCode.BACKEND_PROTOCOL_ERROR,
      "ZMU current semester missing"
    )
  }
  return code
}

function rowsOf(payload: unknown, label: string): unknown[] {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("rows" in payload) ||
    !Array.isArray(payload.rows)
  ) {
    throw new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, `ZMU ${label} rows missing`)
  }
  return payload.rows
}

function gradePassed(score: string, numericScore: number | undefined): boolean {
  if (numericScore !== undefined) return numericScore >= 60
  return /^(合格|及格|通过|优秀|良好|中等)$/.test(score)
}

export function mapGrades(payload: unknown): Grade[] {
  const rows = rowsOf(payload, "grade")
  return rows
    .filter((row): row is RawRow => !!row && typeof row === "object")
    .map((row) => {
      const score = text(row.zcj)
      const numericScore = finiteNumber(row.zcj)
      const credit = finiteNumber(row.xf)
      const gradePoint = finiteNumber(row.cjjd)
      const courseType = text(row.kcdlmc)
      return {
        courseName: text(row.kcmc),
        courseCode: text(row.kcbh) || undefined,
        classId: text(row.rwdm) || undefined,
        score: score || undefined,
        numericScore,
        gradeLevel: score && numericScore === undefined ? score : undefined,
        gradePoint: text(row.cjjd) || undefined,
        numericGradePoint: gradePoint,
        credit: text(row.xf) || undefined,
        numericCredit: credit,
        hours: text(row.zxs) || undefined,
        semester: text(row.xnxqmc) || undefined,
        courseType: courseType || undefined,
        courseCategory: text(row.kcflmc) || undefined,
        examType: text(row.ksxzmc) || undefined,
        studyMode: text(row.xdfsmc) || undefined,
        isMajor: courseType.includes("专业"),
        isRetake: text(row.cjbzmc) || undefined,
        gradeLevelType: text(row.cjfsmc) || undefined,
        department: text(row.kkbmmc) || undefined,
        isPass: gradePassed(score, numericScore),
        isValid: text(row.isactive) !== "0",
        specialReason: text(row.bz) || undefined,
        isDegreeCourse: false,
        metadata: row,
      }
    })
}

function sectionsOf(row: RawRow): number[] {
  const sections = text(row.jcdm2)
    .split(",")
    .map(Number)
    .filter((section) => Number.isInteger(section) && section > 0)
  if (sections.length > 0) return sections
  const compact = text(row.jcdm)
  return (
    compact
      .match(/\d{2}/g)
      ?.map(Number)
      .filter((section) => section > 0) ?? []
  )
}

export function mapSchedule(payload: unknown): Course[] {
  if (!Array.isArray(payload)) {
    throw new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, "ZMU schedule rows missing")
  }
  const merged = new Map<string, Course>()
  for (const value of payload.flat()) {
    if (!value || typeof value !== "object") continue
    const row = value as RawRow
    const name = text(row.kcmc)
    if (!name) continue
    const weekDay = Number(text(row.xq))
    const sections = sectionsOf(row)
    const week = Number(text(row.zc))
    if (
      !Number.isInteger(weekDay) ||
      weekDay < 1 ||
      weekDay > 7 ||
      sections.length === 0 ||
      !Number.isInteger(week) ||
      week < 1
    ) {
      throw new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, "Invalid ZMU course slot")
    }
    const candidate: Course = {
      name,
      code: text(row.kcbh) || text(row.kcdm) || undefined,
      teacher: text(row.teaxms) || undefined,
      classroom: text(row.jxcdmc) || undefined,
      weekDay,
      startSection: sections[0]!,
      endSection: sections.at(-1)!,
      classId: text(row.jxbdm) || undefined,
      classType: text(row.jxhjmc) || undefined,
      raw: row,
    }
    const key = JSON.stringify([
      candidate.name,
      candidate.code,
      candidate.teacher,
      candidate.classroom,
      candidate.weekDay,
      candidate.startSection,
      candidate.endSection,
      candidate.classId,
      candidate.classType,
    ])
    const existing = merged.get(key)
    if (existing) {
      existing.weekList = [...new Set([...(existing.weekList ?? []), week])].sort((a, b) => a - b)
      existing.weeks = existing.weekList.join(",")
    } else {
      candidate.weekList = [week]
      candidate.weeks = String(week)
      merged.set(key, candidate)
    }
  }
  return [...merged.values()]
}

function examTimestamp(dateTime: string): number | undefined {
  const timestamp = Date.parse(`${dateTime}+08:00`)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

export function mapExams(payload: unknown, now = Date.now()): Exam[] {
  const rows = rowsOf(payload, "exam")
  return rows
    .filter((row): row is RawRow => !!row && typeof row === "object")
    .map((row) => {
      const date = text(row.ksrq)
      const [start = "", end = ""] = text(row.kssj).split("--")
      const startAt = date && start ? `${date}T${start}` : undefined
      const endAt = date && end ? `${date}T${end}` : undefined
      const startTimestamp = startAt ? examTimestamp(startAt) : undefined
      const endTimestamp = endAt ? examTimestamp(endAt) : undefined
      const campus = text(row.xqmc)
      const room = text(row.kscdmc)
      return {
        name: text(row.kcmc),
        examName: text(row.kslbmc) || undefined,
        startAt,
        endAt,
        startTimestamp,
        endTimestamp,
        status: endTimestamp ? (endTimestamp < now ? "completed" : "upcoming") : "unknown",
        timeText: [date, text(row.kssj)].filter(Boolean).join(" ") || undefined,
        examLocation: [campus, room].filter(Boolean).join(" ") || undefined,
        seatNumber: text(row.zwh) || undefined,
        raw: row,
      }
    })
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function currentWeekFromContext(context: ZmuTermContext, date: string): CurrentWeek {
  const weekday = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
  const weekStartDate = addDays(date, 1 - weekday)
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStartDate, index))
  return {
    week: context.week,
    weekday,
    semester: context.semester,
    date,
    weekStartDate,
    weekEndDate: weekDates[6],
    weekDates,
    raw: { code: context.code },
  }
}
