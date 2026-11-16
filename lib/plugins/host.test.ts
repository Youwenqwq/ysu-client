import { afterEach, describe, expect, it, vi } from "vitest"
import {
  definePlugin,
  type CompositionPlugin,
  type CompositionSource,
  type MarketplaceIndex,
  type PluginConfig,
  type PluginManifest,
  type PluginPackageRuntime,
} from "@orahako/plugin-sdk"
import { createMarketPluginInstaller } from "@/plugins/official/runtime/market-installer"
import { PluginHost } from "./host"
import { PluginUIRegistry } from "@/plugins/official/runtime/registries/ui"

import { usePluginPreferences } from "@/lib/stores/plugin-preferences"

const MARKET_INDEX_URL = "https://market.example.com/plugins/index.json"

const externalThemeManifest: PluginManifest = {
  id: "test.theme.external",
  name: "External test theme",
  version: "1.0.0",
  apiVersion: 2,
  kind: "theme",
  entry: "index.js",
  inject: ["ui"],
}
const externalThemeDefinition = definePlugin((ctx) => {
  ctx.ui.registerTheme({ id: "external", name: "External", css: "" })
})

const installedManifest: PluginManifest = {
  id: "zmu.provider",
  name: "ZMU",
  version: "1.1.0",
  apiVersion: 2,
  kind: "provider",
  entry: "index.js",
}

/** Minimal root-service module, standing in for the official registry composition. */
const uiRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "test.runtime.ui",
    name: "UI registry",
    version: "1.0.0",
    apiVersion: 2,
    kind: "runtime",
    entry: "index.js",
    provides: ["ui"],
  },
  definition: definePlugin((ctx) => {
    ctx.set("ui", new PluginUIRegistry())
  }),
}

/** Minimal installer module; the full official composition is not imported. */
const installerRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "test.runtime.installer",
    name: "Market installer",
    version: "1.0.0",
    apiVersion: 2,
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

interface HostOptions {
  plugins?: readonly CompositionPlugin[]
  configs?: Record<string, PluginConfig>
  market?: string
}

function composition({
  plugins = [],
  configs = {},
  market = MARKET_INDEX_URL,
}: HostOptions = {}): CompositionSource {
  return {
    appVersion: "0.16.0",
    appBuild: "test",
    composition: {
      id: "test.composition",
      version: 1,
      defaults: {},
      market: { indexUrl: market },
      plugins: plugins.map((plugin) => ({
        id: plugin.manifest.id,
        config: configs[plugin.manifest.id],
      })),
    },
    plugins,
  }
}

function createHost(options: HostOptions = {}): PluginHost {
  return new PluginHost(composition(options))
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
            apiVersion: 2,
            minAppVersion: "0.20.0",
            platforms: ["web"],
            zipUrl: "/plugins/zmu-2.0.0.zip",
            sha256: "a".repeat(64),
            size: 100,
            publishedAt: "2026-11-13T00:00:00Z",
          },
          {
            version: "1.1.0",
            apiVersion: 2,
            minAppVersion: "0.16.0",
            platforms: ["web"],
            zipUrl: "/plugins/zmu-1.1.0.zip",
            sha256: "b".repeat(64),
            size: 100,
            publishedAt: "2026-11-12T00:00:00Z",
          },
          {
            version: "1.0.0",
            apiVersion: 2,
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
            apiVersion: 2,
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
            apiVersion: 2,
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

describe("PluginHost external host modules", () => {
  it("exports crypto helpers and scoped services to external ZIP modules", async () => {
    const blobs = new Map<string, Blob>()
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      if (!(blob instanceof Blob)) throw new TypeError("Expected Blob")
      const url = `blob:test-${blobs.size}`
      blobs.set(url, blob)
      return url
    })
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    const host = createHost()
    const registry = host.getHostModules()
    const cryptoUrl = registry.resolve("@orahako/plugin-sdk/crypto")
    const servicesUrl = registry.resolve("@orahako/plugin-ui/services")
    expect(cryptoUrl).toBeTypeOf("string")
    expect(servicesUrl).toBeTypeOf("string")
    const cryptoSource = await blobs.get(cryptoUrl!)!.text()
    const servicesSource = await blobs.get(servicesUrl!)!.text()
    expect(cryptoSource).toContain("aes128EcbEncrypt")
    expect(cryptoSource).toContain("bytesToBase64")
    expect(servicesSource).toContain("usePluginServices")
    registry.dispose()
  })
})

