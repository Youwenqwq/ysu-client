import { describe, expect, it, vi } from "vitest"
import { Context } from "@cordisjs/core"
import { PLUGIN_SERVICE_SCOPE, type PluginManifest } from "@orahako/plugin-sdk"
import { PluginDependencyError, PluginRuntime } from "./runtime"

const manifest: PluginManifest = {
  id: "example.feature",
  name: "Example",
  version: "1.0.0",
  apiVersion: 2,
  kind: "feature",
  entry: "index.js",
}

/** Root service implementing the scoped-facade protocol, like host registries do. */
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

describe("PluginRuntime", () => {
  it("starts, restarts, and disposes plugin effects", () => {
    const runtime = new PluginRuntime()
    const dispose = vi.fn()
    runtime.register(
      manifest,
      (ctx) => {
        ctx.on("dispose", dispose)
      },
      "builtin"
    )

    runtime.start(manifest.id)
    expect(runtime.get(manifest.id)?.status).toBe("active")
    runtime.stop(manifest.id)
    expect(dispose).toHaveBeenCalledOnce()
    expect(runtime.get(manifest.id)?.status).toBe("disabled")

    runtime.start(manifest.id)
    runtime.unregister(manifest.id)
    expect(dispose).toHaveBeenCalledTimes(2)
    expect(runtime.get(manifest.id)).toBeUndefined()
  })

  it("does not accumulate Cordis registry entries across restarts", () => {
    const runtime = new PluginRuntime()
    runtime.register(manifest, vi.fn(), "builtin")
    const size = runtime.context.registry.size
    for (let index = 0; index < 5; index++) {
      runtime.start(manifest.id)
      runtime.stop(manifest.id)
    }
    expect(runtime.context.registry.size).toBe(size)
  })

  it("waits for async definitions and reports rejection", async () => {
    const runtime = new PluginRuntime()
    runtime.register(
      manifest,
      async () => {
        await Promise.resolve()
        throw new Error("async failure")
      },
      "external"
    )
    await expect(runtime.startAndWait(manifest.id)).rejects.toThrow("async failure")
    expect(runtime.get(manifest.id)?.status).toBe("failed")
  })

  it("settles synchronous definition failures as failed", async () => {
    const runtime = new PluginRuntime()
    runtime.register(
      manifest,
      () => {
        throw new Error("sync failure")
      },
      "external"
    )
    runtime.start(manifest.id)
    await vi.waitFor(() => expect(runtime.get(manifest.id)?.status).toBe("failed"))
    expect(runtime.get(manifest.id)?.error).toContain("sync failure")
  })

  it("reports async startup until the definition settles", async () => {
    const runtime = new PluginRuntime()
    const started = Promise.withResolvers<void>()
    runtime.register(
      manifest,
      async () => {
        await started.promise
      },
      "external"
    )
    runtime.start(manifest.id)
    expect(runtime.get(manifest.id)?.status).toBe("starting")
    started.resolve()
    await vi.waitFor(() => expect(runtime.get(manifest.id)?.status).toBe("active"))
  })

  it("fails a plugin that never finishes startup instead of blocking the app", async () => {
    vi.useFakeTimers()
    const runtime = new PluginRuntime()
    const pending = Promise.withResolvers<void>()
    runtime.register(manifest, () => pending.promise, "external")
    const starting = runtime.startAndWait(manifest.id)
    const expectation = expect(starting).rejects.toThrow("Plugin startup timed out")
    await vi.advanceTimersByTimeAsync(10_000)
    await expectation
    expect(runtime.get(manifest.id)?.status).toBe("failed")
    vi.useRealTimers()
  })

  it("requires active dependencies and cascades disable", () => {
    const runtime = new PluginRuntime()
    const dependent = { ...manifest, id: "example.dependent", requires: { [manifest.id]: "^1.0.0" } }
    runtime.register(manifest, vi.fn(), "builtin")
    runtime.register(dependent, vi.fn(), "external")
    expect(() => runtime.start(dependent.id)).toThrow("dependency is not active")
    expect(runtime.get(dependent.id)).toMatchObject({ status: "registered", error: undefined })
    runtime.start(manifest.id)
    runtime.start(dependent.id)
    expect(runtime.get(dependent.id)?.status).toBe("active")
    runtime.stop(manifest.id)
    expect(runtime.get(dependent.id)?.status).toBe("disabled")
  })

  it("ignores late errors from a disposed generation", async () => {
    const runtime = new PluginRuntime()
    const contexts: Context[] = []
    runtime.register(
      manifest,
      (ctx) => {
        contexts.push(ctx)
      },
      "external"
    )
    await runtime.startAndWait(manifest.id)
    const registrySize = runtime.context.registry.size
    runtime.stop(manifest.id)
    await runtime.startAndWait(manifest.id)
    expect(runtime.context.registry.size).toBe(registrySize)

    contexts[0].emit(contexts[0], "internal/error", new Error("late failure"))
    expect(runtime.get(manifest.id)).toMatchObject({ status: "active", error: undefined })
    expect(contexts).toHaveLength(2)
    expect(contexts[0]).not.toBe(contexts[1])

    runtime.unregister(manifest.id)
    expect(runtime.context.registry.size).toBe(registrySize - 1)
  })

  it("restarts an active plugin when its implementation is replaced", () => {
    const runtime = new PluginRuntime()
    const first = vi.fn()
    const second = vi.fn()
    runtime.register(manifest, first, "external")
    runtime.start(manifest.id)
    runtime.register({ ...manifest, version: "1.1.0" }, second, "external")

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    expect(runtime.get(manifest.id)).toMatchObject({
      status: "active",
      manifest: { version: "1.1.0" },
    })
  })

  it("does not restart an active async plugin while waiting for update", async () => {
    const runtime = new PluginRuntime()
    runtime.register(manifest, vi.fn(), "external")
    runtime.start(manifest.id)
    const updated = Promise.withResolvers<void>()
    const second = vi.fn(async () => {
      await updated.promise
    })
    runtime.register({ ...manifest, version: "1.1.0" }, second, "external")
    const waiting = runtime.startAndWait(manifest.id)
    expect(second).toHaveBeenCalledOnce()
    expect(runtime.get(manifest.id)?.status).toBe("starting")
    updated.resolve()
    await waiting
    expect(runtime.get(manifest.id)?.status).toBe("active")
  })

  it("stops safely after a hot update introduces a self dependency", () => {
    const runtime = new PluginRuntime()
    runtime.register(manifest, vi.fn(), "external")
    runtime.start(manifest.id)
    runtime.register({ ...manifest, requires: { [manifest.id]: "^1.0.0" } }, vi.fn(), "external")
    expect(() => runtime.stop(manifest.id)).not.toThrow()
    expect(runtime.get(manifest.id)?.status).toBe("disabled")
  })

  it("notifies subscribers with an immutable snapshot", () => {
    const runtime = new PluginRuntime()
    const listener = vi.fn()
    const unsubscribe = runtime.subscribe(listener)
    runtime.register(manifest, vi.fn(), "builtin")
    expect(listener).toHaveBeenCalledOnce()
    expect(runtime.getSnapshot()[0].manifest.id).toBe(manifest.id)
    unsubscribe()
    runtime.start(manifest.id)
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe("PluginRuntime root services", () => {
  it("refuses to start a plugin whose required root service is missing", () => {
    const runtime = new PluginRuntime()
    const apply = vi.fn()
    const consumer: PluginManifest = { ...manifest, id: "example.consumer", inject: ["ui"] }
    runtime.register(consumer, apply, "builtin")

    expect(() => runtime.start(consumer.id)).toThrow(PluginDependencyError)
    expect(() => runtime.start(consumer.id)).toThrow("Required service is not available: ui")
    expect(apply).not.toHaveBeenCalled()
    expect(runtime.get(consumer.id)).toMatchObject({ status: "registered", error: undefined })

    runtime.context.set("ui", new ScopedRootService())
    runtime.start(consumer.id)
    expect(apply).toHaveBeenCalledOnce()
    expect(runtime.get(consumer.id)?.status).toBe("active")
  })

  it("binds one scoped facade per consumer manifest", () => {
    const runtime = new PluginRuntime()
    const root = new ScopedRootService()
    runtime.context.set("ui", root)

    const owners: unknown[] = []
    const alpha: PluginManifest = { ...manifest, id: "example.alpha", inject: ["ui"] }
    const beta: PluginManifest = { ...manifest, id: "example.beta", inject: ["ui"] }
    runtime.register(
      alpha,
      (ctx) => {
        owners.push(ctx.ui)
      },
      "builtin"
    )
    runtime.register(
      beta,
      (ctx) => {
        owners.push(ctx.ui)
      },
      "builtin"
    )
    runtime.start(alpha.id)
    runtime.start(beta.id)

    expect(owners).toEqual([{ owner: "example.alpha" }, { owner: "example.beta" }])
    expect(root.facades.map((facade) => facade.manifest.id)).toEqual([
      "example.alpha",
      "example.beta",
    ])
    expect(runtime.context.get("ui")).toBe(root)
    expect(root.facades[0].ctx).not.toBe(root.facades[1].ctx)
    for (const facade of root.facades) {
      expect(facade.ctx).not.toBe(runtime.context)
    }
  })

  it("captures the final consumer context in every scoped facade", () => {
    const runtime = new PluginRuntime()
    const root = new ScopedRootService()
    runtime.context.set("ui", root)
    runtime.context.set("http", new LabelledRootService("http"))
    const consumer: PluginManifest = {
      ...manifest,
      id: "example.consumer",
      inject: ["ui", "http"],
    }
    let definitionContext: Context | undefined
    runtime.register(
      consumer,
      (ctx) => {
        definitionContext = ctx
      },
      "builtin"
    )
    runtime.start(consumer.id)

    expect(root.facades[0]?.ctx).toBe(definitionContext)
    expect(root.facades[0]?.ctx.get("http")).toEqual({ label: "http" })
    expect(root.facades[0]?.ctx.get("http")).not.toBe(runtime.context.get("http"))
    runtime.dispose()
  })

  it("recreates the facade and disposes the consumer when its service restarts", () => {
    const runtime = new PluginRuntime()
    const root = new ScopedRootService()
    runtime.context.set("ui", root)
    const consumer: PluginManifest = { ...manifest, id: "example.consumer", inject: ["ui"] }
    const dispose = vi.fn()
    runtime.register(
      consumer,
      (ctx) => {
        ctx.on("dispose", dispose)
      },
      "builtin"
    )
    runtime.start(consumer.id)
    runtime.stop(consumer.id)
    runtime.start(consumer.id)

    expect(dispose).toHaveBeenCalledOnce()
    expect(root.facades.map((facade) => facade.manifest.id)).toEqual([
      "example.consumer",
      "example.consumer",
    ])
    expect(root.facades[0].ctx).not.toBe(root.facades[1].ctx)
  })

  it("disposes and restarts dependent consumers when a root service is replaced", () => {
    const runtime = new PluginRuntime()
    const release = runtime.context.set("ui", new LabelledRootService("first"))
    const applied: unknown[] = []
    const dispose = vi.fn()
    const consumer: PluginManifest = { ...manifest, id: "example.consumer", inject: ["ui"] }
    runtime.register(
      consumer,
      (ctx) => {
        applied.push(ctx.ui)
        ctx.on("dispose", dispose)
      },
      "builtin"
    )
    runtime.start(consumer.id)
    expect(applied).toEqual([{ label: "first" }])

    release()
    expect(dispose).toHaveBeenCalledOnce()
    expect(applied).toEqual([{ label: "first" }])

    runtime.context.set("ui", new LabelledRootService("second"))
    expect(dispose).toHaveBeenCalledOnce()
    expect(applied).toEqual([{ label: "first" }, { label: "second" }])
    expect(runtime.get(consumer.id)?.status).toBe("active")
  })

  it("leaves plugins without that inject untouched when a root service changes", () => {
    const runtime = new PluginRuntime()
    const independent = vi.fn()
    const consumer: PluginManifest = { ...manifest, id: "example.consumer", inject: ["ui"] }
    const bystander: PluginManifest = { ...manifest, id: "example.bystander" }
    runtime.register(consumer, vi.fn(), "builtin")
    runtime.register(bystander, independent, "builtin")
    const release = runtime.context.set("ui", new LabelledRootService("first"))
    runtime.start(consumer.id)
    runtime.start(bystander.id)
    expect(independent).toHaveBeenCalledOnce()

    release()
    runtime.context.set("ui", new LabelledRootService("second"))
    expect(independent).toHaveBeenCalledOnce()
    expect(runtime.get(bystander.id)?.status).toBe("active")
  })
})
