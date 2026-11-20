import { afterEach, describe, expect, it, vi } from "vitest"
import { createMemoryPackageBackend, PluginHost, PluginPackageStore } from "@orahako/kernel"
import { composeBundles } from "@orahako/sdk"
import { platformModules } from "../../../../app/composition/platform-modules"
import { platformPlugins } from "../../../../app/composition/plugins"
import { officialCompositionSource } from "../../../../app/composition/source"
import { platformBundle } from "../src"

const appVersion = officialCompositionSource.appVersion
const marketUrl = officialCompositionSource.composition.market?.indexUrl ?? ""
const officialEntries = new Map(
  officialCompositionSource.composition.plugins.map(({ id, config }) => [id, config])
)
const composition = composeBundles("test.nonacademic", [platformBundle], [
  {
    id: "test.deployment",
    defaults: { landing: "me" },
    plugins: platformBundle.plugins.map(({ id }) => ({ id, config: officialEntries.get(id) })),
  },
])

afterEach(() => vi.unstubAllGlobals())

describe("platform-only application composition", () => {
  it("boots without academic services and exposes the host profile route", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }))
    const host = new PluginHost(
      {
        appVersion,
        appBuild: "test",
        composition: { ...composition, market: { indexUrl: marketUrl } },
        plugins: platformPlugins,
      },
      {
        platformModules,
        packages: new PluginPackageStore({ backend: createMemoryPackageBackend() }),
      }
    )

    try {
      await host.bootstrap()
      expect(host.loadErrors.size).toBe(0)
      for (const service of ["providers", "session", "provider", "query", "notifications"] as const) {
        expect(host.runtime.context.get(service)).toBeUndefined()
      }
      expect(host.runtime.get("orahako.shell")?.status).toBe("active")
      expect(host.navigation?.resolve("me")).toMatchObject({
        pluginId: "orahako.profile",
        pageId: "me",
      })
      expect(host.navigation?.landing("me")).toBe("/?plugin=orahako.profile&page=me")
    } finally {
      host.dispose()
    }
  })
})
