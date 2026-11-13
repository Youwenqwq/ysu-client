import { afterEach, describe, expect, it, vi } from "vitest"
import type { MarketplaceIndex, PluginManifest } from "@orahako/plugin-sdk"
import { createMarketPluginInstaller, PluginHost } from "./host"
import { PLUGIN_MARKET_URL } from "./market"
import { usePluginPreferences } from "@/lib/stores/plugin-preferences"

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

function bundleIndex(): MarketplaceIndex {
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
            platforms: ["web", "android"],
            zipUrl: "/plugins/zmu-1.1.0.zip",
            sha256: "b".repeat(64),
            size: 100,
            publishedAt: "2026-11-12T00:00:00Z",
          },
        ],
      },
    ],
    bundles: [
      {
        id: "ysu.recommended",
        name: "YSU Recommended",
        schoolId: "ysu",
        pluginIds: ["bundle.active", "bundle.pending", "zmu.provider"],
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

function lifecycleManifest(
  id: string,
  kind: PluginManifest["kind"] = "feature",
  required = false
): PluginManifest {
  return { id, name: id, version: "1.0.0", apiVersion: 1, kind, entry: "index.js", required }
}

describe("Provider-scoped plugin lifecycle", () => {
  it("stops unsupported features and restores only provider-stopped plugins", async () => {
    const host = new PluginHost()
    const manifests = [
      lifecycleManifest("test.supported"),
      lifecycleManifest("test.unsupported"),
      lifecycleManifest("test.required", "feature", true),
      lifecycleManifest("test.shell", "shell", true),
      lifecycleManifest("test.provider", "provider"),
      lifecycleManifest("test.theme", "theme"),
    ]
    try {
      for (const manifest of manifests) {
        host.runtime.register(manifest, () => {}, "builtin")
        host.runtime.start(manifest.id)
      }
      await host.reconcileProviderSupport(["test.supported"])
      expect(host.runtime.get("test.supported")?.status).toBe("active")
      expect(host.runtime.get("test.unsupported")?.status).toBe("disabled")
      for (const id of ["test.required", "test.shell", "test.provider", "test.theme"]) {
        expect(host.runtime.get(id)?.status).toBe("active")
      }

      await host.reconcileProviderSupport(undefined)
      expect(host.runtime.get("test.unsupported")?.status).toBe("active")
    } finally {
      host.runtime.dispose()
    }
  })

  it("does not restore a plugin the user disabled while its provider was inactive", async () => {
    const host = new PluginHost()
    const manifest = lifecycleManifest("test.user-disabled")
    usePluginPreferences.getState().setPluginDisabled(manifest.id, false)
    try {
      host.runtime.register(manifest, () => {}, "builtin")
      host.runtime.start(manifest.id)
      await host.reconcileProviderSupport([])
      usePluginPreferences.getState().setPluginDisabled(manifest.id, true)
      await host.reconcileProviderSupport(undefined)
      expect(host.runtime.get(manifest.id)?.status).toBe("disabled")
    } finally {
      usePluginPreferences.getState().setPluginDisabled(manifest.id, false)
      host.runtime.dispose()
    }
  })
})

describe("PluginHost.applyPluginBundle", () => {
  it("enables registered plugins and installs missing ones from the bundle", async () => {
    const host = new PluginHost()
    vi.spyOn(host.packages, "list").mockResolvedValue([])
    const installFromUrl = vi.spyOn(host, "installFromUrl").mockResolvedValue(installedManifest)
    const index = bundleIndex()
    const bundle = index.bundles?.find((entry) => entry.id === "ysu.recommended")
    if (!bundle) throw new Error("bundle fixture is missing")
    try {
      host.runtime.register(lifecycleManifest("bundle.active"), () => {}, "builtin")
      host.runtime.start("bundle.active")
      host.runtime.register(lifecycleManifest("bundle.pending"), () => {}, "builtin")

      await host.applyPluginBundle(bundle.pluginIds, index)

      expect(host.runtime.get("bundle.active")?.status).toBe("active")
      expect(host.runtime.get("bundle.pending")?.status).toBe("active")
      expect(installFromUrl).toHaveBeenCalledTimes(1)
      expect(installFromUrl).toHaveBeenCalledWith(
        new URL("/plugins/zmu-1.1.0.zip", PLUGIN_MARKET_URL).toString(),
        "b".repeat(64),
        { id: "zmu.provider", version: "1.1.0" }
      )
    } finally {
      host.runtime.dispose()
    }
  })

  it("loads installed packages that the runtime has not registered yet", async () => {
    const host = new PluginHost()
    vi.spyOn(host.packages, "list").mockResolvedValue([
      { manifest: installedManifest, installedAt: 1, fileCount: 1, byteSize: 10 },
    ])
    const load = vi
      .spyOn(
        host as unknown as {
          load: (id: string, replaceActive: boolean) => Promise<void>
        },
        "load"
      )
      .mockResolvedValue(undefined)
    const installFromUrl = vi.spyOn(host, "installFromUrl")
    try {
      await host.applyPluginBundle([installedManifest.id], bundleIndex())

      expect(load).toHaveBeenCalledWith(installedManifest.id, true)
      expect(installFromUrl).not.toHaveBeenCalled()
    } finally {
      host.runtime.dispose()
    }
  })

  it("rejects plugins unsupported by the active school before changing anything", async () => {
    const host = new PluginHost()
    vi.spyOn(host.packages, "list").mockResolvedValue([])
    const installFromUrl = vi.spyOn(host, "installFromUrl").mockResolvedValue(installedManifest)
    const index = bundleIndex()
    try {
      host.runtime.register(lifecycleManifest("bundle.unsupported"), () => {}, "builtin")
      await host.reconcileProviderSupport(["bundle.active"])

      await expect(
        host.applyPluginBundle(["bundle.unsupported", "zmu.provider"], index)
      ).rejects.toThrow("Plugin not supported by the active school: bundle.unsupported")
      expect(host.runtime.get("bundle.unsupported")?.status).toBe("disabled")
      expect(installFromUrl).not.toHaveBeenCalled()
    } finally {
      host.runtime.dispose()
    }
  })

  it("rejects unavailable bundle plugins before enabling the rest", async () => {
    const host = new PluginHost()
    vi.spyOn(host.packages, "list").mockResolvedValue([])
    const installFromUrl = vi.spyOn(host, "installFromUrl")
    const index = { ...bundleIndex(), plugins: [] }
    try {
      host.runtime.register(lifecycleManifest("bundle.pending"), () => {}, "builtin")

      await expect(
        host.applyPluginBundle(["bundle.pending", "bundle.missing"], index)
      ).rejects.toThrow("Plugin not found in market: bundle.missing")
      expect(host.runtime.get("bundle.pending")?.status).toBe("registered")
      expect(installFromUrl).not.toHaveBeenCalled()
    } finally {
      host.runtime.dispose()
    }
  })

  it("rejects market releases that do not support the current platform", async () => {
    const host = new PluginHost()
    vi.spyOn(host.packages, "list").mockResolvedValue([])
    const installFromUrl = vi.spyOn(host, "installFromUrl")
    const index = bundleIndex()
    index.plugins[0].versions[0].platforms = ["android"]
    try {
      await expect(host.applyPluginBundle(["zmu.provider"], index)).rejects.toThrow(
        "No compatible release for plugin zmu.provider"
      )
      expect(installFromUrl).not.toHaveBeenCalled()
    } finally {
      host.runtime.dispose()
    }
  })
})
