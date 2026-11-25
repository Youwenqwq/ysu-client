/**
 * Display formatting and timezone parsing for normalized academic-system
 * timestamps (`YYYY-MM-DDTHH:mm:ss`).
 */

/** Explicit neutral fallback; schools must pass their own IANA timezone. */
export const DEFAULT_ACADEMIC_TIME_ZONE = "UTC"

const LOCAL_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/

const zoneFormatters = new Map<string, Intl.DateTimeFormat>()

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
    zoneFormatters.set(timeZone, formatter)
  }
  return formatter
}

interface ZoneParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function zoneParts(instant: Date, timeZone: string): ZoneParts {
  const parts: ZoneParts = {
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0,
  }
  for (const part of zoneFormatter(timeZone).formatToParts(instant)) {
    switch (part.type) {
      case "year":
        parts.year = Number(part.value)
        break
      case "month":
        parts.month = Number(part.value)
        break
      case "day":
        parts.day = Number(part.value)
        break
      case "hour":
        parts.hour = Number(part.value)
        break
      case "minute":
        parts.minute = Number(part.value)
        break
      case "second":
        parts.second = Number(part.value)
        break
    }
  }
  return parts
}

function offsetMilliseconds(instant: Date, timeZone: string): number {
  const parts = zoneParts(instant, timeZone)
  const instantSeconds = Math.floor(instant.getTime() / 1000) * 1000
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    instantSeconds
  )
}

/**
 * Interprets an offset-less wall-clock timestamp in `timeZone`. Explicit `Z`
 * or numeric offsets are already absolute instants and pass through untouched.
 */
export function parseAcademicDateTime(
  value?: string,
  timeZone: string = DEFAULT_ACADEMIC_TIME_ZONE
): Date | null {
  if (!value) return null
  const normalized = value.trim().replace(" ", "T")
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) {
    const explicit = new Date(normalized)
    return Number.isNaN(explicit.getTime()) ? null : explicit
  }

  const match = LOCAL_DATETIME_RE.exec(normalized)
  if (!match) return null
  const [, year, month, day, hour = "0", minute = "0", second = "0", fraction = "0"] = match
  const wallTime = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(fraction.padEnd(3, "0"))
  )
  if (Number.isNaN(wallTime)) return null

  let date = new Date(wallTime - offsetMilliseconds(new Date(wallTime), timeZone))
  // Re-check at the resolved instant so a DST boundary uses the right offset.
  const corrected = new Date(wallTime - offsetMilliseconds(date, timeZone))
  if (corrected.getTime() !== date.getTime()) {
    date = corrected
  }
  return Number.isNaN(date.getTime()) ? null : date
}

/** `"2026-03-01T08:00:00"` -> `"2026-03-01 08:00"`; empty input returns `""`. */
export function formatLocalDateTime(value?: string): string {
  return value ? value.slice(0, 16).replace("T", " ") : ""
}

/** Joins start and end local datetimes with `" ~ "`, or returns whichever is present. */
export function formatTimeRange(start?: string, end?: string): string {
  const s = formatLocalDateTime(start)
  const e = formatLocalDateTime(end)
  if (s && e) return `${s} ~ ${e}`
  return s || e
}
