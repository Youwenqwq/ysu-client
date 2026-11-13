import { describe, expect, it, vi } from "vitest"
import { Context } from "@cordisjs/core"
import type { PluginManifest } from "@ysu/plugin-sdk"
import { PluginRuntime } from "./runtime"

const manifest: PluginManifest = {
  id: "example.feature",
  name: "Example",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
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
    let finish: (() => void) | undefined
    runtime.register(
      manifest,
      async () => {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
      },
      "external"
    )
    runtime.start(manifest.id)
    expect(runtime.get(manifest.id)?.status).toBe("starting")
    finish?.()
    await vi.waitFor(() => expect(runtime.get(manifest.id)?.status).toBe("active"))
  })

  it("requires active dependencies and cascades disable", () => {
    const runtime = new PluginRuntime()
    const dependent = { ...manifest, id: "example.dependent", requires: [manifest.id] }
    runtime.register(manifest, vi.fn(), "builtin")
    runtime.register(dependent, vi.fn(), "external")
    expect(() => runtime.start(dependent.id)).toThrow("dependency is not active")
    expect(runtime.get(dependent.id)?.status).toBe("failed")
    runtime.start(manifest.id)
    runtime.start(dependent.id)
    expect(runtime.get(dependent.id)?.status).toBe("active")
    runtime.stop(manifest.id)
    expect(runtime.get(dependent.id)?.status).toBe("disabled")
  })

  it("ignores late errors from a disposed generation and reuses service slots", async () => {
    const runtime = new PluginRuntime((ctx) => ctx.set("storage", {}))
    const contexts: Context[] = []
    runtime.register(
      manifest,
      (ctx) => {
        contexts.push(ctx)
      },
      "external"
    )
    await runtime.startAndWait(manifest.id)
    const storeSize = Object.getOwnPropertySymbols(runtime.context[Context.store]).length
    runtime.stop(manifest.id)
    await runtime.startAndWait(manifest.id)
    expect(Object.getOwnPropertySymbols(runtime.context[Context.store])).toHaveLength(storeSize)
    contexts[0].emit(contexts[0], "internal/error", new Error("late failure"))
    expect(runtime.get(manifest.id)?.status).toBe("active")
    runtime.unregister(manifest.id)
    expect(Object.getOwnPropertySymbols(runtime.context[Context.store]).length).toBeLessThan(
      storeSize
    )
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
    let finish: (() => void) | undefined
    const updated = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    })
    runtime.register({ ...manifest, version: "1.1.0" }, updated, "external")
    const waiting = runtime.startAndWait(manifest.id)
    expect(updated).toHaveBeenCalledOnce()
    expect(runtime.get(manifest.id)?.status).toBe("starting")
    finish?.()
    await waiting
    expect(runtime.get(manifest.id)?.status).toBe("active")
  })

  it("stops safely after a hot update introduces a self dependency", () => {
    const runtime = new PluginRuntime()
    runtime.register(manifest, vi.fn(), "external")
    runtime.start(manifest.id)
    runtime.register({ ...manifest, requires: [manifest.id] }, vi.fn(), "external")
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
