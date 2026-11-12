import semver from "semver"

export const PLUGIN_API_VERSION = 1

export type PluginKind = "provider" | "feature" | "theme"

export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: number
  kind: PluginKind
  entry: string
  minAppVersion?: string
  description?: string
  author?: string
  homepage?: string
  icon?: string
  styles?: string[]
  /** Core providers can be replaced but not disabled from the plugin manager. */
  required?: boolean
}

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/
const PACKAGE_FILE_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/

export class PluginManifestError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid plugin manifest: ${issues.join("; ")}`)
    this.name = "PluginManifestError"
  }
}

function optionalString(value: unknown, field: string, issues: string[]): void {
  if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
    issues.push(`${field} must be a non-empty string`)
  }
}

export function validatePluginManifest(input: unknown): PluginManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PluginManifestError(["manifest must be an object"])
  }

  const value = input as Record<string, unknown>
  const issues: string[] = []
  for (const field of ["id", "name", "version", "entry"] as const) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      issues.push(`${field} must be a non-empty string`)
    }
  }
  if (typeof value.id === "string" && !PLUGIN_ID_PATTERN.test(value.id)) {
    issues.push("id must contain lowercase DNS-like labels separated by dots")
  }
  if (typeof value.version === "string" && !semver.valid(value.version)) {
    issues.push("version must be a valid SemVer")
  }
  if (typeof value.minAppVersion === "string" && !semver.valid(value.minAppVersion)) {
    issues.push("minAppVersion must be a valid SemVer")
  }
  if (value.required !== undefined && typeof value.required !== "boolean") {
    issues.push("required must be a boolean")
  }
  if (value.apiVersion !== PLUGIN_API_VERSION) {
    issues.push(`apiVersion must be ${PLUGIN_API_VERSION}`)
  }
  if (!["provider", "feature", "theme"].includes(String(value.kind))) {
    issues.push("kind must be provider, feature, or theme")
  }
  if (typeof value.entry === "string" && !PACKAGE_FILE_PATTERN.test(value.entry)) {
    issues.push("entry must be a safe relative JavaScript file path")
  }
  for (const field of ["minAppVersion", "description", "author", "homepage", "icon"] as const) {
    optionalString(value[field], field, issues)
  }
  if (
    value.icon !== undefined &&
    typeof value.icon === "string" &&
    !PACKAGE_FILE_PATTERN.test(value.icon)
  ) {
    issues.push("icon must be a safe relative file path")
  }
  if (
    value.styles !== undefined &&
    (!Array.isArray(value.styles) ||
      value.styles.some((path) => typeof path !== "string" || !PACKAGE_FILE_PATTERN.test(path)))
  ) {
    issues.push("styles must contain safe relative CSS file paths")
  }

  if (issues.length > 0) throw new PluginManifestError(issues)
  return value as unknown as PluginManifest
}
