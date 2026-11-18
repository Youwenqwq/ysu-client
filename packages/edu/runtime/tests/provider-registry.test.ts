import { describe, expect, it, vi } from "vitest"
import {
  defineSchoolProvider,
  isProviderError,
  ProviderError,
  ProviderErrorCode,
  type SchoolProvider,
} from "@orahako/academic-sdk"
import { PluginRuntime } from "@orahako/kernel"
import { Context, definePlugin, PLUGIN_API_VERSION, type PluginManifest } from "@orahako/sdk"
import { ProviderPluginRegistry, providerRegistryRuntimePlugin } from "../src"

function makeProvider(id: string, name = id): SchoolProvider {
  return defineSchoolProvider({
    id,
    name,
    slices: {},
    initialize: async () => {},
    reset: async () => {},
    logout: async () => {},
    relogin: async () => true,
  })
}

function makeManifest(id: string, overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "provider",
    entry: "index.js",
    ...overrides,
  }
}

describe("ProviderPluginRegistry & providerRegistryRuntimePlugin", () => {
  it("registers providers, lists school ids, notifies subscribers, and rejects unknown schools", () => {
    const registry = new ProviderPluginRegistry()
    const events: string[] = []
    const unsubscribe = registry.subscribe((schoolId) => events.push(schoolId))

    expect(registry.listProviders()).toEqual([])
    expect(registry.hasProvider("ysu")).toBe(false)

    expect(() => registry.createProvider("ysu")).toThrow(ProviderError)
    try {
      registry.createProvider("ysu")
    } catch (err) {
      expect(isProviderError(err)).toBe(true)
      if (isProviderError(err)) {
        expect(err.code).toBe(ProviderErrorCode.FEATURE_NOT_SUPPORTED)
        expect(err.status).toBe(501)
      }
    }

    expect(() => registry.registerProvider("", () => makeProvider("bad"))).toThrow(
      "non-empty school id"
    )

    const ysu = makeProvider("ysu", "Yanshan University")
    const disposeYsu = registry.registerProvider("ysu", () => ysu)
    expect(registry.hasProvider("ysu")).toBe(true)
    expect(registry.listProviders()).toEqual(["ysu"])
    expect(registry.createProvider("ysu")).toBe(ysu)
    expect(events).toEqual(["ysu"])

    disposeYsu()
    expect(registry.hasProvider("ysu")).toBe(false)
    expect(registry.listProviders()).toEqual([])
    expect(events).toEqual(["ysu", "ysu"])

    unsubscribe()
    registry.registerProvider("zmu", () => makeProvider("zmu"))
    expect(events).toEqual(["ysu", "ysu"])
  })

  it("replaces older registration on same schoolId and prevents stale disposers from revoking newer ones", () => {
    const registry = new ProviderPluginRegistry()
    const v1 = makeProvider("ysu", "YSU v1")
    const v2 = makeProvider("ysu", "YSU v2")

    const disposeV1 = registry.registerProvider("ysu", () => v1)
    expect(registry.createProvider("ysu")).toBe(v1)

    const disposeV2 = registry.registerProvider("ysu", () => v2)
    expect(registry.createProvider("ysu")).toBe(v2)

    // Stale disposer from v1 must be a safe no-op!
    disposeV1()
    expect(registry.hasProvider("ysu")).toBe(true)
    expect(registry.createProvider("ysu")).toBe(v2)

    // Active disposer revokes v2 cleanly and is idempotent
    disposeV2()
    disposeV2()
    expect(registry.hasProvider("ysu")).toBe(false)
  })

  it("captures contributing plugin's scoped Context and auto-revokes on plugin stop", async () => {
    const runtime = new PluginRuntime()
    runtime.register(providerRegistryRuntimePlugin, "builtin")
    await runtime.startAndWait(providerRegistryRuntimePlugin.manifest.id)

    let factoryReceivedCtx: Context | undefined

    const contributorA = definePlugin({
      manifest: makeManifest("school.ysu"),
      inject: ["providers"],
      apply(ctx) {
        ctx.providers.registerProvider("ysu", (factoryCtx) => {
          factoryReceivedCtx = factoryCtx
          return makeProvider("ysu", "YSU A")
        })
      },
    })

    const contributorB = definePlugin({
      manifest: makeManifest("school.ysu.override"),
      inject: ["providers"],
      apply(ctx) {
        ctx.providers.registerProvider("ysu", () => makeProvider("ysu", "YSU B"))
      },
    })

    const consumerSpy = vi.fn()
    const consumer = definePlugin({
      manifest: makeManifest("app.consumer", { kind: "runtime" }),
      inject: ["providers"],
      apply(ctx) {
        ctx.providers.subscribe(consumerSpy)
      },
    })

    runtime.register(consumer, "builtin")
    runtime.register(contributorA, "builtin")
    runtime.register(contributorB, "external")

    await runtime.startAndWait(consumer.manifest.id)
    await runtime.startAndWait(contributorA.manifest.id)

    const providersRoot = runtime.context.get("providers")!
    const createdA = providersRoot.createProvider("ysu")
    expect(createdA.name).toBe("YSU A")
    expect(factoryReceivedCtx).toBeDefined()
    expect(factoryReceivedCtx).not.toBe(runtime.context)
    expect(consumerSpy).toHaveBeenCalledWith("ysu")

    // Starting contributorB replaces "ysu"; stopping contributorA must NOT revoke contributorB!
    await runtime.startAndWait(contributorB.manifest.id)
    expect(providersRoot.createProvider("ysu").name).toBe("YSU B")

    runtime.stop(contributorA.manifest.id)
    expect(providersRoot.hasProvider("ysu")).toBe(true)
    expect(providersRoot.createProvider("ysu").name).toBe("YSU B")

    // Stopping contributorB revokes "ysu"
    runtime.stop(contributorB.manifest.id)
    expect(providersRoot.hasProvider("ysu")).toBe(false)

    runtime.dispose()
  })
})
