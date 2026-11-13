import { describe, expect, it, vi } from "vitest"
import type {
  PluginManifest,
  PluginSettingsCategoryContribution,
  PluginSettingsService,
} from "@orahako/plugin-sdk"
import { PluginRuntime } from "./runtime"
import { PluginSettingsRegistry } from "./settings-registry"

function manifest(id: string): PluginManifest {
  return {
    id,
    name: id,
    version: "1.0.0",
    apiVersion: 1,
    kind: "feature",
    entry: "index.js",
  }
}

function category(id: string, order?: number): PluginSettingsCategoryContribution {
  return {
    id,
    title: id,
    description: `${id} settings`,
    icon: () => null,
    component: () => null,
    order,
  }
}

const alpha = manifest("example.alpha")
const beta = manifest("example.beta")

function setup() {
  const registry = new PluginSettingsRegistry()
  const runtime = new PluginRuntime(registry.createService)
  return { registry, runtime }
}

describe("PluginSettingsRegistry", () => {
  it("registers categories with their owner and sorts by order then id", () => {
    const { registry, runtime } = setup()
    runtime.register(
      alpha,
      (ctx) => {
        ctx.settings.registerCategory(category("zeta", 10))
        ctx.settings.registerCategory(category("alpha", 20))
      },
      "external"
    )
    runtime.register(
      beta,
      (ctx) => {
        ctx.settings.registerCategory(category("gamma", 20))
        ctx.settings.registerCategory(category("beta"))
      },
      "external"
    )
    runtime.start(alpha.id)
    runtime.start(beta.id)

    const snapshot = registry.getSnapshot()
    expect(snapshot.map((item) => item.id)).toEqual(["zeta", "alpha", "gamma", "beta"])
    expect(snapshot.map((item) => item.pluginId)).toEqual([alpha.id, alpha.id, beta.id, beta.id])
    expect(snapshot.find((item) => item.id === "alpha")?.title).toBe("alpha")
  })

  it("rejects a category id that another plugin already owns", async () => {
    const { registry, runtime } = setup()
    runtime.register(
      alpha,
      (ctx) => {
        ctx.settings.registerCategory(category("shared", 10))
      },
      "external"
    )
    runtime.register(
      beta,
      (ctx) => {
        ctx.settings.registerCategory(category("shared", 20))
      },
      "external"
    )
    runtime.start(alpha.id)
    runtime.start(beta.id)

    await vi.waitFor(() => expect(runtime.get(beta.id)?.status).toBe("failed"))
    expect(runtime.get(beta.id)?.error).toContain("already registered: shared (example.alpha)")
    expect(registry.getSnapshot().map((item) => item.id)).toEqual(["shared"])
    expect(registry.getSnapshot()[0]?.pluginId).toBe(alpha.id)
  })

  it("rejects an empty category id", async () => {
    const { runtime } = setup()
    runtime.register(
      alpha,
      (ctx) => {
        ctx.settings.registerCategory(category(""))
      },
      "external"
    )
    runtime.start(alpha.id)

    await vi.waitFor(() => expect(runtime.get(alpha.id)?.status).toBe("failed"))
    expect(runtime.get(alpha.id)?.error).toContain("id must not be empty")
  })

  it("releases categories when the owning plugin stops and restores them on restart", () => {
    const { registry, runtime } = setup()
    runtime.register(
      alpha,
      (ctx) => {
        ctx.settings.registerCategory(category("overview", 10))
      },
      "external"
    )
    runtime.register(
      beta,
      (ctx) => {
        ctx.settings.registerCategory(category("grades", 20))
      },
      "external"
    )
    runtime.start(alpha.id)
    runtime.start(beta.id)
    expect(registry.getSnapshot().map((item) => item.id)).toEqual(["overview", "grades"])

    runtime.stop(alpha.id)
    expect(registry.getSnapshot().map((item) => item.id)).toEqual(["grades"])

    runtime.start(alpha.id)
    expect(registry.getSnapshot().map((item) => item.id)).toEqual(["overview", "grades"])

    runtime.stop(alpha.id)
    runtime.stop(beta.id)
    expect(registry.getSnapshot()).toEqual([])

    runtime.start(beta.id)
    expect(registry.getSnapshot().map((item) => item.id)).toEqual(["grades"])
  })

  it("publishes a new snapshot only when the category set changes", () => {
    const { runtime } = setup()
    const listener = vi.fn()
    let service: PluginSettingsService | undefined
    runtime.register(
      alpha,
      (ctx) => {
        service = ctx.settings
        ctx.settings.subscribe(listener)
        ctx.settings.registerCategory(category("overview", 10))
      },
      "external"
    )
    runtime.register(
      beta,
      (ctx) => {
        ctx.settings.registerCategory(category("grades", 20))
      },
      "external"
    )
    runtime.start(alpha.id)
    expect(listener).toHaveBeenCalledTimes(1)
    const afterAlpha = service?.getSnapshot()
    expect(afterAlpha?.map((item) => item.id)).toEqual(["overview"])

    runtime.start(beta.id)
    expect(listener).toHaveBeenCalledTimes(2)
    const afterBeta = service?.getSnapshot()
    expect(afterBeta?.map((item) => item.id)).toEqual(["overview", "grades"])
    expect(afterBeta).not.toBe(afterAlpha)

    runtime.start(alpha.id)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(service?.getSnapshot()).toBe(afterBeta)

    runtime.stop(beta.id)
    expect(listener).toHaveBeenCalledTimes(3)
    expect(service?.getSnapshot()?.map((item) => item.id)).toEqual(["overview"])

    runtime.stop(alpha.id)
    expect(listener).toHaveBeenCalledTimes(4)
    expect(service?.getSnapshot()).toEqual([])
  })

  it("stops notifying an unsubscribed listener", () => {
    const { registry, runtime } = setup()
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)
    runtime.register(
      alpha,
      (ctx) => {
        ctx.settings.registerCategory(category("overview", 10))
      },
      "external"
    )
    runtime.register(
      beta,
      (ctx) => {
        ctx.settings.registerCategory(category("grades", 20))
      },
      "external"
    )
    runtime.start(alpha.id)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    runtime.start(beta.id)
    runtime.stop(beta.id)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
