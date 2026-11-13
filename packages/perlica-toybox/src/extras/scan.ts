const PERLICA_CODE_PATTERN = /^\d{6,12}$/
const CODE_QUERY_PATTERN = /(?:^|[?&\s])(?:code|userCode)=([^&#\s]+)/gi

/** Extract a 6–12 digit vehicle code from plain text or a code/userCode query. */
export function parsePerlicaCode(text: string): string | null {
  const value = text.trim()
  if (PERLICA_CODE_PATTERN.test(value)) return value

  for (const match of value.matchAll(CODE_QUERY_PATTERN)) {
    let candidate: string
    try {
      candidate = decodeURIComponent(match[1])
    } catch {
      continue
    }

    if (PERLICA_CODE_PATTERN.test(candidate)) return candidate
  }

  return null
}
