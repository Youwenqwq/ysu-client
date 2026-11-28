import semver from "semver"
import { PLUGIN_API_VERSION } from "./manifest"

export type PluginPlatform = "web" | "android"
export type MarketplacePluginTrust = "official" | "community"

export interface MarketplaceRelease {
  version: string
  apiVersion: number
  minAppVersion?: string
  platforms: PluginPlatform[]
  nativeCapabilities?: string[]
  inject?: string[]
  provides?: string[]
  requires?: Record<string, string>
  zipUrl: string
  sha256: string
  size: number
  publishedAt: string
  changelog?: string
}

export interface MarketplacePlugin {
  id: string
  name: string
  summary: string
  author: string
  trust?: MarketplacePluginTrust
  homepage?: string
  icon?: string
  categories: string[]
  versions: MarketplaceRelease[]
}

/** Curated set of plugins recommended for one school. */
export interface MarketplaceBundle {
  id: string
  name: string
  schoolId: string
  pluginIds: string[]
}

export interface MarketplaceIndex {
  schemaVersion: 1
  updatedAt: string
  plugins: MarketplacePlugin[]
  /** Optional so indexes published before bundles existed remain valid. */
  bundles?: MarketplaceBundle[]
}

const MARKET_CACHE_PREFIX = "orahako-plugin-market-cache:"
const GITHUB_RAW_PREFIX = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/
const JSDELIVR_GH_PREFIX = /^https:\/\/cdn\.jsdelivr\.net\/gh\/([^/]+)\/([^/@]+)@([^/]+)\/(.+)$/

/**
 * Expand a GitHub Raw or jsDelivr URL into an ordered candidate list
 * preferring jsDelivr CDN with automatic fallback to GitHub Raw.
 * Custom / third-party URLs are returned as-is.
 */
export function resolveMarketUrls(url: string): readonly string[] {
  const rawMatch = GITHUB_RAW_PREFIX.exec(url)
  if (rawMatch) {
    const [, owner, repo, ref, filePath] = rawMatch
    return [`https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${filePath}`, url]
  }
  const cdnMatch = JSDELIVR_GH_PREFIX.exec(url)
  if (cdnMatch) {
    const [, owner, repo, ref, filePath] = cdnMatch
    return [url, `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`]
  }
  return [url]
}

export interface PluginMarketResult {
  index: MarketplaceIndex
  stale: boolean
}

/**
 * Compare running `appVersion` against a plugin's `minAppVersion`.
 *
 * When `minAppVersion` has no prerelease identifier (e.g. `"0.15.0"`), prerelease
 * builds of that release line (e.g. `"0.15.0-canary.1"`, `"0.15.0-beta.1"`) are
 * treated as compatible by comparing `major.minor.patch`. When `minAppVersion`
 * explicitly declares a prerelease identifier, strict SemVer ordering applies.
 */
export function isAppVersionCompatible(appVersion: string, minAppVersion: string): boolean {
  const parsedApp = semver.parse(appVersion)
  const parsedMin = semver.parse(minAppVersion)
  if (!parsedApp || !parsedMin) return false
  if (parsedMin.prerelease.length > 0) {
    return semver.gte(parsedApp, parsedMin)
  }
  const appBase = `${parsedApp.major}.${parsedApp.minor}.${parsedApp.patch}`
  return semver.gte(appBase, parsedMin)
}

export function selectCompatibleRelease(
  plugin: MarketplacePlugin,
  appVersion: string,
  platform: PluginPlatform,
  nativeCapabilities: readonly string[] = []
): MarketplaceRelease | undefined {
  return plugin.versions
    .filter((release) => release.apiVersion === PLUGIN_API_VERSION)
    .filter((release) => release.platforms.includes(platform))
    .filter((release) =>
      (release.nativeCapabilities ?? []).every((capability) =>
        nativeCapabilities.includes(capability)
      )
    )
    .filter(
      (release) =>
        !release.minAppVersion || isAppVersionCompatible(appVersion, release.minAppVersion)
    )
    .sort((a, b) => semver.rcompare(a.version, b.version))[0]
}

export interface AvailablePluginUpdate {
  plugin: MarketplacePlugin
  release: MarketplaceRelease
  currentVersion: string
}

