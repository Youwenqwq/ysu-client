import { describe, expect, it, vi } from "vitest"
import type { PluginManifest } from "@orahako/plugin-sdk"
import { PluginRuntime } from "@/lib/plugins/runtime"
import type { AcademicProvider, SchoolConfig } from "./types"
import { ProviderPluginRegistry } from "./provider-registry"

const manifest: PluginManifest = {
  id: "test.provider",
  name: "Test provider",
  version: "1.0.0",
  apiVersion: 1,
  kind: "provider",
  entry: "index.js",
}

const config: SchoolConfig = {
  id: "test-school",
  name: "Test School",
  nameEn: "Test School",
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
  features: { hasMobile: false, hasLabSchedule: false, hasMfa: false },
  visible: true,
}

describe("ProviderPluginRegistry", () => {
  it("registers schools through the plugin service and revokes them on stop", () => {
    const registry = new ProviderPluginRegistry()
    const runtime = new PluginRuntime(registry.createService)
    const provider = { id: "test-school" } as AcademicProvider
    const factory = vi.fn(() => provider)

    runtime.register(
      manifest,
      (ctx) => {
        ctx.providers.registerSchool({ config, providerFactory: factory })
      },
      "builtin"
    )

    runtime.start(manifest.id)
    expect(registry.hasProvider("test-school")).toBe(true)
    expect(registry.getRegisteredProviderIds()).toEqual(["test-school"])
    expect(registry.createProvider("test-school")).toBe(provider)

    runtime.stop(manifest.id)
    expect(registry.hasProvider("test-school")).toBe(false)
    expect(() => registry.createProvider("test-school")).toThrow(/Unsupported school provider/)
  })

  it("does not let a stale disposer remove a newer registration", () => {
    const registry = new ProviderPluginRegistry()
    const runtime = new PluginRuntime(registry.createService)
    const firstProvider = { id: "first" } as AcademicProvider
    const secondProvider = { id: "second" } as AcademicProvider
    const firstManifest: PluginManifest = { ...manifest, id: "test.provider.first" }
    const secondManifest: PluginManifest = { ...manifest, id: "test.provider.second" }

    runtime.register(
      firstManifest,
      (ctx) => {
        ctx.providers.registerProvider("test-school", () => firstProvider)
      },
      "builtin"
    )
    runtime.start(firstManifest.id)

    runtime.register(
      secondManifest,
      (ctx) => {
        ctx.providers.registerProvider("test-school", () => secondProvider)
      },
      "builtin"
    )
    runtime.start(secondManifest.id)
    expect(registry.createProvider("test-school")).toBe(secondProvider)

    runtime.stop(firstManifest.id)
    expect(registry.hasProvider("test-school")).toBe(true)
    expect(registry.createProvider("test-school")).toBe(secondProvider)
  })
})
