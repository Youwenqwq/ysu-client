export function translateDictionary(
  dictionary: Record<string, unknown>,
  key: string,
  params?: Record<string, string | number>
): string {
  let current: unknown = dictionary
  for (const part of key.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return key
    current = (current as Record<string, unknown>)[part]
  }
  if (typeof current !== "string") return key
  if (!params) return current
  return current.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] !== undefined ? String(params[name]) : `{${name}}`
  )
}
