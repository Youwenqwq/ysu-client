/**
 * 共享的日期/时间格式归一助手。
 *
 * 约定：日期 YYYY-MM-DD，日期时间 RFC3339（YYYY-MM-DDTHH:MM:SS），
 * 未识别格式原样透传。
 */

const ISO_DATE_RE = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/
const ISO_DATETIME_RE = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/

function rawString(val: unknown): string {
  if (val === null || val === undefined) return ""
  return String(val)
}

/** 把已知日期格式归一为 YYYY-MM-DD；未识别的原样透传。 */
export function toIsoDate(val: unknown): string {
  const s = rawString(val).trim()
  const m = ISO_DATE_RE.exec(s)
  if (m) {
    const [, y, mo, d] = m
    return `${y}-${String(parseInt(mo!, 10)).padStart(2, "0")}-${String(parseInt(d!, 10)).padStart(2, "0")}`
  }
  return rawString(val)
}

/** 把已知日期时间格式归一为 RFC3339；未识别的原样透传。 */
export function toIsoDatetime(val: unknown): string {
  const s = rawString(val).trim()
  const m = ISO_DATETIME_RE.exec(s)
  if (m) {
    const [, y, mo, d, h, mi, se] = m
    return `${y}-${String(parseInt(mo!, 10)).padStart(2, "0")}-${String(parseInt(d!, 10)).padStart(2, "0")}T${String(parseInt(h!, 10)).padStart(2, "0")}:${mi}:${se ?? "00"}`
  }
  return rawString(val)
}
