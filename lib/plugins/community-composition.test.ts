import { afterEach, describe, expect, it, vi } from "vitest"
import {
  definePlugin,
  pluginPageHref,
  type AcademicProvider,
  type CompositionPlugin,
  type CompositionSource,
  type PluginProviderRegistryService,
  type PluginProviderRuntimeService,

} from "@orahako/plugin-sdk"
import { PluginHost } from "./host"
import { registryRuntimePlugins } from "@/plugins/official/runtime/registries"
import { providerRegistryRuntimePlugin } from "@/plugins/official/runtime/providers"
import { sessionRuntimePlugin } from "@/plugins/official/runtime/session"
import { httpRuntimePlugin } from "@/plugins/official/runtime/platform"
import { providerRuntimePlugin } from "@/plugins/official/runtime/provider"
import { navigationRuntimePlugin } from "@/plugins/official/runtime/navigation"

const communityProvider: CompositionPlugin = {
  manifest: {
    id: "community.provider",
    name: "Community Provider",
    version: "1.0.0",
    apiVersion: 2,
    kind: "provider",
    entry: "index.js",
    inject: ["providers"],
  },
  definition: definePlugin((ctx) => {
    const providers = ctx.get("providers") as PluginProviderRegistryService
    providers.registerProvider(
      "community-school",
      () =>
        ({
          id: "community-provider",
          name: "Community Provider",
          capabilities: {},
          supportedPlugins: undefined,
          initialize: async () => {},
          reset: async () => {},
          logout: async () => {},
          relogin: async () => true,
        }) as AcademicProvider
    )
  }),
}

const communityShell: CompositionPlugin = {
  manifest: {
    id: "community.shell",
    name: "Community Shell",
    version: "1.0.0",
    apiVersion: 2,
    kind: "shell",
    entry: "index.js",
    inject: ["ui"],
  },
  definition: definePlugin((ctx) => {
    ctx.ui.registerShell({ id: "alternative", name: "Alternative", component: () => null })
    ctx.ui.registerPage({
      id: "home",
      title: "Community Home",
      route: "home",
      component: () => null,
      requiresProvider: false,
    })
  }),
}

describe("community application composition", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("starts a non-academic application without provider services", async () => {
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout })
    const plugins = [...registryRuntimePlugins, communityShell]
    const host = new PluginHost({
      appVersion: "0.0.0",
      appBuild: "test",
      composition: {
        id: "community.nonacademic",
        version: 1,
        defaults: { shell: "community.shell:alternative", landing: "home" },
        plugins: plugins.map((plugin) => ({ id: plugin.manifest.id })),
      },
      plugins,
    })
    vi.spyOn(host.packages, "list").mockResolvedValue([])
    await host.bootstrap()
    expect(host.runtime.get("community.shell")?.status).toBe("active")
    expect(host.ui.getSnapshot().shells[0]?.pluginId).toBe("community.shell")
    expect(host.runtime.context.get("provider")).toBeUndefined()
    expect(host.runtime.context.get("session")).toBeUndefined()
    expect(host.runtime.context.get("query")).toBeUndefined()
    host.runtime.dispose()
  })

  it("uses the selected Shell, Provider and landing without official fallbacks", async () => {
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout })
    const plugins = [
      ...registryRuntimePlugins,
      providerRegistryRuntimePlugin,
      httpRuntimePlugin,
      sessionRuntimePlugin,
      providerRuntimePlugin,
      navigationRuntimePlugin,
      communityProvider,
      communityShell,
    ]
    const source: CompositionSource = {
      appVersion: "0.0.0",
      appBuild: "test",
      composition: {
        id: "community.application",
        version: 1,
        defaults: {
          shell: "community.shell:alternative",
          schoolId: "community-school",
          landing: "home",
        },
        plugins: plugins.map((plugin) => ({
          id: plugin.manifest.id,
          config:
            plugin.manifest.id === sessionRuntimePlugin.manifest.id ||
            plugin.manifest.id === providerRuntimePlugin.manifest.id
              ? { defaultSchoolId: "community-school" }
              : plugin.manifest.id === navigationRuntimePlugin.manifest.id
                ? { fallbackHref: "/community" }
                : undefined,
        })),
      },
      plugins,
    }
    const host = new PluginHost(source)
    vi.spyOn(host.packages, "list").mockResolvedValue([])
    await host.bootstrap()

    expect(host.ui.getSnapshot().shells[0]?.pluginId).toBe("community.shell")
    const provider = host.runtime.context.get("provider") as PluginProviderRuntimeService
    const providers = host.runtime.context.get("providers") as PluginProviderRegistryService
    expect(provider.getActive()).not.toBeNull()
    expect(provider.getSnapshot()).toMatchObject({
      schoolId: "community-school",
      provider: { id: "community-provider" },
    })
    expect(providers.hasProvider("ysu")).toBe(false)
    expect(host.navigation.landing("home")).toBe(
      pluginPageHref("community.shell", "home")
    )
    expect(host.navigation.sources().fallbackHref).toBe("/community")
    host.runtime.dispose()
  })
})
