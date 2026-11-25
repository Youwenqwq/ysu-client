import { describe, expect, it, vi } from "vitest"
import "./test-contract"
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
      manifest: makeManifest("example.configurable", {
        kind: "runtime",
        provides: ["kernelTelemetry"],
      }),
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
        ctx.set("kernelTelemetry", {
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
      provides: ["kernelTelemetry"],
    })
    runtime.register(brokenProvider, () => {}, "builtin")
    await expect(runtime.startAndWait(brokenProvider.id)).rejects.toThrow(
      "did not provide declared service: kernelTelemetry"
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

  it("waits for an async disposer before Cordis auto-restart applies the next generation", async () => {
    const runtime = new PluginRuntime()
    const releaseCleanup = Promise.withResolvers<void>()
    const cleanupStarted = Promise.withResolvers<void>()
    const applied: number[] = []
    let starts = 0
    let finished = 0
    const manifest = makeManifest("example.auto-restart-cleanup", { inject: ["ui"] })

    const releaseFirst = runtime.context.set("ui", new LabelledRootService("first"))
    runtime.register(
      manifest,
      (ctx: Context) => {
        starts += 1
        const generation = starts
        applied.push(generation)
        ctx.effect(() => async () => {
          if (generation !== 1) return
          cleanupStarted.resolve()
          await releaseCleanup.promise
          finished += 1
        })
      },
      "builtin"
    )
    await runtime.startAndWait(manifest.id)
    expect(starts).toBe(1)

    // A required-service replacement disposes and restarts the Cordis scope.
    releaseFirst()
    const releaseSecond = runtime.context.set("ui", new LabelledRootService("second"))
    await cleanupStarted.promise
    await Promise.resolve()
    expect(applied).toEqual([1])
    expect(finished).toBe(0)
    expect(starts).toBe(1)
    expect(runtime.get(manifest.id)?.status).toBe("starting")

    // A second replacement while the first cleanup is still pending supersedes
    // the queued attempt; only the newest attempt may eventually apply.
    releaseSecond()
    runtime.context.set("ui", new LabelledRootService("third"))
    await Promise.resolve()
    expect(starts).toBe(1)

    releaseCleanup.resolve()
    await runtime.flush()
    expect(finished).toBe(1)
    expect(starts).toBe(2)
    expect(applied).toEqual([1, 2])
    expect(runtime.get(manifest.id)?.status).toBe("active")
    await runtime.dispose()
  })

  it("abandons an apply that never settles so runtime disposal stays bounded", async () => {
    vi.useFakeTimers()
    const runtime = new PluginRuntime()
    const never = Promise.withResolvers<void>()
    const manifest = makeManifest("example.never-settles")

    runtime.register(
      manifest,
      async () => {
        await never.promise
      },
      "builtin"
    )
    const pending = runtime.startAndWait(manifest.id, 5_000)
    const assertion = expect(pending).rejects.toThrow("Plugin startup timed out")
    await vi.advanceTimersByTimeAsync(5_000)
    await assertion
    expect(runtime.get(manifest.id)?.status).toBe("failed")
    // Introspection: the abandoned apply is no longer tracked as awaited work.
    const internals = runtime as unknown as { applyAbandons: Set<unknown> }
    expect(internals.applyAbandons.size).toBe(0)

    let settled = false
    const disposal = runtime.dispose().then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    expect(settled).toBe(true)
    await disposal
    expect(runtime.get(manifest.id)).toBeUndefined()

    // A late resolution must not revive the abandoned apply.
    never.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(true)
    vi.useRealTimers()
  })

  it("waits for async disposers in stopAndWait and unregisterAndWait", async () => {
    const runtime = new PluginRuntime()
    const firstCleanup = Promise.withResolvers<void>()
    const secondCleanup = Promise.withResolvers<void>()
    const manifest = makeManifest("example.single-cleanup")
    let cleanupGeneration = 0
    let finished = 0

    runtime.register(
      manifest,
      (ctx: Context) => {
        cleanupGeneration += 1
        const generation = cleanupGeneration
        ctx.effect(() => async () => {
          if (generation === 1) await firstCleanup.promise
          if (generation === 2) await secondCleanup.promise
          finished += 1
        })
      },
      "builtin"
    )
    await runtime.startAndWait(manifest.id)

    let stopped = false
    const stopping = runtime.stopAndWait(manifest.id).then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)
    expect(finished).toBe(0)
    firstCleanup.resolve()
    await stopping
    expect(finished).toBe(1)

    await runtime.startAndWait(manifest.id)
    let unregistered = false
    const unregistering = runtime.unregisterAndWait(manifest.id).then(() => {
      unregistered = true
    })
    await Promise.resolve()
    expect(unregistered).toBe(false)
    expect(finished).toBe(1)
    secondCleanup.resolve()
    await unregistering
    expect(finished).toBe(2)
    expect(runtime.get(manifest.id)).toBeUndefined()
    await runtime.dispose()
  })

  it("does not restart optional consumers while disposing", async () => {
    const runtime = new PluginRuntime()
    let applies = 0
    const provider = makeManifest("example.dispose-provider", {
      kind: "runtime",
      provides: ["ui"],
    })
    const optional = definePlugin({
      manifest: makeManifest("example.dispose-optional", { kind: "feature" }),
      optionalInject: ["ui"] as const,
      apply() {
        applies += 1
      },
    })

    // Provider first: releasing its service must not revive the optional
    // consumer while the runtime is walking through disposal.
    runtime.register(provider, (ctx) => ctx.set("ui", { label: "root" }), "builtin")
    runtime.register(optional, "builtin")
    await runtime.startAndWait(provider.id)
    await runtime.startAndWait(optional.manifest.id)
    expect(applies).toBe(1)

    await runtime.dispose()
    expect(applies).toBe(1)
    expect(runtime.get(optional.manifest.id)).toBeUndefined()
  })

  it("keeps effect-returned resource identity and prototype while awaiting disposal", async () => {
    const runtime = new PluginRuntime()
    const releaseCleanup = Promise.withResolvers<void>()

    class Resource {
      disposed = 0
      ping(): string {
        return "pong"
      }
      async dispose(): Promise<void> {
        this.disposed += 1
        await releaseCleanup.promise
      }
    }

    let returned: Resource | undefined
    const manifest = makeManifest("example.resource")
    runtime.register(
      manifest,
      (ctx: Context) => {
        const resource = new Resource()
        returned = ctx.effect(() => resource)
      },
      "builtin"
    )

    await runtime.startAndWait(manifest.id)
    expect(returned).toBeInstanceOf(Resource)
    expect(returned?.ping()).toBe("pong")

    runtime.stop(manifest.id)
    expect(returned?.disposed).toBe(1)
    returned?.dispose()
    expect(returned?.disposed).toBe(1)

    const disposal = runtime.dispose()
    let settled = false
    void disposal.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    releaseCleanup.resolve()
    await disposal
    expect(settled).toBe(true)
  })

  it("recycles cleanup registrations after unregister and keeps re-registration isolated", async () => {
    const runtime = new PluginRuntime()
    const releaseCleanup = Promise.withResolvers<void>()
    const manifest = makeManifest("example.cleanup-bucket")
    // Test-only introspection: the cleanup registry is private runtime state.
    const internals = runtime as unknown as {
      cleanupById: Map<string, Set<Promise<void>>>
    }
    const cleanupById = internals.cleanupById

    runtime.register(
      manifest,
      (ctx: Context) => {
        ctx.effect(() => async () => {
          await releaseCleanup.promise
        })
      },
      "builtin"
    )
    await runtime.startAndWait(manifest.id)
    runtime.unregister(manifest.id)
    expect(cleanupById.has(manifest.id)).toBe(true)

    // The pending cleanup belongs to a retired registration; re-registering
    // must keep its own bucket entry once the old promise settles.
    runtime.register(manifest, () => {}, "builtin")
    releaseCleanup.resolve()
    await runtime.flush()
    expect(cleanupById.has(manifest.id)).toBe(true)

    await runtime.startAndWait(manifest.id)
    runtime.unregister(manifest.id)
    expect(cleanupById.has(manifest.id)).toBe(false)
    await runtime.dispose()
  })

  it("coalesces state notifications inside runtime.batch()", async () => {
    const runtime = new PluginRuntime()
    const listener = vi.fn()
    const unsubscribe = runtime.subscribe(listener)

    runtime.batch(() => {
      runtime.register(makeManifest("example.batch-a"), () => {}, "builtin")
      runtime.register(makeManifest("example.batch-b"), () => {}, "builtin")
      runtime.register(makeManifest("example.batch-c"), () => {}, "builtin")
    })

    expect(listener).toHaveBeenCalledTimes(1)
    expect(runtime.getSnapshot().map((item) => item.manifest.id)).toEqual([
      "example.batch-a",
      "example.batch-b",
      "example.batch-c",
    ])

    unsubscribe()
    await runtime.dispose()
  })

  it("does not abort startAndWait when an optional service arrives while the consumer is waiting on required services", async () => {
    const runtime = new PluginRuntime()
    const releaseBase = Promise.withResolvers<void>()
    const consumerObserved: Array<string | undefined> = []

    const baseProvider = makeManifest("example.async-base", {
      kind: "runtime",
      provides: ["storage"],
    })
    const optionalProvider = makeManifest("example.opt-provider", {
      kind: "feature",
      inject: ["storage"],
      provides: ["ui"],
    })
    const consumer = definePlugin({
      manifest: makeManifest("example.opt-consumer", {
        kind: "feature",
        inject: ["storage"],
      }),
      inject: ["storage"] as const,
      optionalInject: ["ui"] as const,
      apply(ctx) {
        consumerObserved.push(readFacadeLabel(ctx.ui))
      },
    })

    runtime.register(
      baseProvider,
      async (ctx) => {
        await releaseBase.promise
        ctx.set("storage", new LabelledRootService("storage-ready"))
      },
      "builtin"
    )
    runtime.register(
      optionalProvider,
      (ctx) => {
        ctx.set("ui", new LabelledRootService("ui-ready"))
      },
      "builtin"
    )
    runtime.register(consumer, "builtin")

    const pending = Promise.all([
      runtime.startAndWait(baseProvider.id),
      runtime.startAndWait(optionalProvider.id),
      runtime.startAndWait(consumer.manifest.id),
    ])

    expect(runtime.get(consumer.manifest.id)?.status).toBe("waiting")
    releaseBase.resolve()
    await pending

    expect(runtime.get(consumer.manifest.id)?.status).toBe("active")
    expect(consumerObserved).toEqual(["ui-ready"])
    await runtime.dispose()
  })

  it("remounts an in-flight async plugin on optional service arrival without failing startAndWait", async () => {
    const runtime = new PluginRuntime()
    const firstAttemptGate = Promise.withResolvers<void>()
    const observed: Array<string | undefined> = []

    const consumer = definePlugin({
      manifest: makeManifest("example.async-opt-consumer", { kind: "feature" }),
      optionalInject: ["ui"] as const,
      async apply(ctx) {
        const label = readFacadeLabel(ctx.ui)
        observed.push(label)
        if (label === undefined) {
          await firstAttemptGate.promise
        }
      },
    })

    runtime.register(consumer, "builtin")
    const pending = runtime.startAndWait(consumer.manifest.id)
    expect(runtime.get(consumer.manifest.id)?.status).toBe("starting")

    // Providing the optional service remounts the consumer in-place without
    // bumping the mount generation or leaving stale pendingCount behind.
    runtime.context.set("ui", new LabelledRootService("late-ui"))
    await pending

    expect(runtime.get(consumer.manifest.id)?.status).toBe("active")
    expect(observed).toEqual([undefined, "late-ui"])
    firstAttemptGate.resolve()
    await runtime.dispose()
  })
})
