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
