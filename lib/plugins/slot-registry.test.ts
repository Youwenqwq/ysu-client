import { describe, expect, it, vi } from "vitest"
import type { PluginManifest, PluginSlotService } from "@orahako/plugin-sdk"
import { PluginRuntime } from "./runtime"
import { PluginSlotRegistry } from "./slot-registry"

const owner: PluginManifest = {
  id: "example.shell",
  name: "Shell",
  version: "1.0.0",
  apiVersion: 1,
  kind: "shell",
  entry: "index.js",
}

const extension: PluginManifest = {
  id: "example.extension",
  name: "Extension",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

function Component() {
  return null
}

function setup() {
  const registry = new PluginSlotRegistry()
  const runtime = new PluginRuntime(registry.createService)
  return { registry, runtime }
}

describe("PluginSlotRegistry", () => {
  it("orders list contributions and removes them with their plugin", () => {
    const { registry, runtime } = setup()
    runtime.register(
      owner,
      (ctx) => ctx.slots.declare({ name: "shell.overlay", kind: "list" }),
      "builtin"
    )
    runtime.register(
      extension,
      (ctx) => {
        ctx.slots.register({ id: "later", slot: "shell.overlay", component: Component, order: 20 })
        ctx.slots.register({ id: "first", slot: "shell.overlay", component: Component, order: 10 })
      },
      "external"
    )
    runtime.start(owner.id)
    runtime.start(extension.id)

    expect(registry.getSnapshot().contributions.map((item) => item.id)).toEqual(["first", "later"])
    runtime.stop(extension.id)
    expect(registry.getSnapshot().contributions).toEqual([])
    runtime.stop(owner.id)
    expect(registry.getSnapshot().declarations).toEqual([])
  })

  it("selects the lowest-priority single and the requested keyed occupant", () => {
    const { registry, runtime } = setup()
    runtime.register(
      owner,
      (ctx) => {
        ctx.slots.declare({ name: "root", kind: "single" })
        ctx.slots.declare({ name: "main", kind: "keyed" })
      },
      "builtin"
    )
    runtime.register(
      extension,
      (ctx) => {
        ctx.slots.register({ id: "default", slot: "root", component: Component })
        ctx.slots.register({ id: "override", slot: "root", component: Component, priority: 10 })
        ctx.slots.register({ id: "home", slot: "main", key: "home", component: Component })
        ctx.slots.register({ id: "settings", slot: "main", key: "settings", component: Component })
      },
      "external"
    )
    runtime.start(owner.id)
    runtime.start(extension.id)

    expect(registry.select("root").map((item) => item.id)).toEqual(["override"])
    expect(registry.select("main", "home").map((item) => item.id)).toEqual(["home"])
    expect(registry.select("main", "settings").map((item) => item.id)).toEqual(["settings"])
    expect(registry.select("main", "missing")).toEqual([])
  })

  it("removes contributions from other plugins when the slot owner stops", () => {
    const { registry, runtime } = setup()
    runtime.register(owner, (ctx) => ctx.slots.declare({ name: "main", kind: "keyed" }), "builtin")
    runtime.register(
      extension,
      (ctx) => ctx.slots.register({ id: "home", slot: "main", key: "home", component: Component }),
      "external"
    )
    runtime.start(owner.id)
    runtime.start(extension.id)
    expect(registry.getSnapshot().contributions).toHaveLength(1)

    runtime.stop(owner.id)
    expect(registry.getSnapshot().contributions).toEqual([])
  })

  it("rejects registrations from a disposed async continuation", async () => {
    const { registry, runtime } = setup()
    let resume: (() => void) | undefined
    let slots: PluginSlotService | undefined
    runtime.register(owner, (ctx) => ctx.slots.declare({ name: "main", kind: "list" }), "builtin")
    runtime.register(
      extension,
      async (ctx) => {
        slots = ctx.slots
        await new Promise<void>((resolve) => {
          resume = resolve
        })
      },
      "external"
    )
    runtime.start(owner.id)
    runtime.start(extension.id)
    runtime.stop(extension.id)
    resume?.()
    await Promise.resolve()
    expect(() => slots?.register({ id: "leaked", slot: "main", component: Component })).toThrow()
    expect(registry.getSnapshot().contributions).toEqual([])
  })

  it("rejects undeclared slots and ambiguous single occupants", async () => {
    const { runtime } = setup()
    runtime.register(
      extension,
      (ctx) => ctx.slots.register({ id: "invalid", slot: "missing", component: Component }),
      "external"
    )
    runtime.start(extension.id)
    await vi.waitFor(() => expect(runtime.get(extension.id)?.status).toBe("failed"))
    expect(runtime.get(extension.id)?.error).toContain("not declared")

    const { runtime: conflictRuntime } = setup()
    conflictRuntime.register(
      owner,
      (ctx) => {
        ctx.slots.declare({ name: "root", kind: "single" })
        ctx.slots.register({ id: "one", slot: "root", component: Component })
        ctx.slots.register({ id: "two", slot: "root", component: Component })
      },
      "builtin"
    )
    conflictRuntime.start(owner.id)
    await vi.waitFor(() => expect(conflictRuntime.get(owner.id)?.status).toBe("failed"))
    expect(conflictRuntime.get(owner.id)?.error).toContain("ambiguous")
  })
})
