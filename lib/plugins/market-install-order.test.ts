import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  MarketplaceIndex,
  PluginDefinition,
  PluginManifest,
  PluginPlatform,
} from "@orahako/plugin-sdk"
import { PluginHost } from "./host"

// The dependency-order contract is owned by the host, not the UI barrels it
// publishes to external plugins. Stubbing those keeps this integration test
// independent of shell/provider-hook refactors elsewhere in the tree.
vi.mock("@orahako/plugin-ui/components", () => ({}))
vi.mock("@orahako/plugin-ui/hooks", () => ({}))
vi.mock("@orahako/plugin-ui/stores", () => ({}))
vi.mock("@orahako/plugin-ui/academic", () => ({}))
vi.mock("@orahako/plugin-ui/platform", () => ({}))
vi.mock("@orahako/plugin-ui/plugin", () => ({}))
vi.mock("@orahako/plugin-ui/shell", () => ({}))
vi.mock("@orahako/plugin-ui/assets", () => ({}))
vi.mock("@orahako/academic", () => ({}))

interface ReleaseFixture {
  id: string
  requires?: Record<string, string>
  inject?: string[]
  provides?: string[]
}

function releaseFor(id: string, fixture: ReleaseFixture) {
  return {
    version: "1.0.0",
    apiVersion: 2,
    platforms: ["web", "android"] as PluginPlatform[],
    inject: fixture.inject,
    provides: fixture.provides,
    requires: fixture.requires,
    zipUrl: `/plugins/${id}.zip`,
    sha256: "a".repeat(64),
    size: 100,
    publishedAt: "2026-11-16T00:00:00Z",
  }
}

function indexOf(fixtures: readonly ReleaseFixture[]): MarketplaceIndex {
  return {
    schemaVersion: 1,
    updatedAt: "2026-11-16T00:00:00Z",
    plugins: fixtures.map((fixture) => ({
      id: fixture.id,
      name: fixture.id,
      summary: fixture.id,
      author: "Test",
      categories: ["feature"],
      versions: [releaseFor(fixture.id, fixture)],
    })),
  }
}

function manifestFor(fixture: ReleaseFixture): PluginManifest {
  return {
    id: fixture.id,
    name: fixture.id,
    version: "1.0.0",
    apiVersion: 2,
    kind: "feature",
    entry: "index.js",
    requires: fixture.requires,
    inject: fixture.inject,
    provides: fixture.provides,
  }
}

function definitionFor(fixture: ReleaseFixture): PluginDefinition {
  return (ctx) => {
    for (const service of fixture.provides ?? []) {
      ctx.set(service, { providedBy: fixture.id })
    }
  }
}

function createHost(): PluginHost {
  return new PluginHost({
    appVersion: "0.0.0",
    appBuild: "test",
    composition: {
      id: "test.composition",
      version: 1,
      defaults: {},
      market: { indexUrl: "https://market.example.com/plugins/index.json" },
      plugins: [],
    },
    plugins: [],
  })
}

function installRecorder(host: PluginHost, fixtures: readonly ReleaseFixture[]) {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]))
  const order: string[] = []
  vi.spyOn(host.packages, "list").mockResolvedValue([])
  vi.spyOn(host, "installFromUrl").mockImplementation(async (_url, _sha, expected) => {
    const fixture = byId.get(expected.id)
    if (!fixture) throw new Error(`Unknown fixture: ${expected.id}`)
    order.push(expected.id)
    const manifest = manifestFor(fixture)
    host.runtime.register(manifest, definitionFor(fixture), "external")
    await host.runtime.startAndWait(manifest.id)
    return manifest
  })
  return order
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("recursive market dependency installation order", () => {
  it("installs package and service providers depth-first before their consumers", async () => {
    const fixtures: ReleaseFixture[] = [
      {
        id: "app.leaf",
        inject: ["audit"],
      },
      {
        id: "app.audit",
        provides: ["audit"],
      },
      {
        id: "app.mid",
        requires: { "app.leaf": "^1.0.0" },
        inject: ["metrics"],
      },
      {
        id: "app.metrics",
        provides: ["metrics"],
        requires: { "app.audit": "^1.0.0" },
      },
      {
        id: "app.telemetry",
        provides: ["telemetry"],
        requires: { "app.audit": "^1.0.0" },
      },
      {
        id: "app.root",
        requires: { "app.mid": "^1.0.0" },
        inject: ["telemetry"],
      },
    ]
    const host = createHost()
    const order = installRecorder(host, fixtures)

    try {
      await host.applyPluginBundle(["app.root"], indexOf(fixtures))

      expect(order).toEqual([
        "app.audit",
        "app.leaf",
        "app.metrics",
        "app.mid",
        "app.telemetry",
        "app.root",
      ])
      expect(order.filter((id) => id === "app.audit")).toHaveLength(1)
      for (const id of order) {
        expect(host.runtime.get(id)?.status).toBe("active")
      }
    } finally {
      host.runtime.dispose()
    }
  })

  it("installs a shared transitive dependency once for a diamond graph", async () => {
    const fixtures: ReleaseFixture[] = [
      { id: "app.shared" },
      { id: "app.left", requires: { "app.shared": "^1.0.0" } },
      { id: "app.right", requires: { "app.shared": "^1.0.0" } },
      {
        id: "app.top",
        requires: { "app.left": "^1.0.0", "app.right": "^1.0.0" },
      },
    ]
    const host = createHost()
    const order = installRecorder(host, fixtures)

    try {
      await host.applyPluginBundle(["app.top"], indexOf(fixtures))

      expect(order).toEqual(["app.shared", "app.left", "app.right", "app.top"])
      expect(order.filter((id) => id === "app.shared")).toHaveLength(1)
    } finally {
      host.runtime.dispose()
    }
  })

  it("rejects dependency cycles before installing any member", async () => {
    const fixtures: ReleaseFixture[] = [
      { id: "app.first", requires: { "app.second": "^1.0.0" } },
      { id: "app.second", requires: { "app.first": "^1.0.0" } },
    ]
    const host = createHost()
    const order = installRecorder(host, fixtures)

    try {
      await expect(
        host.applyPluginBundle(["app.first"], indexOf(fixtures))
      ).rejects.toThrow("Plugin dependency cycle detected: app.first")
      expect(order).toEqual([])
    } finally {
      host.runtime.dispose()
    }
  })
})
