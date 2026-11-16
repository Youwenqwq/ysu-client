/**
 * 教务系时间串（YYYY-MM-DDTHH:mm:ss，协议层归一后的 ISO 本地时间）的展示格式化。
 */

/** "2026-03-01T08:00:00" → "2026-03-01 08:00"；空值回退空串。 */
export function formatLocalDateTime(value?: string): string {
  return value ? value.slice(0, 16).replace("T", " ") : ""
}

/** 起止时间区间展示：两侧都有用 " ~ " 连接，只有一侧则原样返回。 */
export function formatTimeRange(start?: string, end?: string): string {
  const s = formatLocalDateTime(start)
  const e = formatLocalDateTime(end)
  if (s && e) return `${s} ~ ${e}`
  return s || e
}

/** Offset-less university timestamps are Shanghai wall time, not device-local time. */
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
