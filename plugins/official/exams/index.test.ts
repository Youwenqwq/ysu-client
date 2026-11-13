import { describe, expect, it, vi } from "vitest"
import { validatePluginManifest } from "@orahako/plugin-sdk"
import { PluginRuntime } from "@/lib/plugins/runtime"
import { PluginUIRegistry } from "@/lib/plugins/ui-registry"

vi.mock("./page", () => ({ ExamsPage: () => null }))

import { definition, manifest } from "./index"

describe("exams plugin", () => {
  it("exports a valid manifest", () => {
    expect(validatePluginManifest(manifest)).toBe(manifest)
    expect(manifest.kind).toBe("feature")
  })

  it("registers the exams page and academic navigation", () => {
    const ui = new PluginUIRegistry()
    const runtime = new PluginRuntime(ui.createService)
    runtime.register(manifest, definition, "builtin")
    runtime.start(manifest.id)

    const snapshot = ui.getSnapshot()
    expect(snapshot.pages).toEqual([
      expect.objectContaining({
        pluginId: manifest.id,
        id: "index",
        titleKey: "exams.title",
        capability: "exams",
      }),
    ])
    expect(snapshot.navigation).toEqual([
      expect.objectContaining({
        pluginId: manifest.id,
        id: "exams",
        page: "index",
        group: "academic",
        capability: "exams",
      }),
    ])

    runtime.stop(manifest.id)
    expect(ui.getSnapshot().pages).toHaveLength(0)
    expect(ui.getSnapshot().navigation).toHaveLength(0)
  })
})
