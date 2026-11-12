import { describe, expect, it, vi } from "vitest"
import type { AcademicProvider, PluginManifest, SchoolConfig } from "@ysu/plugin-sdk"
import { PluginRuntime } from "@/lib/plugins/runtime"
import { providerRegistry } from "./provider-registry"
import { getActiveProvider, setActiveProviderSchool } from "./provider-service"

const manifest: PluginManifest = {
  id: "test.provider-replacement",
  name: "Replacement",
  version: "1.0.0",
  apiVersion: 1,
  kind: "provider",
  entry: "index.js",
}

const config = {
  id: "replacement-school",
  name: "Replacement school",
  nameEn: "Replacement school",
  visible: true,
  features: { hasMobile: false, hasLabSchedule: false, hasMfa: false },
  cas: {
    cerBaseUrl: "https://cas.example",
    aesChars: "",
    mfaMethodToCode: {},
    mfaMethodToAuthCodeType: {},
  },
  jwxt: {
    jwxtBaseUrl: "https://jwxt.example",
    portalPath: "/",
    appShowPath: "/",
    appIds: {},
    apiPaths: {},
  },
} satisfies SchoolConfig

describe("provider replacement", () => {
  it("invalidates the active singleton when a plugin replaces its factory", async () => {
    const first = { id: config.id } as AcademicProvider
    const second = { id: config.id } as AcademicProvider
    const runtime = new PluginRuntime(providerRegistry.createService)
    runtime.register(
      manifest,
      (ctx) => {
        ctx.providers.registerSchool({ config, providerFactory: () => first })
      },
      "external"
    )
    runtime.start(manifest.id)
    await vi.waitFor(() => expect(providerRegistry.hasProvider(config.id)).toBe(true))
    expect(setActiveProviderSchool(config.id)).toBe(first)

    runtime.stop(manifest.id)
    runtime.register(
      manifest,
      (ctx) => {
        ctx.providers.registerSchool({ config, providerFactory: () => second })
      },
      "external"
    )
    runtime.start(manifest.id)
    await vi.waitFor(() => expect(providerRegistry.hasProvider(config.id)).toBe(true))
    expect(getActiveProvider()).toBe(second)
    runtime.stop(manifest.id)
  })
})
