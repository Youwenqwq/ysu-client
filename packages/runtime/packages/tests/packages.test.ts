import { Capacitor } from "@capacitor/core"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PluginHost, PluginRuntime } from "@orahako/kernel"
import {
  definePlugin,
  PLUGIN_API_VERSION,
  type CompositionPlugin,
  type MarketplaceIndex,
  type PluginAssetService,
  type PluginInstallerService,
  type PluginManifest,
  type PluginPackageRuntime,
} from "@orahako/sdk"
import {
  assetsRuntimePlugin,
  createMarketPluginInstaller,
  installerRuntimePlugin,
} from "../src/index"

const SHA_A = "a".repeat(64)
const SHA_B = "b".repeat(64)

function createMockPackageRuntime(
  overrides: Partial<PluginPackageRuntime> = {}
): PluginPackageRuntime {
  return {
    installFromUrl: vi.fn(
      async (
        _url: string,
        _sha: string,
        expected: { id: string; version: string }
      ): Promise<PluginManifest> => ({
        id: expected.id,
        name: expected.id,
        version: expected.version,
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      })
    ),
    applyPluginBundle: vi.fn(
      async (pluginIds: readonly string[]): Promise<PluginManifest> => ({
        id: pluginIds[0]!,
        name: pluginIds[0]!,
        version: "2.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      })
    ),
    assetUrl: vi.fn(
      (pluginId: string, path: string) => `blob:https://orahako.local/${pluginId}/${path}`
    ),
    nativeCapabilities: vi.fn(() => ["native.files@1"]),
    ...overrides,
  }
}

describe("@orahako/runtime-packages", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("scopes PluginAssetService lookups to each consumer plugin's manifest.id", async () => {
    const packageRuntime = createMockPackageRuntime({
      assetUrl: (pluginId, path) =>
        pluginId === "plugin.alpha" && path === "assets/logo.svg"
          ? "blob:alpha-logo"
          : pluginId === "plugin.beta" && path === "assets/logo.svg"
            ? "blob:beta-logo"
            : undefined,
    })

    const runtime = new PluginRuntime()
    let alphaAssets!: PluginAssetService
    let betaAssets!: PluginAssetService

    const alpha = definePlugin({
      manifest: {
        id: "plugin.alpha",
        name: "Alpha",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["assets"],
      },
      inject: ["assets"] as const,
      apply(ctx) {
        alphaAssets = ctx.assets
      },
    })

    const beta = definePlugin({
      manifest: {
        id: "plugin.beta",
        name: "Beta",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["assets"],
      },
      inject: ["assets"] as const,
      apply(ctx) {
        betaAssets = ctx.assets
      },
    })

    try {
      runtime.context.set("packageRuntime", packageRuntime)
      runtime.register(assetsRuntimePlugin, "builtin")
      runtime.register(alpha, "builtin")
      runtime.register(beta, "builtin")

      await runtime.startAndWait(assetsRuntimePlugin.manifest.id)
      await runtime.startAndWait(alpha.manifest.id)
      await runtime.startAndWait(beta.manifest.id)

      expect(alphaAssets.url("assets/logo.svg")).toBe("blob:alpha-logo")
      expect(betaAssets.url("assets/logo.svg")).toBe("blob:beta-logo")
      expect(alphaAssets.url("assets/missing.png")).toBeUndefined()
    } finally {
      runtime.dispose()
    }
  })

  it("installs API v3 compatible market releases and skips legacy v2 or incompatible entries", async () => {
    const marketPayload: MarketplaceIndex = {
      schemaVersion: 1,
      updatedAt: "2026-11-18T00:00:00Z",
      plugins: [
        {
          id: "community.skbird",
          name: "Skbird",
          summary: "Community toybox",
          author: "orahako",
          categories: ["toybox"],
          versions: [
            {
              // Historical API v2 release — valid in index, ignored by v3 selector
              version: "9.9.9",
              apiVersion: 2,
              platforms: ["web", "android"],
              zipUrl: "https://market.example/skbird-9.9.9.zip",
              sha256: SHA_A,
              size: 1024,
              publishedAt: "2026-01-01T00:00:00Z",
            },
            {
              version: "2.0.0",
              apiVersion: PLUGIN_API_VERSION,
              minAppVersion: "0.16.0",
              platforms: ["web", "android"],
              zipUrl: "https://market.example/skbird-2.0.0.zip",
              sha256: SHA_B,
              size: 2048,
              publishedAt: "2026-11-18T00:00:00Z",
            },
          ],
        },
        {
          id: "community.android-only",
          name: "Android Only",
          summary: "Requires Android + geolocation",
          author: "orahako",
          categories: ["native"],
          versions: [
            {
              version: "1.0.0",
              apiVersion: PLUGIN_API_VERSION,
              platforms: ["android"],
              nativeCapabilities: ["native.geolocation@1"],
              zipUrl: "https://market.example/android-1.0.0.zip",
              sha256: SHA_A,
              size: 512,
              publishedAt: "2026-11-18T00:00:00Z",
            },
          ],
        },
      ],
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(marketPayload), { status: 200 }))
    )

    const applyBundleSpy = vi.fn(
      async (pluginIds: readonly string[], _index: MarketplaceIndex): Promise<PluginManifest> => ({
        id: pluginIds[0]!,
        name: "Skbird",
        version: "2.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      })
    )
    const packageRuntime = createMockPackageRuntime({
      applyPluginBundle: applyBundleSpy,
      nativeCapabilities: () => ["native.files@1"],
    })

    const runtime = new PluginRuntime()
    let installer!: PluginInstallerService

    const consumer = definePlugin({
      manifest: {
        id: "plugin.market-ui",
        name: "Market UI",
        version: "1.0.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
        inject: ["plugins"],
      },
      inject: ["plugins"] as const,
      apply(ctx) {
        installer = ctx.plugins
      },
    })

    try {
      runtime.context.set("packageRuntime", packageRuntime)
      runtime.register(installerRuntimePlugin, "builtin", {
        marketUrl: "https://market.example/plugins.json",
        appVersion: "0.16.0",
      })
      runtime.register(consumer, "builtin")

      await runtime.startAndWait(installerRuntimePlugin.manifest.id)
      await runtime.startAndWait(consumer.manifest.id)

      const installed = await installer.installFromMarket("community.skbird")
      expect(installed).toMatchObject({ id: "community.skbird", version: "2.0.0" })
      expect(applyBundleSpy).toHaveBeenCalledTimes(1)
      expect(applyBundleSpy.mock.calls[0]?.[0]).toEqual(["community.skbird"])

      // Unknown plugin throws
      await expect(installer.installFromMarket("community.unknown")).rejects.toThrow(
        "Plugin not found in market: community.unknown"
      )

      // Android-only + missing native capability throws on Web
      await expect(installer.installFromMarket("community.android-only")).rejects.toThrow(
        "No compatible release for plugin community.android-only (app 0.16.0, platform web)"
      )

      // Even on Android, missing native.geolocation@1 rejects cleanly
      vi.spyOn(Capacitor, "isNativePlatform").mockReturnValue(true)
      await expect(installer.installFromMarket("community.android-only")).rejects.toThrow(
        "No compatible release for plugin community.android-only (app 0.16.0, platform android)"
      )
    } finally {
      runtime.dispose()
    }
  })

  it("validates installerRuntimePlugin configSchema and supports direct createMarketPluginInstaller", async () => {
    const runtime = new PluginRuntime()
    try {
      runtime.context.set("packageRuntime", createMockPackageRuntime())
      runtime.register(installerRuntimePlugin, "builtin", {})
      await expect(runtime.startAndWait(installerRuntimePlugin.manifest.id)).rejects.toThrow()
    } finally {
      runtime.dispose()
    }

    const direct = createMarketPluginInstaller({
      marketUrl: "https://market.example/index.json",
      appVersion: "1.0.0",
      platform: () => "android",
      nativeCapabilities: ["native.geolocation@1"],
      loadMarket: async () => ({
        index: {
          schemaVersion: 1,
          updatedAt: "2026-11-18T00:00:00Z",
          plugins: [
            {
              id: "plugin.geo",
              name: "Geo",
              summary: "",
              author: "test",
              categories: [],
              versions: [
                {
                  version: "1.2.0",
                  apiVersion: PLUGIN_API_VERSION,
                  platforms: ["android"],
                  nativeCapabilities: ["native.geolocation@1"],
                  zipUrl: "https://market.example/geo.zip",
                  sha256: SHA_A,
                  size: 100,
                  publishedAt: "2026-11-18T00:00:00Z",
                },
              ],
            },
          ],
        },
      }),
      applyBundle: async (ids) => ({
        id: ids[0]!,
        name: "Geo",
        version: "1.2.0",
        apiVersion: PLUGIN_API_VERSION,
        kind: "feature",
        entry: "index.js",
      }),
    })

    const manifest = await direct.installFromMarket("plugin.geo")
    expect(manifest.version).toBe("1.2.0")

    // Verify full PluginHost CompositionPlugin compatibility
    const compositionPlugins: readonly CompositionPlugin[] = [
      assetsRuntimePlugin,
      installerRuntimePlugin,
    ]
    const host = new PluginHost({
      appVersion: "1.0.0",
      appBuild: "build-1",
      composition: {
        id: "test.io-packages",
        version: 1,
        defaults: {},
        plugins: [
          { id: assetsRuntimePlugin.manifest.id },
          {
            id: installerRuntimePlugin.manifest.id,
            config: { marketUrl: "https://market.example/index.json", appVersion: "1.0.0" },
          },
        ],
      },
      plugins: compositionPlugins,
    })
    try {
      await host.bootstrap()
      expect(host.runtime.get(assetsRuntimePlugin.manifest.id)?.status).toBe("active")
      expect(host.runtime.get(installerRuntimePlugin.manifest.id)?.status).toBe("active")
    } finally {
      host.dispose()
    }
  })
})
