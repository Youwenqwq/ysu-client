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
  constructor(readonly rawLabel: string) {}

  [PLUGIN_SERVICE_SCOPE](): { label: string } {
    return { label: this.rawLabel }
  }
}

function readFacadeLabel(value: unknown): string | undefined {
  if (typeof value === "object" && value !== null && "label" in value) {
    const label = value.label
    if (typeof label === "string") return label
  }
  return undefined
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

  it("applies plugins with absent optional services and remounts on service changes", async () => {
    const runtime = new PluginRuntime()
    const observed: Array<string | undefined> = []
    const optional = definePlugin({
      manifest: makeManifest("example.optional", { kind: "feature" }),
      optionalInject: ["ui"] as const,
      apply(ctx) {
        observed.push(readFacadeLabel(ctx.ui))
      },
    })

    runtime.register(optional, "builtin")
    await runtime.startAndWait(optional.manifest.id)
    expect(observed).toEqual([undefined])
    expect(runtime.get(optional.manifest.id)?.status).toBe("active")

    const releaseFirst = runtime.context.set("ui", new LabelledRootService("first"))
    await runtime.flush()
    expect(observed).toEqual([undefined, "first"])
    expect(runtime.get(optional.manifest.id)?.status).toBe("active")

    // Revocation drops the old facade before the next generation applies.
    releaseFirst()
    await runtime.flush()
    expect(observed).toEqual([undefined, "first", undefined])

    const releaseSecond = runtime.context.set("ui", new LabelledRootService("second"))
    await runtime.flush()
    expect(observed).toEqual([undefined, "first", undefined, "second"])
    expect(runtime.get(optional.manifest.id)?.status).toBe("active")

    releaseSecond()
    await runtime.flush()
    expect(observed).toEqual([undefined, "first", undefined, "second", undefined])
    expect(runtime.get(optional.manifest.id)?.status).toBe("active")
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

  it("validates provides against services the plugin actually published", async () => {
    const runtime = new PluginRuntime()
    runtime.context.set("shared.analytics", { endpoint: "pre-existing" })

    const freeloader = makeManifest("example.freeloader", {
      kind: "runtime",
      provides: ["shared.analytics"],
    })
    runtime.register(freeloader, () => {}, "builtin")
    await expect(runtime.startAndWait(freeloader.id)).rejects.toThrow(
      "did not provide declared service: shared.analytics"
    )
    expect(runtime.get(freeloader.id)?.status).toBe("failed")

    const syncProvider = makeManifest("example.sync-provider", {
      kind: "runtime",
      provides: ["sync.value"],
    })
    runtime.register(syncProvider, (ctx) => ctx.set("sync.value", { n: 1 }), "builtin")
    await runtime.startAndWait(syncProvider.id)
    expect(runtime.get(syncProvider.id)?.status).toBe("active")

    const asyncProvider = makeManifest("example.async-provider", {
      kind: "runtime",
      provides: ["async.value"],
    })
    runtime.register(
      asyncProvider,
      async (ctx) => {
        await Promise.resolve()
        ctx.set("async.value", { n: 2 })
      },
      "builtin"
    )
    await runtime.startAndWait(asyncProvider.id)
    expect(runtime.get(asyncProvider.id)?.status).toBe("active")
    runtime.dispose()
  })

  it("settles startAndWait when the startup timer fires after the plugin was stopped", async () => {
    vi.useFakeTimers()
    const runtime = new PluginRuntime()
    const consumer = makeManifest("example.abandoned", { inject: ["ui"] })
    runtime.register(consumer, () => {}, "external")
    runtime.start(consumer.id)

    // A throwing listener prevents the subscription check from observing stop().
    const unsubscribeThrowing = runtime.subscribe(() => {
      throw new Error("listener failure")
    })
    const pending = runtime.startAndWait(consumer.id, 500)
    const assertion = expect(pending).rejects.toThrow("was stopped during startup")
    expect(() => runtime.stop(consumer.id)).toThrow("listener failure")
    unsubscribeThrowing()

    await vi.advanceTimersByTimeAsync(500)
    await assertion
    runtime.dispose()
    vi.useRealTimers()
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

  it("revalidates requires on hot replacement without illegal active dependents", () => {
    const runtime = new PluginRuntime()
    const base = makeManifest("example.base", { version: "1.2.0" })
    const dependent = makeManifest("example.dep", { requires: { "example.base": "^1.0.0" } })

    runtime.register(base, () => {}, "builtin")
    runtime.register(dependent, () => {}, "external")
    runtime.start(base.id)
    runtime.start(dependent.id)
    expect(runtime.get(dependent.id)?.status).toBe("active")

    runtime.register(makeManifest("example.base", { version: "2.0.0" }), () => {}, "builtin")
    expect(runtime.get("example.base")?.status).toBe("active")
    expect(runtime.get(dependent.id)?.status).toBe("disabled")

    // Restoring a compatible dependency lets the dependent start again.
    runtime.register(base, () => {}, "builtin")
    runtime.start(base.id)
    runtime.start(dependent.id)
    expect(runtime.get(dependent.id)?.status).toBe("active")
    runtime.dispose()
  })

  it("invalidates dependents when a hot-replaced dependency fails to start", () => {
    const runtime = new PluginRuntime()
    const base = makeManifest("example.base", { version: "2.0.0" })
    const dependent = makeManifest("example.dep", { requires: { "example.base": "^2.0.0" } })

    runtime.register(base, () => {}, "builtin")
    runtime.register(dependent, () => {}, "external")
    runtime.start(base.id)
    runtime.start(dependent.id)
    expect(runtime.get(dependent.id)?.status).toBe("active")

    // The replacement satisfies the dependent's range, but cannot start on
    // its own missing package dependency.
    const failing = makeManifest("example.base", {
      version: "2.1.0",
      requires: { "example.missing": "^1.0.0" },
    })
    expect(() => runtime.register(failing, () => {}, "builtin")).toThrow(PluginDependencyError)
    expect(runtime.get("example.base")?.status).toBe("registered")
    expect(runtime.get(dependent.id)?.status).toBe("disabled")

    // Rolling back to the previous compatible release restores both.
    runtime.register(base, () => {}, "builtin")
    runtime.start(base.id)
    runtime.start(dependent.id)
    expect(runtime.get(base.id)?.status).toBe("active")
    expect(runtime.get(dependent.id)?.status).toBe("active")
    runtime.dispose()
  })

  it("clears failed status when a service replacement revives the plugin", async () => {
    const runtime = new PluginRuntime()
    const consumer = makeManifest("example.revive", { kind: "runtime", inject: ["ui"] })
    const releaseBad = runtime.context.set("ui", new LabelledRootService("bad"))

    runtime.register(
      consumer,
      async (ctx) => {
        await Promise.resolve()
        if (readFacadeLabel(ctx.get("ui")) !== "good") throw new Error("bad ui")
      },
      "builtin"
    )
    await expect(runtime.startAndWait(consumer.id)).rejects.toThrow("bad ui")
    expect(runtime.get(consumer.id)?.status).toBe("failed")

    releaseBad()
    runtime.context.set("ui", new LabelledRootService("good"))
    await runtime.startAndWait(consumer.id)
    expect(runtime.get(consumer.id)?.status).toBe("active")
    expect(runtime.get(consumer.id)?.error).toBeUndefined()
    runtime.dispose()
  })

  it("waits for async disposers before applying the next plugin generation", async () => {
    const runtime = new PluginRuntime()
    const releaseCleanup = Promise.withResolvers<void>()
    const events: string[] = []
    let generation = 0
    const manifest = makeManifest("example.async-cleanup")

    const executable = (ctx: Context) => {
      generation += 1
      const current = generation
      events.push(`apply:${current}`)
      ctx.effect(() => async () => {
        events.push(`cleanup:start:${current}`)
        if (current === 1) await releaseCleanup.promise
        events.push(`cleanup:end:${current}`)
      })
    }

    runtime.register(manifest, executable, "builtin")
    await runtime.startAndWait(manifest.id)
    expect(events).toEqual(["apply:1"])

    runtime.stop(manifest.id)
    runtime.start(manifest.id)
    expect(runtime.get(manifest.id)?.status).toBe("starting")
    expect(events).toEqual(["apply:1", "cleanup:start:1"])

    const waiting = runtime.startAndWait(manifest.id)
    await Promise.resolve()
    expect(events).toEqual(["apply:1", "cleanup:start:1"])

    releaseCleanup.resolve()
    await waiting
    expect(events).toEqual(["apply:1", "cleanup:start:1", "cleanup:end:1", "apply:2"])
    expect(runtime.get(manifest.id)?.status).toBe("active")
    runtime.dispose()
  })
})
