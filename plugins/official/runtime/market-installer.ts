import {
  isCapacitor,
  loadPluginMarket,
  selectCompatibleRelease,
  type MarketplaceIndex,
  type PluginInstallerService,
  type PluginManifest,
  type PluginPlatform,
} from "@orahako/plugin-sdk"

export interface MarketPluginInstallerOptions {
  marketUrl: string
  nativeCapabilities?: readonly string[]
  applyBundle: (pluginIds: readonly string[], index: MarketplaceIndex) => Promise<PluginManifest>
  loadMarket?: () => Promise<{ index: MarketplaceIndex }>
  /** Installed application version, supplied by the active composition. */
  appVersion: string
  platform?: () => PluginPlatform
}

export function createMarketPluginInstaller({
  marketUrl,
  nativeCapabilities = [],
  applyBundle,
  loadMarket,
  appVersion,
  platform = () => (isCapacitor() ? "android" : "web"),
}: MarketPluginInstallerOptions): PluginInstallerService {
  return {
    async installFromMarket(pluginId: string): Promise<PluginManifest> {
      const { index } = await (loadMarket ?? (() => loadPluginMarket(marketUrl)))()
      const plugin = index.plugins.find((entry) => entry.id === pluginId)
      if (!plugin) throw new Error(`Plugin not found in market: ${pluginId}`)
      const currentPlatform = platform()
      const release = selectCompatibleRelease(
        plugin,
        appVersion,
        currentPlatform,
        nativeCapabilities
      )
      if (!release) {
        throw new Error(
          `No compatible release for plugin ${pluginId} (app ${appVersion}, platform ${currentPlatform})`
        )
      }
      return applyBundle([pluginId], index)
    },
  }
}
