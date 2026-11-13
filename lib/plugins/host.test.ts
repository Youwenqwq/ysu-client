import { afterEach, describe, expect, it, vi } from "vitest"
import type { MarketplaceIndex, PluginManifest } from "@orahako/plugin-sdk"
import { createMarketPluginInstaller, PluginHost } from "./host"
import { PLUGIN_MARKET_URL } from "./market"

const installedManifest: PluginManifest = {
  id: "zmu.provider",
  name: "ZMU",
  version: "1.1.0",
  apiVersion: 1,
  kind: "provider",
  entry: "index.js",
}

function marketIndex(): MarketplaceIndex {
  return {
    schemaVersion: 1,
    updatedAt: "2026-11-13T00:00:00Z",
    plugins: [
      {
        id: "zmu.provider",
        name: "ZMU",
        summary: "Provider",
        author: "Orahako",
        categories: ["provider"],
        versions: [
          {
            version: "2.0.0",
            apiVersion: 1,
            minAppVersion: "0.20.0",
            platforms: ["web"],
            zipUrl: "/plugins/zmu-2.0.0.zip",
            sha256: "a".repeat(64),
            size: 100,
            publishedAt: "2026-11-13T00:00:00Z",
          },
          {
            version: "1.1.0",
            apiVersion: 1,
            minAppVersion: "0.16.0",
            platforms: ["web"],
            zipUrl: "/plugins/zmu-1.1.0.zip",
            sha256: "b".repeat(64),
            size: 100,
            publishedAt: "2026-11-12T00:00:00Z",
          },
          {
            version: "1.0.0",
            apiVersion: 1,
            platforms: ["web", "android"],
            zipUrl: "https://cdn.example.com/zmu-1.0.0.zip",
            sha256: "c".repeat(64),
            size: 100,
            publishedAt: "2026-11-01T00:00:00Z",
          },
        ],
      },
    ],
  }
}

function webOnlyIndex(): MarketplaceIndex {
  return {
    schemaVersion: 1,
    updatedAt: "2026-11-13T00:00:00Z",
    plugins: [
      {
        id: "zmu.provider",
        name: "ZMU",
        summary: "Provider",
        author: "Orahako",
        categories: ["provider"],
        versions: [
          {
            version: "1.1.0",
            apiVersion: 1,
            platforms: ["web"],
            zipUrl: "/plugins/zmu-1.1.0.zip",
            sha256: "b".repeat(64),
            size: 100,
            publishedAt: "2026-11-12T00:00:00Z",
          },
        ],
      },
    ],
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("ctx.plugins.installFromMarket", () => {
  it("installs the newest release compatible with the app and platform", async () => {
    const installFromUrl = vi.fn(async () => installedManifest)
    const installer = createMarketPluginInstaller({
      installFromUrl,
      loadMarket: async () => ({ index: marketIndex() }),
      appVersion: "0.16.0",
      platform: () => "web",
    })

    await expect(installer.installFromMarket("zmu.provider")).resolves.toBe(installedManifest)
    expect(installFromUrl).toHaveBeenCalledWith(
      new URL("/plugins/zmu-1.1.0.zip", PLUGIN_MARKET_URL).toString(),
      "b".repeat(64),
      { id: "zmu.provider", version: "1.1.0" }
    )
  })

  it("selects the android-compatible release and keeps absolute URLs", async () => {
    const installFromUrl = vi.fn(async () => installedManifest)
    const installer = createMarketPluginInstaller({
      installFromUrl,
      loadMarket: async () => ({ index: marketIndex() }),
      appVersion: "0.16.0",
      platform: () => "android",
    })

    await installer.installFromMarket("zmu.provider")
    expect(installFromUrl).toHaveBeenCalledWith(
      "https://cdn.example.com/zmu-1.0.0.zip",
      "c".repeat(64),
      { id: "zmu.provider", version: "1.0.0" }
    )
  })

  it("reports unknown plugins without downloading", async () => {
    const installFromUrl = vi.fn(async () => installedManifest)
    const installer = createMarketPluginInstaller({
      installFromUrl,
      loadMarket: async () => ({ index: marketIndex() }),
      appVersion: "0.16.0",
      platform: () => "web",
    })

    await expect(installer.installFromMarket("missing.plugin")).rejects.toThrow(
      "Plugin not found in market: missing.plugin"
    )
    expect(installFromUrl).not.toHaveBeenCalled()
  })

  it("reports releases incompatible with the current platform", async () => {
    const installFromUrl = vi.fn(async () => installedManifest)
    const installer = createMarketPluginInstaller({
      installFromUrl,
      loadMarket: async () => ({ index: webOnlyIndex() }),
      appVersion: "0.16.0",
      platform: () => "android",
    })

    await expect(installer.installFromMarket("zmu.provider")).rejects.toThrow(
      "No compatible release for plugin zmu.provider (app 0.16.0, platform android)"
    )
    expect(installFromUrl).not.toHaveBeenCalled()
  })

  it("exposes the installer to builtin plugins through the public context", async () => {
    const host = new PluginHost()
    const installFromUrl = vi.spyOn(host, "installFromUrl").mockResolvedValue(installedManifest)
    const index: MarketplaceIndex = {
      schemaVersion: 1,
      updatedAt: "2026-11-13T00:00:00Z",
      plugins: [
        {
          id: "zmu.provider",
          name: "ZMU",
          summary: "Provider",
          author: "Orahako",
          categories: ["provider"],
          versions: [
            {
              version: "1.1.0",
              apiVersion: 1,
              platforms: ["web", "android"],
              zipUrl: "/plugins/zmu-1.1.0.zip",
              sha256: "b".repeat(64),
              size: 100,
              publishedAt: "2026-11-12T00:00:00Z",
            },
          ],
        },
      ],
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => index }))
    )
    let received: PluginManifest | undefined

    host.runtime.register(
      {
        id: "test.market-initializer",
        name: "Initializer",
        version: "1.0.0",
        apiVersion: 1,
        kind: "feature",
        entry: "index.js",
      },
      async (ctx) => {
        received = await ctx.plugins.installFromMarket("zmu.provider")
      },
      "builtin"
    )

    try {
      await host.runtime.startAndWait("test.market-initializer")
      expect(received).toBe(installedManifest)
      expect(installFromUrl).toHaveBeenCalledWith(
        new URL("/plugins/zmu-1.1.0.zip", PLUGIN_MARKET_URL).toString(),
        "b".repeat(64),
        { id: "zmu.provider", version: "1.1.0" }
      )
    } finally {
      host.runtime.dispose()
    }
  })
})
