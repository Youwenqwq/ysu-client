import semver from "semver"

export const PLUGIN_API_VERSION = 3

export const PLATFORM_MODULES = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "sonner",
  "@orahako/sdk",
  "@orahako/ui-primitives",
] as const

export type PlatformModuleSpecifier = (typeof PLATFORM_MODULES)[number]

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isPluginKind(value: unknown): value is PluginKind {
  return (
    value === "runtime" ||
    value === "provider" ||
    value === "feature" ||
    value === "theme" ||
    value === "shell"
  )
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!isPlainRecord(value)) return false
  return Object.values(value).every((entry) => typeof entry === "string")
}

function optionalString(value: unknown, field: string, issues: string[]): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.length === 0) {
    issues.push(`${field} must be a non-empty string`)
    return undefined
  }
  return value
}

export function validatePluginManifest(input: unknown): PluginManifest {
  if (!isPlainRecord(input)) {
    throw new PluginManifestError(["manifest must be an object"])
  }

  const issues: string[] = []
  for (const field of ["id", "name", "version", "entry"] as const) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      issues.push(`${field} must be a non-empty string`)
    }
  }
  if (typeof input.id === "string" && !PLUGIN_ID_PATTERN.test(input.id)) {
    issues.push("id must contain lowercase DNS-like labels separated by dots")
  }
  if (typeof input.version === "string" && !semver.valid(input.version)) {
    issues.push("version must be a valid SemVer")
  }
  if (typeof input.minAppVersion === "string" && !semver.valid(input.minAppVersion)) {
    issues.push("minAppVersion must be a valid SemVer")
  }
  if (input.required !== undefined && typeof input.required !== "boolean") {
    issues.push("required must be a boolean")
  }
  if (input.providerIndependent !== undefined && typeof input.providerIndependent !== "boolean") {
    issues.push("providerIndependent must be a boolean")
  }
  if (input.apiVersion !== PLUGIN_API_VERSION) {
    issues.push(`apiVersion must be ${PLUGIN_API_VERSION}`)
  }
  if (!isPluginKind(input.kind)) {
    issues.push("kind must be runtime, provider, feature, theme, or shell")
  }
  if (typeof input.entry === "string" && !PACKAGE_FILE_PATTERN.test(input.entry)) {
    issues.push("entry must be a safe relative JavaScript file path")
  }

  const minAppVersion = optionalString(input.minAppVersion, "minAppVersion", issues)
  const description = optionalString(input.description, "description", issues)
  const author = optionalString(input.author, "author", issues)
  const homepage = optionalString(input.homepage, "homepage", issues)
  const icon = optionalString(input.icon, "icon", issues)

  if (icon !== undefined && !PACKAGE_FILE_PATTERN.test(icon)) {
    issues.push("icon must be a safe relative file path")
  }
  if (
    input.styles !== undefined &&
    (!isStringArray(input.styles) || input.styles.some((path) => !PACKAGE_FILE_PATTERN.test(path)))
  ) {
    issues.push("styles must contain safe relative CSS file paths")
  }
  if (
    input.categories !== undefined &&
    (!isStringArray(input.categories) || input.categories.some((category) => !category.trim()))
  ) {
    issues.push("categories must contain non-empty strings")
  }
  if (
    input.requires !== undefined &&
    (!isStringRecord(input.requires) ||
      Object.entries(input.requires).some(
        ([id, range]) => !PLUGIN_ID_PATTERN.test(id) || !semver.validRange(range)
      ))
  ) {
    issues.push("requires must contain valid plugin IDs and SemVer ranges")
  }
  for (const field of ["inject", "provides", "nativeCapabilities"] as const) {
    if (
      input[field] !== undefined &&
      (!isStringArray(input[field]) || input[field].some((name) => !name.trim()))
    ) {
      issues.push(`${field} must contain non-empty service names`)
    }
  }
  if (
    isStringArray(input.nativeCapabilities) &&
    input.nativeCapabilities.some((capability) => !/^[^\s@]+@\d+$/.test(capability))
  ) {
    issues.push("nativeCapabilities must use the <capability-id>@<version> form")
  }
  if (input.configSchema !== undefined && !isPlainRecord(input.configSchema)) {
    issues.push("configSchema must be a JSON Schema object")
  }
  if (
    typeof input.id === "string" &&
    isPlainRecord(input.requires) &&
    Object.prototype.hasOwnProperty.call(input.requires, input.id)
  ) {
    issues.push("plugin must not depend on itself")
  }

  if (
    issues.length > 0 ||
    typeof input.id !== "string" ||
    typeof input.name !== "string" ||
    typeof input.version !== "string" ||
    typeof input.entry !== "string" ||
    typeof input.apiVersion !== "number" ||
    !isPluginKind(input.kind)
  ) {
    throw new PluginManifestError(issues)
  }

  const manifest: PluginManifest = {
    id: input.id,
    name: input.name,
    version: input.version,
    apiVersion: input.apiVersion,
    kind: input.kind,
    entry: input.entry,
    ...(minAppVersion !== undefined ? { minAppVersion } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(homepage !== undefined ? { homepage } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(isStringArray(input.styles) ? { styles: [...input.styles] } : {}),
    ...(isStringArray(input.categories) ? { categories: [...input.categories] } : {}),
    ...(isStringRecord(input.requires) ? { requires: { ...input.requires } } : {}),
    ...(isStringArray(input.inject) ? { inject: [...input.inject] } : {}),
    ...(isStringArray(input.provides) ? { provides: [...input.provides] } : {}),
    ...(isPlainRecord(input.configSchema) ? { configSchema: input.configSchema } : {}),
    ...(isStringArray(input.nativeCapabilities)
      ? { nativeCapabilities: [...input.nativeCapabilities] }
      : {}),
    ...(typeof input.required === "boolean" ? { required: input.required } : {}),
    ...(typeof input.providerIndependent === "boolean"
      ? { providerIndependent: input.providerIndependent }
      : {}),
  }

  return manifest
}
