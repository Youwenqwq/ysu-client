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
