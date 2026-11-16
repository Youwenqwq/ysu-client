import { describe, expect, it, vi } from "vitest"
import { Context } from "@cordisjs/core"
import {
  PLUGIN_SERVICE_SCOPE,
  type ManagedProvider,
  type PluginContext,
  type PluginManifest,
  type PluginProviderRegistryService,
} from "@orahako/plugin-sdk"
import { PluginRuntime } from "@/lib/plugins/runtime"
import { ProviderPluginRegistry } from "./registry"

const manifest: PluginManifest = {
  id: "test.provider",
  name: "Test provider",
  version: "1.0.0",
  apiVersion: 2,
  kind: "provider",
  entry: "index.js",
  inject: ["providers"],
}

function setup() {
  const registry = new ProviderPluginRegistry()
  const runtime = new PluginRuntime()
  runtime.context.set("providers", registry)
  return { registry, runtime }
}

function provider(id: string): ManagedProvider {
  return { id } as unknown as ManagedProvider
}

describe("ProviderPluginRegistry", () => {
  it("registers providers through the plugin service and revokes them on stop", () => {
    const { registry, runtime } = setup()
    const instance = provider("test-school")
    const contexts: PluginContext[] = []
    const factory = vi.fn((_ctx: PluginContext) => instance)
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)

    runtime.register(
      manifest,
      (ctx) => {
        contexts.push(ctx)
        const providers = ctx.get("providers") as PluginProviderRegistryService
        providers.registerProvider("test-school", factory)
      },
      "builtin"
    )

    runtime.start(manifest.id)
    expect(registry.hasProvider("test-school")).toBe(true)
    expect(registry.createProvider("test-school")).toBe(instance)
    expect(factory.mock.calls[0]?.[0]).toBe(contexts[0])
    expect(listener).toHaveBeenCalledWith("test-school")

    runtime.stop(manifest.id)
    expect(registry.hasProvider("test-school")).toBe(false)
    expect(() => registry.createProvider("test-school")).toThrow(/Unsupported school provider/)
    expect(listener).toHaveBeenLastCalledWith("test-school")
    unsubscribe()
  })

  it("replaces a provider-only slot and keeps the newest factory", () => {
    const { registry, runtime } = setup()
    const firstProvider = provider("first")
    const secondProvider = provider("second")
    const firstManifest: PluginManifest = { ...manifest, id: "test.provider.first" }
    const secondManifest: PluginManifest = { ...manifest, id: "test.provider.second" }

    runtime.register(
      firstManifest,
      (ctx) => {
        const providers = ctx.get("providers") as PluginProviderRegistryService
        providers.registerProvider("test-school", () => firstProvider)
      },
      "builtin"
    )
    runtime.start(firstManifest.id)

    runtime.register(
      secondManifest,
      (ctx) => {
        const providers = ctx.get("providers") as PluginProviderRegistryService
        providers.registerProvider("test-school", () => secondProvider)
      },
      "builtin"
    )
    runtime.start(secondManifest.id)
    expect(registry.createProvider("test-school")).toBe(secondProvider)

    // Disposing the older contribution must not revoke the newer factory.
    runtime.stop(firstManifest.id)
    expect(registry.hasProvider("test-school")).toBe(true)
    expect(registry.createProvider("test-school")).toBe(secondProvider)
  })

  it("requires a school id for a registration", () => {
    const registry = new ProviderPluginRegistry()
    const service = registry[PLUGIN_SERVICE_SCOPE](new Context())
    expect(() => service.registerProvider("", () => provider("x"))).toThrow(
      "Provider registration requires a school id"
    )
    expect(registry.hasProvider("")).toBe(false)
  })

  it("throws the unsupported-provider error for unregistered schools", () => {
    const { registry } = setup()
    expect(registry.hasProvider("test-school")).toBe(false)
    expect(() => registry.createProvider("test-school")).toThrow(/Unsupported school provider/)
  })
})