describe("ctx.plugins.installFromMarket", () => {
  it("installs the newest release compatible with the app and platform", async () => {
    const applyBundle = vi.fn(async () => installedManifest)
    const installer = createMarketPluginInstaller({
      marketUrl: MARKET_INDEX_URL,
      applyBundle,
      loadMarket: async () => ({ index: marketIndex() }),
      appVersion: "0.16.0",
      platform: () => "web",
    })

    await expect(installer.installFromMarket("zmu.provider")).resolves.toBe(installedManifest)
    expect(applyBundle).toHaveBeenCalledWith(["zmu.provider"], expect.anything())
  })

  it("selects the android-compatible release and keeps absolute URLs", async () => {
    const applyBundle = vi.fn(async () => installedManifest)
    const installer = createMarketPluginInstaller({
      marketUrl: MARKET_INDEX_URL,
      applyBundle,
      loadMarket: async () => ({ index: marketIndex() }),
      appVersion: "0.16.0",
      platform: () => "android",
    })

    await installer.installFromMarket("zmu.provider")
    expect(applyBundle).toHaveBeenCalledWith(["zmu.provider"], expect.anything())
  })

  it("reports unknown plugins without downloading", async () => {
    const applyBundle = vi.fn(async () => installedManifest)
    const installer = createMarketPluginInstaller({
      marketUrl: MARKET_INDEX_URL,
      applyBundle,
      loadMarket: async () => ({ index: marketIndex() }),
      appVersion: "0.16.0",
      platform: () => "web",
    })

    await expect(installer.installFromMarket("missing.plugin")).rejects.toThrow(
      "Plugin not found in market: missing.plugin"
    )
    expect(applyBundle).not.toHaveBeenCalled()
  })

  it("reports releases incompatible with the current platform", async () => {
    const applyBundle = vi.fn(async () => installedManifest)
    const installer = createMarketPluginInstaller({
      marketUrl: MARKET_INDEX_URL,
      applyBundle,
      loadMarket: async () => ({ index: webOnlyIndex() }),
      appVersion: "0.16.0",
      platform: () => "android",
    })

    await expect(installer.installFromMarket("zmu.provider")).rejects.toThrow(
      "No compatible release for plugin zmu.provider (app 0.16.0, platform android)"
    )
    expect(applyBundle).not.toHaveBeenCalled()
  })

  it("reports releases that need native capabilities the composition omits", async () => {
    const applyBundle = vi.fn(async () => installedManifest)
    const index = webOnlyIndex()
    const release = index.plugins[0]?.versions[0]
    if (!release) throw new Error("market fixture is missing the release")
    release.nativeCapabilities = ["camera@2"]
    const installer = createMarketPluginInstaller({
      marketUrl: MARKET_INDEX_URL,
      applyBundle,
      loadMarket: async () => ({ index }),
      appVersion: "0.16.0",
      platform: () => "web",
      nativeCapabilities: ["file@1"],
    })

    await expect(installer.installFromMarket("zmu.provider")).rejects.toThrow(
      "No compatible release for plugin zmu.provider"
    )
    expect(applyBundle).not.toHaveBeenCalled()
  })

  it("exposes the installer to plugins that inject the root service", async () => {
    const host = createHost({
      plugins: [installerRuntimePlugin],
      configs: {
        [installerRuntimePlugin.manifest.id]: {
          marketUrl: MARKET_INDEX_URL,
          appVersion: "0.16.0",
        },
      },
    })
    vi.spyOn(host.packages, "list").mockResolvedValue([])
    const installFromUrl = vi.spyOn(host, "installFromUrl").mockImplementation(async () => {
      host.runtime.register(installedManifest, () => {}, "external")
      await host.runtime.startAndWait(installedManifest.id)
      return installedManifest
    })
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
              apiVersion: 2,
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
        apiVersion: 2,
        kind: "feature",
        entry: "index.js",
        inject: ["plugins"],
      },
      async (ctx) => {
        received = await ctx.plugins.installFromMarket("zmu.provider")
      },
      "builtin"
    )

    try {
      host.runtime.register(
        installerRuntimePlugin.manifest,
        installerRuntimePlugin.definition,
        "builtin",
        { marketUrl: MARKET_INDEX_URL, appVersion: "0.16.0" }
      )
      host.runtime.start(installerRuntimePlugin.manifest.id)
      await host.runtime.startAndWait("test.market-initializer")
      expect(received).toBe(installedManifest)
      expect(installFromUrl).toHaveBeenCalledWith(
        new URL("/plugins/zmu-1.1.0.zip", MARKET_INDEX_URL).toString(),
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
  return { id, name: id, version: "1.0.0", apiVersion: 2, kind, entry: "index.js", required }
}

describe("PluginHost.applyPluginBundle", () => {
  it("enables registered plugins and installs missing ones from the bundle", async () => {
    const host = createHost()
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
        new URL("/plugins/zmu-1.1.0.zip", MARKET_INDEX_URL).toString(),
        "b".repeat(64),
        { id: "zmu.provider", version: "1.1.0" }
      )
    } finally {
      host.runtime.dispose()
    }
  })

  it("enables installed packages that the runtime has not registered yet", async () => {
    const host = createHost()
    vi.spyOn(host.packages, "list").mockResolvedValue([
      { manifest: installedManifest, installedAt: 1, fileCount: 1, byteSize: 10 },
    ])
    const load = vi
      .spyOn(
        host as unknown as {
          load(id: string, replaceActive: boolean, start?: boolean): Promise<void>
        },
        "load"
      )
      .mockImplementation(async () => {
        host.runtime.register(installedManifest, () => {}, "external")
      })
    const installFromUrl = vi.spyOn(host, "installFromUrl")
    usePluginPreferences.getState().setPluginDisabled(installedManifest.id, true)
    try {
      await host.applyPluginBundle([installedManifest.id], bundleIndex())

      expect(load).toHaveBeenCalledWith(installedManifest.id, false, false)
      expect(host.runtime.get(installedManifest.id)?.status).toBe("active")
      expect(usePluginPreferences.getState().disabledPluginIds).not.toContain(installedManifest.id)
      expect(installFromUrl).not.toHaveBeenCalled()
    } finally {
      usePluginPreferences.getState().setPluginDisabled(installedManifest.id, false)
      host.runtime.dispose()
    }
  })

  it("rejects unavailable bundle plugins before enabling the rest", async () => {
    const host = createHost()
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
    const host = createHost()
    vi.spyOn(host.packages, "list").mockResolvedValue([])
    const installFromUrl = vi.spyOn(host, "installFromUrl")
    const index = bundleIndex()
    const release = index.plugins[0]?.versions[0]
    if (!release) throw new Error("bundle fixture is missing the release")
    release.platforms = ["android"]
    try {
      await expect(host.applyPluginBundle(["zmu.provider"], index)).rejects.toThrow(
        "No compatible release for plugin zmu.provider"
      )
      expect(installFromUrl).not.toHaveBeenCalled()
    } finally {
      host.runtime.dispose()
    }
  })

  it("rejects installing a bundle release when the composition declares no market", async () => {
    const host = createHost({ market: "" })
    vi.spyOn(host.packages, "list").mockResolvedValue([])
    const installFromUrl = vi.spyOn(host, "installFromUrl")
    try {
      await expect(host.applyPluginBundle(["zmu.provider"], bundleIndex())).rejects.toThrow(
        "The active composition does not provide a plugin market"
      )
      expect(installFromUrl).not.toHaveBeenCalled()
    } finally {
      host.runtime.dispose()
    }
  })
})

describe("PluginHost composition", () => {
  it("applies ordered layers before anything starts", () => {
    const host = new PluginHost({
      ...composition({ plugins: [uiRuntimePlugin] }),
      layers: [
        { id: "test.defaults", defaults: { landing: "overview" } },
        {
          id: "test.policy",
          plugins: [{ id: uiRuntimePlugin.manifest.id, disabled: true }],
        },
      ],
    })

    expect(host.composition.defaults).toEqual({ landing: "overview" })
    expect(host.composition.plugins).toEqual([{ id: "test.runtime.ui", disabled: true }])
    expect(host.composition.market).toEqual({ indexUrl: MARKET_INDEX_URL })
  })

  it("rejects a composition entry without a module", () => {
    expect(
      () =>
        new PluginHost({
          appVersion: "0.16.0",
          appBuild: "test",
          composition: {
            id: "test.broken",
            version: 1,
            defaults: {},
            plugins: [{ id: "test.missing" }],
          },
          plugins: [],
        })
    ).toThrow("Composition module is not available: test.missing")
  })

  it("rejects disabling a protected composition entry", () => {
    const host = new PluginHost({
      ...composition({ plugins: [uiRuntimePlugin] }),
      layers: [
        { id: "test.protect", plugins: [{ id: uiRuntimePlugin.manifest.id, protected: true }] },
      ],
    })

    expect(() => host.disable(uiRuntimePlugin.manifest.id)).toThrow(
      "Plugin is protected by the active composition: test.runtime.ui"
    )
  })
})

describe("PluginHost dependency closure", () => {
  it("installs package and service dependencies before the requested plugin", async () => {
    const host = createHost()
    vi.spyOn(host.packages, "list").mockResolvedValue([])
    const index = bundleIndex()
    index.plugins = ["app.consumer", "app.runtime", "app.audit"].map((id) => ({
      id,
      name: id,
      summary: id,
      author: "Test",
      categories: ["runtime"],
      versions: [
        {
          version: "1.0.0",
          apiVersion: 2,
          platforms: ["web"],
          zipUrl: `/plugins/${id}.zip`,
          sha256: "a".repeat(64),
          size: 100,
          publishedAt: "2026-11-13T00:00:00Z",
          inject: id === "app.consumer" ? ["audit"] : undefined,
          provides: id === "app.audit" ? ["audit"] : undefined,
          requires: id === "app.consumer" ? { "app.runtime": "^1.0.0" } : undefined,
        },
      ],
    }))
    const installed: string[] = []
    vi.spyOn(host, "installFromUrl").mockImplementation(async (_url, _sha, expected) => {
      installed.push(expected.id)
      const manifest = lifecycleManifest(expected.id)
      host.runtime.register(manifest, () => {}, "external")
      await host.runtime.startAndWait(expected.id)
      return manifest
    })
    try {
      await host.applyPluginBundle(["app.consumer"], index)
      expect(installed).toEqual(["app.runtime", "app.audit", "app.consumer"])
    } finally {
      host.runtime.dispose()
    }
  })
  it("rejects an installed dependency version before changing the bundle", async () => {
    const host = createHost()
    vi.spyOn(host.packages, "list").mockResolvedValue([])
    host.runtime.register(lifecycleManifest("app.runtime"), () => {}, "builtin")
    await host.runtime.startAndWait("app.runtime")
    const install = vi.spyOn(host, "installFromUrl")
    const index = bundleIndex()
    index.plugins.find((plugin) => plugin.id === "zmu.provider")!.versions[0].requires = {
      "app.runtime": "^2.0.0",
    }
    try {
      await expect(host.applyPluginBundle(["zmu.provider"], index)).rejects.toThrow(
        "does not satisfy ^2.0.0"
      )
      expect(install).not.toHaveBeenCalled()
    } finally {
      host.runtime.dispose()
    }
  })
})

describe("PluginHost.enable after restarting with a disabled external theme", () => {
  it("loads the saved package before starting an unregistered external theme", async () => {
    const host = createHost({ plugins: [uiRuntimePlugin] })
    const previousDisabled = usePluginPreferences.getState().disabledPluginIds
    usePluginPreferences.getState().setPluginDisabled(externalThemeManifest.id, true)
    host.runtime.register(uiRuntimePlugin.manifest, uiRuntimePlugin.definition, "builtin")
    host.runtime.start(uiRuntimePlugin.manifest.id)
    const load = vi
      .spyOn(
        host as unknown as {
          load(id: string, replaceActive: boolean, start?: boolean): Promise<void>
        },
        "load"
      )
      .mockImplementation(async () => {
        host.runtime.register(externalThemeManifest, externalThemeDefinition, "external")
      })
    try {
      expect(host.runtime.get(externalThemeManifest.id)).toBeUndefined()
      await host.enable(externalThemeManifest.id)
      expect(load).toHaveBeenCalledWith(externalThemeManifest.id, false, false)
      expect(host.runtime.get(externalThemeManifest.id)?.status).toBe("active")
      expect(
        host.ui
          .getSnapshot()
          .themes.some(
            (theme) => theme.pluginId === externalThemeManifest.id && theme.id === "external"
          )
      ).toBe(true)
      expect(usePluginPreferences.getState().disabledPluginIds).not.toContain(externalThemeManifest.id)
    } finally {
      host.runtime.dispose()
      usePluginPreferences.setState({ disabledPluginIds: previousDisabled })
    }
  })

  it("retains the disabled preference when the saved package fails to load", async () => {
    const host = createHost({ plugins: [uiRuntimePlugin] })
    const previousDisabled = usePluginPreferences.getState().disabledPluginIds
    usePluginPreferences.getState().setPluginDisabled(externalThemeManifest.id, true)
    vi.spyOn(
      host as unknown as {
        load(id: string, replaceActive: boolean): Promise<void>
      },
      "load"
    ).mockRejectedValue(new Error("Cannot load saved ZIP"))
    try {
      await expect(host.enable(externalThemeManifest.id)).rejects.toThrow("Cannot load saved ZIP")
      expect(usePluginPreferences.getState().disabledPluginIds).toContain(externalThemeManifest.id)
    } finally {
      host.runtime.dispose()
      usePluginPreferences.setState({ disabledPluginIds: previousDisabled })
    }
  })
})
