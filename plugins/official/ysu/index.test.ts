import { describe, expect, it, vi } from "vitest"
import { getSchoolConfigOrNull } from "@orahako/plugin-sdk/host"
import { pluginI18nRegistry } from "@/lib/plugins/i18n-registry"
import { createPluginPlatformServices } from "@/lib/plugins/platform-service"
import { PluginRuntime } from "@/lib/plugins/runtime"
import { ProviderPluginRegistry } from "@/providers/provider-registry"
import { definition, manifest } from "./index"

describe("YSU provider plugin", () => {
  it("does not register its config until the plugin starts", () => {
    expect(getSchoolConfigOrNull()).toBeNull()
  })

  it("registers and revokes the YSU provider when started and stopped", async () => {
    const providers = new ProviderPluginRegistry()
    const runtime = new PluginRuntime((ctx, plugin) => {
      providers.createService(ctx, plugin)
      pluginI18nRegistry.createService(ctx, plugin)
      createPluginPlatformServices(ctx, plugin)
    })
    runtime.register(manifest, definition, "builtin")
    runtime.start(manifest.id)
    await vi.waitFor(() => expect(providers.hasProvider("ysu")).toBe(true))
    expect(providers.createProvider("ysu").id).toBe("ysu")
    expect(getSchoolConfigOrNull()?.id).toBe("ysu")
    runtime.stop(manifest.id)
    expect(providers.hasProvider("ysu")).toBe(false)
    expect(getSchoolConfigOrNull()).toBeNull()
  })
})
