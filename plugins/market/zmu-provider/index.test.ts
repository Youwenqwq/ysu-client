import { describe, expect, it, vi } from "vitest"
import { getAvailableSchools } from "@orahako/plugin-sdk/host"
import { PluginRuntime } from "@/lib/plugins/runtime"
import { ProviderPluginRegistry } from "@/providers/provider-registry"
import { definition, manifest } from "./index"

describe("ZMU provider plugin", () => {
  it("registers and revokes the school and provider with its lifecycle", async () => {
    const providers = new ProviderPluginRegistry()
    const runtime = new PluginRuntime(providers.createService)
    runtime.register(manifest, definition, "builtin")
    runtime.start(manifest.id)
    await vi.waitFor(() => expect(providers.hasProvider("zmu")).toBe(true))
    expect(providers.createProvider("zmu").supportedPlugins).toContain("orahako.schedule")
    expect(providers.createProvider("zmu").supportedPlugins).not.toContain("orahako.ecard")
    expect(getAvailableSchools().find((school) => school.id === "zmu")?.name).toBe("遵义医科大学")
    runtime.stop(manifest.id)
    expect(providers.hasProvider("zmu")).toBe(false)
    expect(getAvailableSchools().some((school) => school.id === "zmu")).toBe(false)
  })
})
