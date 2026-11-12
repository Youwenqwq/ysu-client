const MAX_PACKAGE_PATH_LENGTH = 255
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/
const SAFE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/
const JAVASCRIPT_PATH = /\.(?:m?js)$/i

/** A package-relative file path is safe when every segment is a plain file name. */
export function isSafePackagePath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PACKAGE_PATH_LENGTH) return false
  if (!SAFE_PATH.test(path)) return false
  return path.split("/").every((segment) => segment !== "." && segment !== "..")
}

/** Whether an import target can be treated as an ES module file. */
export function isJavaScriptPackagePath(path: string): boolean {
  return JAVASCRIPT_PATH.test(path)
}

/** Directory portion of a package-relative path, or an empty string at the root. */
export function packageDirectory(path: string): string {
  const separator = path.lastIndexOf("/")
  return separator === -1 ? "" : path.slice(0, separator)
}

/**
 * Resolve a relative module specifier against the importing file.
 * Returns undefined when the specifier is not relative or escapes the package root.
 */
export function resolveRelativePackagePath(
  fromPath: string,
  specifier: string
): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return undefined

  const segments = packageDirectory(fromPath).split("/").filter(Boolean)

  for (const segment of specifier.split("/")) {
    if (segment.length === 0 || segment === ".") continue
    if (segment === "..") {
      if (segments.length === 0) return undefined
      segments.pop()
      continue
    }
    if (!SAFE_SEGMENT.test(segment)) return undefined
    segments.push(segment)
  }

  if (segments.length === 0) return undefined
  const resolved = segments.join("/")
  return resolved.length <= MAX_PACKAGE_PATH_LENGTH ? resolved : undefined
}
