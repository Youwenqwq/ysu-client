import semver from "semver"
import { PLUGIN_API_VERSION } from "./manifest"

export type PluginPlatform = "web" | "android"

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

export interface PluginMarketResult {
  index: MarketplaceIndex
  stale: boolean
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
        !release.minAppVersion ||
        (semver.valid(release.minAppVersion) && semver.gte(appVersion, release.minAppVersion))
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
  try {
    const response = await fetch(indexUrl, { cache: "no-store" })
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
    try {
      const cached = localStorage.getItem(`${MARKET_CACHE_PREFIX}${encodeURIComponent(indexUrl)}`)
      if (cached) return { index: validateMarketplaceIndex(JSON.parse(cached)), stale: true }
    } catch {
      // Fall through to the network error when no valid cache exists.
    }
    throw error
  }
}

export function validateMarketplaceIndex(input: unknown): MarketplaceIndex {
  if (!input || typeof input !== "object") throw new Error("Plugin market index must be an object")
  const index = input as Partial<MarketplaceIndex>
  if (
    index.schemaVersion !== 1 ||
    typeof index.updatedAt !== "string" ||
    !Array.isArray(index.plugins)
  ) {
    throw new Error("Unsupported plugin market index")
  }
  for (const plugin of index.plugins) {
    if (
      !plugin ||
      typeof plugin.id !== "string" ||
      typeof plugin.name !== "string" ||
      !Array.isArray(plugin.versions)
    ) {
      throw new Error("Invalid plugin market entry")
    }
    for (const release of plugin.versions) {
      if (
        typeof release.version !== "string" ||
        !semver.valid(release.version) ||
        release.apiVersion !== PLUGIN_API_VERSION ||
        !Array.isArray(release.platforms) ||
        (release.nativeCapabilities !== undefined &&
          (!Array.isArray(release.nativeCapabilities) ||
            release.nativeCapabilities.some(
              (capability) => typeof capability !== "string" || !capability.trim()
            ))) ||
        (["inject", "provides"] as const).some(
          (field) =>
            release[field] !== undefined &&
            (!Array.isArray(release[field]) ||
              release[field].some((name) => typeof name !== "string" || !name.trim()))
        ) ||
        (release.requires !== undefined &&
          (!release.requires ||
            typeof release.requires !== "object" ||
            Array.isArray(release.requires) ||
            Object.entries(release.requires).some(
              ([, range]) => typeof range !== "string" || !semver.validRange(range)
            ))) ||
        typeof release.zipUrl !== "string" ||
        !/^[a-f0-9]{64}$/.test(release.sha256) ||
        !Number.isSafeInteger(release.size) ||
        release.size <= 0
      ) {
        throw new Error(`Invalid release for plugin ${plugin.id}`)
      }
    }
  }
  if (index.bundles !== undefined) validateMarketplaceBundles(index.bundles)
  return index as MarketplaceIndex
}

function validateMarketplaceBundles(bundles: unknown): void {
  if (!Array.isArray(bundles)) throw new Error("Invalid plugin market bundles")
  const ids = new Set<string>()
  for (const bundle of bundles) {
    if (
      !bundle ||
      typeof bundle !== "object" ||
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
    for (const pluginId of bundle.pluginIds) {
      if (!isNonEmptyString(pluginId)) {
        throw new Error(`Invalid plugin id in bundle ${bundle.id}`)
      }
      if (pluginIds.has(pluginId)) {
        throw new Error(`Duplicate plugin id in bundle ${bundle.id}: ${pluginId}`)
      }
      pluginIds.add(pluginId)
    }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}
