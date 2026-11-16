import { describe, expect, it } from "vitest"
import { PluginRuntime } from "@/lib/plugins/runtime"
import { PluginSlotRegistry } from "@/plugins/official/runtime/registries/slots"
import { PluginUIRegistry } from "@/plugins/official/runtime/registries/ui"
import { definition, manifest } from "."
import { officialShellPages } from "./pages"

describe("official shell registration", () => {
  it("registers the dashboard layout and every semantic page", () => {
    const runtime = new PluginRuntime()
    const ui = new PluginUIRegistry()
    runtime.context.set("ui", ui)
    runtime.context.set("slots", new PluginSlotRegistry())
    runtime.register(manifest, definition, "builtin")
    runtime.start(manifest.id)

    const snapshot = ui.getSnapshot()
    expect(snapshot.pages.map((page) => page.route)).toEqual(
      officialShellPages.map((page) => page.route)
    )
    expect(snapshot.pages.find((page) => page.route === "login")?.requiresProvider).toBe(false)
    expect(snapshot.pages.filter((page) => page.requiresProvider !== false)).toHaveLength(
      officialShellPages.length - 1
    )
    expect(snapshot.shells).toHaveLength(1)
    expect(snapshot.shells[0]?.id).toBe("default")
    expect(snapshot.shells[0]?.layout).toBeTypeOf("function")
  })
})
