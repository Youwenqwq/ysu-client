import { createMemoryPackageBackend, PluginHost, PluginPackageStore } from "@orahako/kernel"
import { PLUGIN_API_VERSION, PLATFORM_MODULES } from "@orahako/sdk"
import { describe, expect, it, vi } from "vitest"
import { appIdentity } from "../../../../app/composition/identity"
import { platformModules } from "../../../../app/composition/platform-modules"
import { createOfficialCompositionSource } from "../../../../app/composition/source"

const officialCompositionSource = createOfficialCompositionSource({ deployment: "native" })
const { composition, plugins } = officialCompositionSource

describe("official composition", () => {
  it("stacks platform, academic, and school rows with the official deployment config", () => {
    const ids = composition.plugins.map(({ id }) => id)
    expect([...ids].sort()).toEqual(plugins.map(({ manifest }) => manifest.id).sort())
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe("orahako.runtime.slots")
    expect(ids.indexOf("orahako.meter")).toBeGreaterThan(
      ids.indexOf("orahako.runtime.provider-registry")
    )
    expect(ids.indexOf("orahako.meter")).toBeLessThan(ids.indexOf("ysu.provider"))
    expect(ids.at(-1)).toBe("ysu.provider")
    expect(ids).not.toContain("orahako.activation")
    expect(PLUGIN_API_VERSION).toBe(1)
    expect(plugins.every(({ manifest }) => manifest.apiVersion === PLUGIN_API_VERSION)).toBe(true)
    expect(composition.market?.indexUrl).toBe(
      "https://raw.githubusercontent.com/Youwenqwq/orahako-plugin-registry/main/dist/plugins.json"
    )
    expect(Object.keys(platformModules).sort()).toEqual([...PLATFORM_MODULES].sort())
    expect(composition.identity).toBe(appIdentity)
    expect(composition.defaults).toEqual({
      shell: "orahako.shell:default",
      landing: "overview",
      schoolId: "ysu",
    })
    expect(composition.nativeCapabilities).toEqual([
      "native.files@1",
      "native.webview@1",
      "notifications.core@1",
      "widgets.generic@1",
      "academic.polling@1",
      "reminders.classes@1",
      "widgets.schedule@1",
      "widgets.exam@1",
      "native.geolocation@1",
    ])
    const configs = new Map(composition.plugins.map(({ id, config }) => [id, config]))
    expect(configs.get("orahako.runtime.session")).toEqual({ defaultSchoolId: "ysu" })
    expect(configs.get("orahako.runtime.provider")).toEqual({ defaultSchoolId: "ysu" })
    expect(configs.get("orahako.runtime.installer")).toEqual({
      marketUrl: composition.market?.indexUrl,
      appVersion: officialCompositionSource.appVersion,
    })
    const basePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? ""
    expect(configs.get("orahako.runtime.router")).toEqual({ basePath })
    expect(configs.get("orahako.updater")).toMatchObject({
      basePath,
      currentVersion: officialCompositionSource.appVersion,
    })
    expect(configs.get("orahako.runtime.navigation")).toEqual({ fallbackHref: "/" })
    expect(configs.get("orahako.analytics")).toMatchObject({
      endpoint: "https://ysu.welain.com/api/stats",
      appVersion: officialCompositionSource.appVersion,
    })
    expect(configs.get("orahako.announcement")).toEqual({
      endpoint: "https://ysu.welain.com/updates/announcement.json",
    })
    expect(configs.get("orahako.profile")).toMatchObject({
      appName: appIdentity.name,
      appVersion: officialCompositionSource.appVersion,
      repoUrl: "https://github.com/Youwenqwq/orahako",
    })
    expect(configs.get("orahako.auth-ui")).toEqual({ defaultLanding: "overview" })
    expect(configs.get("orahako.onboarding")).toMatchObject({
      marketUrl: composition.market?.indexUrl,
      schools: [{ id: "ysu", builtin: true }],
    })
  })

  it("installs activation only for the EdgeOne PWA deployment", () => {
    const pwaSource = createOfficialCompositionSource({ deployment: "edgeone-pwa" })
    const pwaIds = pwaSource.composition.plugins.map(({ id }) => id)
    expect(pwaIds).toContain("orahako.activation")
    expect(pwaSource.composition.plugins.find(({ id }) => id === "orahako.activation")).toEqual({
      id: "orahako.activation",
      config: { required: true },
    })
    expect(pwaSource.plugins.some(({ manifest }) => manifest.id === "orahako.activation")).toBe(
      true
    )
    expect([...pwaIds].sort()).toEqual(pwaSource.plugins.map(({ manifest }) => manifest.id).sort())
    expect(pwaIds).toContain("orahako.meter")

    expect(composition.plugins.some(({ id }) => id === "orahako.activation")).toBe(false)
    expect(plugins.some(({ manifest }) => manifest.id === "orahako.activation")).toBe(false)
  })

  it("boots and registers the protected YSU provider", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }))
    const host = new PluginHost(officialCompositionSource, {
      platformModules,
      packages: new PluginPackageStore({ backend: createMemoryPackageBackend() }),
    })

    try {
      await host.bootstrap()
      expect([...host.loadErrors]).toEqual([])
      expect(host.runtime.context.get("providers")?.listProviders()).toEqual(["ysu"])
      expect(host.runtime.get("ysu.provider")?.status).toBe("active")
      expect(host.runtime.get("orahako.meter")?.status).toBe("active")
      expect(host.runtime.get("orahako.runtime.appearance")?.status).toBe("active")
      expect(host.runtime.get("orahako.runtime.native-lifecycle")?.status).toBe("active")
      expect(host.runtime.context.get("appearance")).toBeDefined()
      expect(host.runtime.context.get("schedule")).toBeDefined()
      expect(host.runtime.get("orahako.activation")).toBeUndefined()
      expect(() => host.disable("ysu.provider")).toThrow("protected by the active composition")
    } finally {
      host.dispose()
      vi.unstubAllGlobals()
    }
  })
})
