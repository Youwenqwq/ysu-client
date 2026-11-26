/**
 * YSU-owned runtime narrowing helpers.
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {}
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
