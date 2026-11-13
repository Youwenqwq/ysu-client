import { describe, expect, it } from "vitest"
import type { MarketplacePlugin } from "@orahako/plugin-sdk"
import { findAvailableUpdates, selectCompatibleRelease, validateMarketplaceIndex } from "./market"

const plugin: MarketplacePlugin = {
  id: "example.theme",
  name: "Example",
  summary: "Theme",
  author: "Example",
  categories: ["theme"],
  versions: [
    {
      version: "1.1.0",
      apiVersion: 1,
      minAppVersion: "0.16.0",
      platforms: ["web", "android"],
      zipUrl: "https://example.com/plugin.zip",
      sha256: "a".repeat(64),
      size: 100,
      publishedAt: "2026-11-12T00:00:00Z",
    },
    {
      version: "1.0.0",
      apiVersion: 1,
      platforms: ["web"],
      zipUrl: "https://example.com/plugin-old.zip",
      sha256: "b".repeat(64),
      size: 100,
      publishedAt: "2026-11-01T00:00:00Z",
    },
  ],
}

describe("plugin market", () => {
  it("selects the newest release compatible with app and platform", () => {
    expect(selectCompatibleRelease(plugin, "0.15.0", "web")?.version).toBe("1.0.0")
    expect(selectCompatibleRelease(plugin, "0.16.0", "web")?.version).toBe("1.1.0")
    expect(selectCompatibleRelease(plugin, "0.15.0", "android")).toBeUndefined()
  })

  it("reports updates only for installed plugins with a compatible newer release", () => {
    const index = { schemaVersion: 1 as const, updatedAt: "2026-11-13", plugins: [plugin] }
    expect(
      findAvailableUpdates(index, [{ id: plugin.id, version: "0.9.0" }], "0.15.0", "web")
    ).toMatchObject([{ currentVersion: "0.9.0", release: { version: "1.0.0" } }])
    expect(
      findAvailableUpdates(index, [{ id: plugin.id, version: "1.0.0" }], "0.15.0", "web")
    ).toEqual([])
    expect(
      findAvailableUpdates(index, [{ id: plugin.id, version: "0.9.0" }], "0.15.0", "android")
    ).toEqual([])
    expect(
      findAvailableUpdates(index, [{ id: "uninstalled", version: "0.1.0" }], "0.15.0", "web")
    ).toEqual([])
  })

  it("rejects malformed release hashes and versions", () => {
    expect(() =>
      validateMarketplaceIndex({
        schemaVersion: 1,
        updatedAt: "2026-11-12T00:00:00Z",
        plugins: [{ ...plugin, versions: [{ ...plugin.versions[0], sha256: "invalid" }] }],
      })
    ).toThrow("Invalid release")
  })
})