export function findAvailableUpdates(
  index: MarketplaceIndex,
  installed: readonly { id: string; version: string }[],
  appVersion: string,
  platform: PluginPlatform,
  nativeCapabilities: readonly string[] = []
): AvailablePluginUpdate[] {
  const versions = new Map(installed.map((plugin) => [plugin.id, plugin.version]))
  return index.plugins.flatMap((plugin) => {
    const currentVersion = versions.get(plugin.id)
    if (!currentVersion) return []
    const release = selectCompatibleRelease(plugin, appVersion, platform, nativeCapabilities)
    if (!release || !semver.gt(release.version, currentVersion)) return []
    return [{ plugin, release, currentVersion }]
  })
}

export function loadCachedPluginMarket(indexUrl: string): PluginMarketResult | undefined {
  try {
    const cached = localStorage.getItem(`${MARKET_CACHE_PREFIX}${encodeURIComponent(indexUrl)}`)
    return cached ? { index: validateMarketplaceIndex(JSON.parse(cached)), stale: true } : undefined
  } catch {
    return undefined
  }
}

export async function loadPluginMarket(indexUrl: string): Promise<PluginMarketResult> {
  const candidates = resolveMarketUrls(indexUrl)
  let lastError: unknown
  for (const candidateUrl of candidates) {
    try {
      const response = await fetch(candidateUrl, { cache: "no-store" })
      if (!response.ok) throw new Error(`Plugin market returned HTTP ${response.status}`)
      const index = validateMarketplaceIndex(await response.json())
      try {
        localStorage.setItem(
          `${MARKET_CACHE_PREFIX}${encodeURIComponent(indexUrl)}`,
          JSON.stringify(index)
        )
      } catch {
        // A fresh index remains usable when persistent storage is unavailable.
      }
      return { index, stale: false }
    } catch (error) {
      lastError = error
    }
  }
  try {
    const cached = localStorage.getItem(`${MARKET_CACHE_PREFIX}${encodeURIComponent(indexUrl)}`)
    if (cached) return { index: validateMarketplaceIndex(JSON.parse(cached)), stale: true }
  } catch {
    // Fall through to the network error when no valid cache exists.
  }
  throw lastError
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isPlatform(value: unknown): value is PluginPlatform {
  return value === "web" || value === "android"
}

function isTrustLevel(value: unknown): value is MarketplacePluginTrust {
  return value === "official" || value === "community"
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

function isSemverRangeRecord(value: unknown): value is Record<string, string> {
  if (!isPlainRecord(value)) return false
  return Object.values(value).every(
    (range): range is string => typeof range === "string" && Boolean(semver.validRange(range))
  )
}

export function validateMarketplaceIndex(input: unknown): MarketplaceIndex {
  if (!isPlainRecord(input)) throw new Error("Plugin market index must be an object")
  if (
    input.schemaVersion !== 1 ||
    typeof input.updatedAt !== "string" ||
    !Array.isArray(input.plugins)
  ) {
    throw new Error("Unsupported plugin market index")
  }

  const plugins: MarketplacePlugin[] = []
  for (const rawPlugin of input.plugins) {
    if (
      !isPlainRecord(rawPlugin) ||
      typeof rawPlugin.id !== "string" ||
      typeof rawPlugin.name !== "string" ||
      (rawPlugin.trust !== undefined && !isTrustLevel(rawPlugin.trust)) ||
      !Array.isArray(rawPlugin.versions)
    ) {
      throw new Error("Invalid plugin market entry")
    }

    const versions: MarketplaceRelease[] = []
    for (const rawRelease of rawPlugin.versions) {
      if (
        !isPlainRecord(rawRelease) ||
        typeof rawRelease.version !== "string" ||
        !semver.valid(rawRelease.version) ||
        !Number.isSafeInteger(rawRelease.apiVersion) ||
        typeof rawRelease.apiVersion !== "number" ||
        rawRelease.apiVersion <= 0 ||
        !Array.isArray(rawRelease.platforms) ||
        !rawRelease.platforms.every(isPlatform) ||
        (rawRelease.nativeCapabilities !== undefined &&
          !isNonEmptyStringArray(rawRelease.nativeCapabilities)) ||
        (rawRelease.inject !== undefined && !isNonEmptyStringArray(rawRelease.inject)) ||
        (rawRelease.provides !== undefined && !isNonEmptyStringArray(rawRelease.provides)) ||
        (rawRelease.requires !== undefined && !isSemverRangeRecord(rawRelease.requires)) ||
        (rawRelease.minAppVersion !== undefined &&
          (typeof rawRelease.minAppVersion !== "string" ||
            !semver.valid(rawRelease.minAppVersion))) ||
        typeof rawRelease.zipUrl !== "string" ||
        typeof rawRelease.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(rawRelease.sha256) ||
        typeof rawRelease.size !== "number" ||
        !Number.isSafeInteger(rawRelease.size) ||
        rawRelease.size <= 0
      ) {
        throw new Error(`Invalid release for plugin ${rawPlugin.id}`)
      }

      versions.push({
        version: rawRelease.version,
        apiVersion: rawRelease.apiVersion,
        ...(typeof rawRelease.minAppVersion === "string"
          ? { minAppVersion: rawRelease.minAppVersion }
          : {}),
        platforms: [...rawRelease.platforms],
        ...(rawRelease.nativeCapabilities
          ? { nativeCapabilities: [...rawRelease.nativeCapabilities] }
          : {}),
        ...(rawRelease.inject ? { inject: [...rawRelease.inject] } : {}),
        ...(rawRelease.provides ? { provides: [...rawRelease.provides] } : {}),
        ...(rawRelease.requires ? { requires: { ...rawRelease.requires } } : {}),
        zipUrl: rawRelease.zipUrl,
        sha256: rawRelease.sha256,
        size: rawRelease.size,
        publishedAt: typeof rawRelease.publishedAt === "string" ? rawRelease.publishedAt : "",
        ...(typeof rawRelease.changelog === "string" ? { changelog: rawRelease.changelog } : {}),
      })
    }

    plugins.push({
      id: rawPlugin.id,
      name: rawPlugin.name,
      summary: typeof rawPlugin.summary === "string" ? rawPlugin.summary : "",
      author: typeof rawPlugin.author === "string" ? rawPlugin.author : "",
      ...(rawPlugin.trust !== undefined ? { trust: rawPlugin.trust } : {}),
      ...(typeof rawPlugin.homepage === "string" ? { homepage: rawPlugin.homepage } : {}),
      ...(typeof rawPlugin.icon === "string" ? { icon: rawPlugin.icon } : {}),
      categories: Array.isArray(rawPlugin.categories)
        ? rawPlugin.categories.filter((c): c is string => typeof c === "string")
        : [],
      versions,
    })
  }

  const bundles =
    input.bundles !== undefined ? validateMarketplaceBundles(input.bundles) : undefined

  return {
    schemaVersion: 1,
    updatedAt: input.updatedAt,
    plugins,
    ...(bundles !== undefined ? { bundles } : {}),
  }
}

function validateMarketplaceBundles(bundles: unknown): MarketplaceBundle[] {
  if (!Array.isArray(bundles)) throw new Error("Invalid plugin market bundles")
  const ids = new Set<string>()
  const validated: MarketplaceBundle[] = []
  for (const bundle of bundles) {
    if (
      !isPlainRecord(bundle) ||
      !isNonEmptyString(bundle.id) ||
      !isNonEmptyString(bundle.name) ||
      !isNonEmptyString(bundle.schoolId) ||
      !Array.isArray(bundle.pluginIds)
    ) {
      throw new Error("Invalid plugin market bundle")
    }
    if (ids.has(bundle.id)) throw new Error(`Duplicate bundle id: ${bundle.id}`)
    ids.add(bundle.id)
    const pluginIds = new Set<string>()
    const resolvedPluginIds: string[] = []
    for (const pluginId of bundle.pluginIds) {
      if (!isNonEmptyString(pluginId)) {
        throw new Error(`Invalid plugin id in bundle ${bundle.id}`)
      }
      if (pluginIds.has(pluginId)) {
        throw new Error(`Duplicate plugin id in bundle ${bundle.id}: ${pluginId}`)
      }
      pluginIds.add(pluginId)
      resolvedPluginIds.push(pluginId)
    }
    validated.push({
      id: bundle.id,
      name: bundle.name,
      schoolId: bundle.schoolId,
      pluginIds: resolvedPluginIds,
    })
  }
  return validated
}
