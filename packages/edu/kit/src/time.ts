/**
 * Display formatting and timezone parsing for normalized academic-system
 * timestamps (`YYYY-MM-DDTHH:mm:ss`).
 */

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

/** Offset-less university timestamps are Shanghai wall time (`+08:00`), not device-local time. */
export function parseAcademicDateTime(value?: string): Date | null {
  if (!value) return null
  const normalized = value.trim().replace(" ", "T")
  const explicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
  const date = new Date(
    explicitZone
      ? normalized
      : `${normalized.length === 10 ? `${normalized}T00:00:00` : normalized}+08:00`
  )
  return Number.isNaN(date.getTime()) ? null : date
}
