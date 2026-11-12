import semver from "semver"
import type {
  MarketplaceIndex,
  MarketplacePlugin,
  MarketplaceRelease,
  PluginPlatform,
} from "@ysu/plugin-sdk"
import { PLUGIN_API_VERSION } from "@ysu/plugin-sdk"

export const PLUGIN_MARKET_URL = "https://ysu.welain.com/updates/plugins.json"
const MARKET_CACHE_KEY = "academic-client-plugin-market-cache"

export interface PluginMarketResult {
  index: MarketplaceIndex
  stale: boolean
}

export function selectCompatibleRelease(
  plugin: MarketplacePlugin,
  appVersion: string,
  platform: PluginPlatform
): MarketplaceRelease | undefined {
  return plugin.versions
    .filter((release) => release.apiVersion === PLUGIN_API_VERSION)
    .filter((release) => release.platforms.includes(platform))
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
  platform: PluginPlatform
): AvailablePluginUpdate[] {
  const versions = new Map(installed.map((plugin) => [plugin.id, plugin.version]))
  return index.plugins.flatMap((plugin) => {
    const currentVersion = versions.get(plugin.id)
    if (!currentVersion) return []
    const release = selectCompatibleRelease(plugin, appVersion, platform)
    if (!release || !semver.gt(release.version, currentVersion)) return []
    return [{ plugin, release, currentVersion }]
  })
}

export function loadCachedPluginMarket(): PluginMarketResult | undefined {
  try {
    const cached = localStorage.getItem(MARKET_CACHE_KEY)
    return cached ? { index: validateMarketplaceIndex(JSON.parse(cached)), stale: true } : undefined
  } catch {
    return undefined
  }
}

export async function loadPluginMarket(): Promise<PluginMarketResult> {
  try {
    const response = await fetch(PLUGIN_MARKET_URL, { cache: "no-store" })
    if (!response.ok) throw new Error(`Plugin market returned HTTP ${response.status}`)
    const index = validateMarketplaceIndex(await response.json())
    try {
      localStorage.setItem(MARKET_CACHE_KEY, JSON.stringify(index))
    } catch {
      // A fresh index remains usable when persistent storage is unavailable.
    }
    return { index, stale: false }
  } catch (error) {
    try {
      const cached = localStorage.getItem(MARKET_CACHE_KEY)
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
        typeof release.zipUrl !== "string" ||
        !/^[a-f0-9]{64}$/.test(release.sha256) ||
        !Number.isSafeInteger(release.size) ||
        release.size <= 0
      ) {
        throw new Error(`Invalid release for plugin ${plugin.id}`)
      }
    }
  }
  return index as MarketplaceIndex
}
