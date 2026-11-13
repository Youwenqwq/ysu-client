import { describe, expect, it, vi } from "vitest"
import type { PluginManifest } from "@ysu/plugin-sdk"
import { PluginLifecycleRegistry } from "./lifecycle-service"
import { PluginRuntime } from "./runtime"

const manifest: PluginManifest = {
  id: "example.lifecycle",
  name: "Lifecycle",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

describe("PluginLifecycleRegistry", () => {
  it("notifies active plugins after each provider initialization", async () => {
    const registry = new PluginLifecycleRegistry()
    const runtime = new PluginRuntime(registry.createService)
    const listener = vi.fn()
    runtime.register(
      manifest,
      (ctx) => {
        ctx.hostLifecycle.onProviderReady(listener)
      },
      "external"
    )
    runtime.start(manifest.id)

    registry.setProviderReady(true)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
    registry.setProviderReady(false)
    registry.setProviderReady(true)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2))

    runtime.stop(manifest.id)
    registry.setProviderReady(false)
    registry.setProviderReady(true)
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("schedules late subscribers", async () => {
    const registry = new PluginLifecycleRegistry()
    const runtime = new PluginRuntime(registry.createService)
    registry.setProviderReady(true)
    const listener = vi.fn()
    runtime.register(
      manifest,
      (ctx) => {
        ctx.hostLifecycle.onProviderReady(listener)
      },
      "external"
    )
    runtime.start(manifest.id)
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce())
  })

  it("does not run a scheduled listener after plugin disposal", async () => {
    const registry = new PluginLifecycleRegistry()
    const runtime = new PluginRuntime(registry.createService)
    registry.setProviderReady(true)
    const listener = vi.fn()
    runtime.register(
      manifest,
      (ctx) => {
        ctx.hostLifecycle.onProviderReady(listener)
      },
      "external"
    )
    runtime.start(manifest.id)
    runtime.stop(manifest.id)
    await Promise.resolve()
    expect(listener).not.toHaveBeenCalled()
  })
})
