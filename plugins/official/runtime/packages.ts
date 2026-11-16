import {
  definePlugin,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  type CompositionPlugin,
  type PluginPackageRuntime,
  type PluginContext,
} from "@orahako/plugin-sdk"
import { createMarketPluginInstaller } from "./market-installer"

export const installerRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "orahako.runtime.installer",
    name: "Market plugin installer",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    inject: ["packageRuntime"],
    provides: ["plugins"],
    configSchema: {
      type: "object",
      required: ["marketUrl", "appVersion"],
      properties: {
        marketUrl: { type: "string", minLength: 1 },
        appVersion: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
  },
  definition: definePlugin((ctx, config: { marketUrl: string; appVersion: string }) => {
    const packages = ctx.get("packageRuntime") as PluginPackageRuntime
    ctx.set(
      "plugins",
      createMarketPluginInstaller({
        marketUrl: config.marketUrl,
        appVersion: config.appVersion,
        nativeCapabilities: packages.nativeCapabilities(),
        applyBundle: packages.applyPluginBundle,
      })
    )
  }),
}

class PackageAssetService {
  private readonly packages: PluginPackageRuntime

  constructor(ctx: PluginContext) {
    this.packages = ctx.get("packageRuntime") as PluginPackageRuntime
  }

  [PLUGIN_SERVICE_SCOPE](_ctx: unknown, manifest: { id: string }) {
    return {
      url: (path: string) => this.packages.assetUrl(manifest.id, path),
    }
  }
}

export const assetsRuntimePlugin: CompositionPlugin = {
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
  definition: definePlugin((ctx) => {
    ctx.set("assets", new PackageAssetService(ctx))
  }),
}
