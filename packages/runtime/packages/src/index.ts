import {
  definePlugin,
  isCapacitor,
  loadPluginMarket,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  selectCompatibleRelease,
  type Context,
  type MarketplaceIndex,
  type PluginAssetService,
  type PluginInstallerService,
  type PluginManifest,
  type PluginPackageRuntime,
  type PluginPlatform,
  type ScopedPluginService,
} from "@orahako/sdk"

export type InstallerRuntimeConfig = {
  readonly marketUrl: string
  readonly appVersion: string
}

export interface MarketPluginInstallerOptions {
  readonly marketUrl: string
  readonly appVersion: string
  readonly nativeCapabilities?: readonly string[] | (() => readonly string[])
  readonly applyBundle: (
    pluginIds: readonly string[],
    index: MarketplaceIndex
  ) => Promise<PluginManifest>
  readonly loadMarket?: () => Promise<{ readonly index: MarketplaceIndex }>
  readonly platform?: () => PluginPlatform
}

export function createMarketPluginInstaller({
  marketUrl,
  appVersion,
  nativeCapabilities = [],
  applyBundle,
  loadMarket,
  platform = () => (isCapacitor() ? "android" : "web"),
}: MarketPluginInstallerOptions): PluginInstallerService {
  return {
    async installFromMarket(pluginId: string): Promise<PluginManifest> {
      const { index } = await (loadMarket ?? (() => loadPluginMarket(marketUrl)))()
      const plugin = index.plugins.find((entry) => entry.id === pluginId)
      if (!plugin) {
        throw new Error(`Plugin not found in market: ${pluginId}`)
      }
      const currentPlatform = platform()
      const resolvedCapabilities =
        typeof nativeCapabilities === "function" ? nativeCapabilities() : nativeCapabilities
      const release = selectCompatibleRelease(
        plugin,
        appVersion,
        currentPlatform,
        resolvedCapabilities
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

export class PackageAssetService implements ScopedPluginService<PluginAssetService> {
  constructor(private readonly packageRuntime: PluginPackageRuntime) {}

  [PLUGIN_SERVICE_SCOPE](_ctx: Context, manifest: PluginManifest): PluginAssetService {
    return {
      url: (path: string) => this.packageRuntime.assetUrl(manifest.id, path),
    }
  }
}

export const assetsRuntimePlugin = definePlugin({
  manifest: {
    id: "orahako.runtime.assets",
    name: "Plugin package assets",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    inject: ["packageRuntime"],
    provides: ["assets"],
  },
  inject: ["packageRuntime"] as const,
  apply(ctx) {
    ctx.set("assets", new PackageAssetService(ctx.packageRuntime))
  },
})

export const installerRuntimePlugin = definePlugin<
  readonly ["packageRuntime"],
  InstallerRuntimeConfig
>({
  manifest: {
    id: "orahako.runtime.installer",
    name: "Market plugin installer",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    inject: ["packageRuntime"],
    provides: ["plugins"],
  },
  inject: ["packageRuntime"] as const,
  configSchema: {
    type: "object",
    required: ["marketUrl", "appVersion"],
    properties: {
      marketUrl: { type: "string", minLength: 1 },
      appVersion: { type: "string", minLength: 1 },
    },
    additionalProperties: false,
  },
  apply(ctx, config: InstallerRuntimeConfig) {
    const packages = ctx.packageRuntime
    ctx.set(
      "plugins",
      createMarketPluginInstaller({
        marketUrl: config.marketUrl,
        appVersion: config.appVersion,
        nativeCapabilities: () => packages.nativeCapabilities(),
        applyBundle: (pluginIds, index) => packages.applyPluginBundle(pluginIds, index),
      })
    )
  },
})
