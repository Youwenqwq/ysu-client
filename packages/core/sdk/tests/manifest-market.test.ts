import { describe, expect, it } from "vitest"
import {
  findAvailableUpdates,
  PLATFORM_MODULES,
  PLUGIN_API_VERSION,
  PluginManifestError,
  selectCompatibleRelease,
  validateMarketplaceIndex,
  validatePluginManifest,
  type MarketplaceIndex,
  type MarketplacePlugin,
} from "@orahako/sdk"

describe("manifest v3 & platform modules", () => {
  it("pins PLUGIN_API_VERSION to 3 and exports exact PLATFORM_MODULES", () => {
    expect(PLUGIN_API_VERSION).toBe(3)
    expect(PLATFORM_MODULES).toEqual([
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "sonner",
      "@orahako/sdk",
      "@orahako/ui-primitives",
    ])
  })

  it("validates a complete API v3 manifest and rejects v2 manifests", () => {
    const valid = validatePluginManifest({
      id: "orahako.schedule",
      name: "Schedule",
      version: "1.2.0",
      apiVersion: 3,
      kind: "feature",
      entry: "dist/index.js",
      styles: ["dist/tailwind.css"],
      icon: "assets/icon.svg",
      categories: ["academic"],
      inject: ["ui", "storage"],
      provides: ["schedule"],
      requires: { "orahako.core": "^1.0.0" },
      nativeCapabilities: ["widgets.schedule@1"],
      configSchema: { type: "object", properties: { defaultWeek: { type: "number" } } },
      required: false,
      providerIndependent: true,
    })

    expect(valid.apiVersion).toBe(3)
    expect(valid.id).toBe("orahako.schedule")

    expect(() =>
      validatePluginManifest({
        id: "legacy.plugin",
        name: "Legacy",
        version: "1.0.0",
        apiVersion: 2,
        kind: "feature",
        entry: "index.js",
      })
    ).toThrow(PluginManifestError)
  })

  it("rejects self-dependencies, unsafe paths, and malformed capability references", () => {
    expect(() =>
      validatePluginManifest({
        id: "bad.plugin",
        name: "Bad",
        version: "1.0.0",
        apiVersion: 3,
        kind: "feature",
        entry: "../escape.js",
        requires: { "bad.plugin": "^1.0.0" },
        nativeCapabilities: ["unversioned"],
      })
    ).toThrow(/entry must be a safe relative|must not depend on itself|nativeCapabilities/)
  })
})

describe("marketplace index validation & v3 release selection", () => {
  const mixedPlugin: MarketplacePlugin = {
    id: "zmu.provider",
    name: "ZMU Provider",
    summary: "ZMU",
    author: "Orahako",
    categories: ["provider"],
    versions: [
      {
        version: "3.0.0",
        apiVersion: 2,
        platforms: ["web", "android"],
        zipUrl: "/plugins/zmu-3.0.0-v2.zip",
        sha256: "a".repeat(64),
        size: 1024,
        publishedAt: "2026-11-18T00:00:00Z",
      },
      {
        version: "2.2.0",
        apiVersion: 3,
        minAppVersion: "0.20.0",
        platforms: ["web", "android"],
        zipUrl: "/plugins/zmu-2.2.0.zip",
        sha256: "b".repeat(64),
        size: 1024,
        publishedAt: "2026-11-17T00:00:00Z",
      },
      {
        version: "2.1.0",
        apiVersion: 3,
        minAppVersion: "0.16.0",
        platforms: ["web"],
        nativeCapabilities: ["widgets.generic@1"],
        zipUrl: "/plugins/zmu-2.1.0.zip",
        sha256: "c".repeat(64),
        size: 1024,
        publishedAt: "2026-11-16T00:00:00Z",
      },
      {
        version: "2.0.0",
        apiVersion: 3,
        platforms: ["web", "android"],
        zipUrl: "/plugins/zmu-2.0.0.zip",
        sha256: "d".repeat(64),
        size: 1024,
        publishedAt: "2026-11-15T00:00:00Z",
      },
    ],
  }

  const marketJson: MarketplaceIndex = {
    schemaVersion: 1,
    updatedAt: "2026-11-18T00:00:00Z",
    plugins: [mixedPlugin],
    bundles: [
      {
        id: "zmu.bundle",
        name: "ZMU Bundle",
        schoolId: "zmu",
        pluginIds: ["zmu.provider"],
      },
    ],
  }

  it("accepts historical positive-integer apiVersion releases in validateMarketplaceIndex", () => {
    const parsed = validateMarketplaceIndex(marketJson)
    expect(parsed.plugins[0]?.versions.map((v) => v.apiVersion)).toEqual([2, 3, 3, 3])

    expect(() =>
      validateMarketplaceIndex({
        ...marketJson,
        plugins: [
          {
            ...mixedPlugin,
            versions: [{ ...mixedPlugin.versions[0], apiVersion: 0 }],
          },
        ],
      })
    ).toThrow("Invalid release")
  })

  it("strictly filters release.apiVersion === 3 in selectCompatibleRelease and findAvailableUpdates", () => {
    // 3.0.0 has apiVersion 2 -> must be ignored!
    // 2.2.0 requires app 0.20.0 -> ignored on 0.16.0!
    // 2.1.0 requires widgets.generic@1 -> selected when capability is present on web!
    const withCap = selectCompatibleRelease(mixedPlugin, "0.16.0", "web", ["widgets.generic@1"])
    expect(withCap?.version).toBe("2.1.0")
    expect(withCap?.apiVersion).toBe(3)

    // Without widgets.generic@1, falls back to 2.0.0 (apiVersion 3)
    const withoutCap = selectCompatibleRelease(mixedPlugin, "0.16.0", "web", [])
    expect(withoutCap?.version).toBe("2.0.0")

    // Updates never suggest the 3.0.0 v2 release when 2.0.0 is installed without capabilities
    expect(
      findAvailableUpdates(marketJson, [{ id: "zmu.provider", version: "2.0.0" }], "0.16.0", "web")
    ).toEqual([])

    // With capability available, suggests 2.1.0 (v3)
    const updates = findAvailableUpdates(
      marketJson,
      [{ id: "zmu.provider", version: "2.0.0" }],
      "0.16.0",
      "web",
      ["widgets.generic@1"]
    )
    expect(updates).toHaveLength(1)
    expect(updates[0]?.release.version).toBe("2.1.0")
  })
})
