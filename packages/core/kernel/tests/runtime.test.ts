import { describe, expect, it, vi } from "vitest"
import {
  Context,
  definePlugin,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  type PluginManifest,
} from "@orahako/sdk"
import { PluginDependencyError, PluginRuntime } from "@orahako/kernel"

function makeManifest(id: string, extra: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "feature",
    entry: "index.js",
    ...extra,
  }
}

class ScopedRootService {
  readonly facades: Array<{ ctx: Context; manifest: PluginManifest }> = [];

  [PLUGIN_SERVICE_SCOPE](ctx: Context, consumer: PluginManifest): { owner: string } {
    this.facades.push({ ctx, manifest: consumer })
    return { owner: consumer.id }
  }
}

class LabelledRootService {
  constructor(readonly label: string) {}

  [PLUGIN_SERVICE_SCOPE](): { label: string } {
    return { label: this.label }
  }
}

describe("PluginRuntime Cordis fiber waiting & lifecycle", () => {
  it("mounts consumers in waiting state when injected services are absent and wakes them when provided", async () => {
    const runtime = new PluginRuntime()
    const applied: unknown[] = []
    const consumerManifest = makeManifest("example.consumer", { inject: ["ui"] })

    runtime.register(
      consumerManifest,
      (ctx) => {
        applied.push(ctx.get("ui"))
      },
      "builtin"
    )

    // No PluginDependencyError thrown! Fiber mounts and waits natively in Cordis.
    runtime.start(consumerManifest.id)
    expect(runtime.get(consumerManifest.id)?.status).toBe("waiting")
    expect(applied).toEqual([])

    const waitPromise = runtime.startAndWait(consumerManifest.id)
    runtime.context.set("ui", new LabelledRootService("ready-ui"))
    await waitPromise

    expect(runtime.get(consumerManifest.id)?.status).toBe("active")
    expect(applied).toEqual([{ label: "ready-ui" }])
    runtime.dispose()
  })

  it("times out startAndWait cleanly with missing service names if never provided", async () => {
    vi.useFakeTimers()
    const runtime = new PluginRuntime()
    const consumer = makeManifest("example.stalled", { inject: ["ui", "storage"] })
    runtime.register(consumer, () => {}, "external")

    const pending = runtime.startAndWait(consumer.id, 5_000)
    const assertion = expect(pending).rejects.toThrow(
      "Plugin startup timed out waiting for services (ui, storage): example.stalled"
    )
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
    expect(runtime.get(consumer.id)?.status).toBe("failed")
    runtime.dispose()
    vi.useRealTimers()
  })

  it("disposes and restarts dependent consumers when a root service is replaced without touching bystanders", () => {
    const runtime = new PluginRuntime()
    const release = runtime.context.set("ui", new LabelledRootService("first"))
    const applied: unknown[] = []
    const dispose = vi.fn()
    const bystanderFn = vi.fn()

    const consumer = makeManifest("example.consumer", { inject: ["ui"] })
    const bystander = makeManifest("example.bystander")

    runtime.register(
      consumer,
      (ctx) => {
        applied.push(ctx.get("ui"))
        ctx.on("dispose", dispose)
      },
      "builtin"
    )
    runtime.register(bystander, bystanderFn, "builtin")

    runtime.start(consumer.id)
    runtime.start(bystander.id)
    expect(applied).toEqual([{ label: "first" }])
    expect(bystanderFn).toHaveBeenCalledOnce()

    // Releasing the root service disposes the consumer and parks it back in "waiting"
    release()
    expect(dispose).toHaveBeenCalledOnce()
    expect(runtime.get(consumer.id)?.status).toBe("waiting")
    expect(runtime.get(bystander.id)?.status).toBe("active")

    // Providing a replacement root service automatically restarts the consumer
    runtime.context.set("ui", new LabelledRootService("second"))
    expect(applied).toEqual([{ label: "first" }, { label: "second" }])
    expect(runtime.get(consumer.id)?.status).toBe("active")
    expect(bystanderFn).toHaveBeenCalledOnce()
    runtime.dispose()
  })

  it("isolates multiple PLUGIN_SERVICE_SCOPE facades onto the final consumer context", () => {
    const runtime = new PluginRuntime()
    const uiRoot = new ScopedRootService()
    runtime.context.set("ui", uiRoot)
    runtime.context.set("http", new LabelledRootService("http-scoped"))

    const consumer = makeManifest("example.multi", { inject: ["ui", "http"] })
    let seenCtx: Context | undefined
    runtime.register(
      consumer,
      (ctx) => {
        seenCtx = ctx
      },
      "builtin"
    )
    runtime.start(consumer.id)

    expect(uiRoot.facades).toHaveLength(1)
    expect(uiRoot.facades[0]?.ctx).toBe(seenCtx)
    expect(uiRoot.facades[0]?.ctx.get("http")).toEqual({ label: "http-scoped" })
    expect(runtime.context.get("ui")).toBe(uiRoot)
    runtime.dispose()
  })

  it("validates configSchema with Ajv defaults and asserts declared provides after apply settles", async () => {
    const runtime = new PluginRuntime()
    let receivedConfig: unknown

    const configurable = definePlugin({
      manifest: makeManifest("example.configurable", { kind: "runtime", provides: ["analytics"] }),
      configSchema: {
        type: "object",
        properties: {
          endpoint: { type: "string", default: "https://stats.example/collect" },
        },
        additionalProperties: false,
      },
      apply: async (ctx, config) => {
        await Promise.resolve()
        receivedConfig = config
        ctx.set("analytics", {
          endpoint: String(config.endpoint),
          track: async () => ({ tracked: false, reason: "disabled" as const, date: null }),
        })
      },
    })

    runtime.register(configurable, "builtin", {})
    await runtime.startAndWait(configurable.manifest.id)
    expect(receivedConfig).toEqual({ endpoint: "https://stats.example/collect" })
    expect(runtime.get(configurable.manifest.id)?.status).toBe("active")

    // Missing declared `provides` fails startup
    const brokenProvider = makeManifest("example.broken-provider", {
      kind: "runtime",
      provides: ["updater"],
    })
    runtime.register(brokenProvider, () => {}, "builtin")
    await expect(runtime.startAndWait(brokenProvider.id)).rejects.toThrow(
      "did not provide declared service: updater"
    )
    expect(runtime.get(brokenProvider.id)?.status).toBe("failed")
    runtime.dispose()
  })

  it("enforces package requires SemVer ranges, cascades stop, and does not leak registry entries", () => {
    const runtime = new PluginRuntime()
    const base = makeManifest("example.base", { version: "1.2.0" })
    const dependent = makeManifest("example.dep", { requires: { "example.base": "^1.0.0" } })
    const incompatible = makeManifest("example.incompat", {
      requires: { "example.base": "^2.0.0" },
    })

    runtime.register(base, () => {}, "builtin")
    runtime.register(dependent, () => {}, "external")
    runtime.register(incompatible, () => {}, "external")

    expect(() => runtime.start(dependent.id)).toThrow(PluginDependencyError)
    expect(runtime.get(dependent.id)?.status).toBe("registered")

    runtime.start(base.id)
    runtime.start(dependent.id)
    expect(runtime.get(dependent.id)?.status).toBe("active")

    expect(() => runtime.start(incompatible.id)).toThrow("does not satisfy ^2.0.0")

    // Cascading stop disables dependents
    runtime.stop(base.id)
    expect(runtime.get(dependent.id)?.status).toBe("disabled")

    // Repeated start/stop never leaks Cordis registry entries
    const baseline = runtime.context.registry.size
    for (let i = 0; i < 5; i++) {
      runtime.start(base.id)
      runtime.stop(base.id)
    }
    expect(runtime.context.registry.size).toBe(baseline)
    runtime.dispose()
  })
})
