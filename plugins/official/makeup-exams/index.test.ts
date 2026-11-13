import { describe, expect, it, vi } from "vitest"
import { validatePluginManifest } from "@orahako/plugin-sdk"
import { PluginRuntime } from "@/lib/plugins/runtime"
import { PluginUIRegistry } from "@/lib/plugins/ui-registry"

vi.mock("./page", () => ({ MakeupExamsPage: () => null }))

import { definition, manifest } from "./index"

describe("makeup exams plugin", () => {
  it("exports a valid manifest", () => {
    expect(validatePluginManifest(manifest)).toBe(manifest)
    expect(manifest.kind).toBe("feature")
  })

  it("registers the makeup exams page and academic navigation", () => {
    const ui = new PluginUIRegistry()
    const runtime = new PluginRuntime(ui.createService)
    runtime.register(manifest, definition, "builtin")
    runtime.start(manifest.id)

    const snapshot = ui.getSnapshot()
    expect(snapshot.pages).toEqual([
      expect.objectContaining({
        pluginId: manifest.id,
        id: "index",
        titleKey: "makeupExams.title",
        capability: "makeupExams",
      }),
    ])
    expect(snapshot.navigation).toEqual([
      expect.objectContaining({
        pluginId: manifest.id,
        id: "makeup-exams",
        page: "index",
        group: "academic",
        capability: "makeupExams",
      }),
    ])

    runtime.stop(manifest.id)
    expect(ui.getSnapshot().pages).toHaveLength(0)
    expect(ui.getSnapshot().navigation).toHaveLength(0)
  })
})
