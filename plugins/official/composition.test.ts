import { describe, expect, it, vi } from "vitest"
import { PluginHost } from "@/lib/plugins/host"
import type { PluginProviderRegistryService } from "@orahako/plugin-sdk"
import { officialCompositionSource } from "./composition"

describe("official application composition", () => {
  it("starts every configured runtime service and plugin", async () => {
    vi.stubGlobal("window", { setTimeout: globalThis.setTimeout })
    const host = new PluginHost(officialCompositionSource)
    await host.bootstrap()
    const states = host.runtime.getSnapshot()
    for (const entry of host.composition.plugins) {
      expect(host.runtime.get(entry.id)?.status, entry.id).toBe("active")
    }
    expect(states).toHaveLength(host.composition.plugins.length)
    expect(host.ui.getSnapshot().shells).toHaveLength(1)
    expect(
      (host.runtime.context.get("providers") as PluginProviderRegistryService).hasProvider("ysu")
    ).toBe(true)
    host.runtime.dispose()
    vi.unstubAllGlobals()
  }, 15_000)
})
