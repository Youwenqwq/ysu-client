import semver from "semver"

export const PLUGIN_API_VERSION = 2

export type PluginKind = "runtime" | "provider" | "feature" | "theme" | "shell"

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
  /** Optional UI categories such as academic, provider, or toybox. */
  categories?: string[]
  /** Exact plugin package dependencies and their required SemVer ranges. */
  requires?: Record<string, string>
  /** Root Cordis services required by this plugin. */
  inject?: string[]
  /** Root Cordis services supplied by this plugin. */
  provides?: string[]
  /** JSON Schema draft-07 object schema validated by the kernel at startup. */
  configSchema?: Record<string, unknown>
  /** Versioned Android capabilities required by this package, when applicable. */
  nativeCapabilities?: string[]
  /** Core providers can be replaced but not disabled from the plugin manager. */
  required?: boolean
  /**
   * Feature plugins that are global UI/tools rather than provider features.
   * They stay active regardless of the provider's `supportedPlugins` list.
   */
  providerIndependent?: boolean
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
  if (value.providerIndependent !== undefined && typeof value.providerIndependent !== "boolean") {
    issues.push("providerIndependent must be a boolean")
  }
  if (value.apiVersion !== PLUGIN_API_VERSION) {
    issues.push(`apiVersion must be ${PLUGIN_API_VERSION}`)
  }
  if (!["runtime", "provider", "feature", "theme", "shell"].includes(String(value.kind))) {
    issues.push("kind must be runtime, provider, feature, theme, or shell")
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
  if (
    value.categories !== undefined &&
    (!Array.isArray(value.categories) ||
      value.categories.some((category) => typeof category !== "string" || !category.trim()))
  ) {
    issues.push("categories must contain non-empty strings")
  }
  if (
    value.requires !== undefined &&
    (!value.requires ||
      typeof value.requires !== "object" ||
      Array.isArray(value.requires) ||
      Object.entries(value.requires).some(
        ([id, range]) =>
          !PLUGIN_ID_PATTERN.test(id) || typeof range !== "string" || !semver.validRange(range)
      ))
  ) {
    issues.push("requires must contain valid plugin IDs and SemVer ranges")
  }
  for (const field of ["inject", "provides", "nativeCapabilities"] as const) {
    if (
      value[field] !== undefined &&
      (!Array.isArray(value[field]) ||
        value[field].some((name) => typeof name !== "string" || !name.trim()))
    ) {
      issues.push(`${field} must contain non-empty service names`)
    }
  }
  if (
    Array.isArray(value.nativeCapabilities) &&
    value.nativeCapabilities.some((capability) => !/^[^\s@]+@\d+$/.test(capability))
  ) {
    issues.push("nativeCapabilities must use the <capability-id>@<version> form")
  }
  if (
    value.configSchema !== undefined &&
    (!value.configSchema || typeof value.configSchema !== "object" || Array.isArray(value.configSchema))
  ) {
    issues.push("configSchema must be a JSON Schema object")
  }
  if (
    typeof value.id === "string" &&
    value.requires &&
    typeof value.requires === "object" &&
    !Array.isArray(value.requires) &&
    Object.prototype.hasOwnProperty.call(value.requires, value.id)
  ) {
    issues.push("plugin must not depend on itself")
  }

  if (issues.length > 0) throw new PluginManifestError(issues)
  return value as unknown as PluginManifest
}
