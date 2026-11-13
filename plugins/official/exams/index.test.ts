import { describe, expect, it, vi } from "vitest"
import { validatePluginManifest, type PluginManifest } from "@orahako/plugin-sdk"
import { PluginRuntime } from "@/lib/plugins/runtime"
import { PluginNotificationRegistry } from "@/lib/plugins/notification-registry"
import { PluginSlotRegistry } from "@/lib/plugins/slot-registry"
import { PluginUIRegistry } from "@/lib/plugins/ui-registry"

vi.mock("./page", () => ({ ExamsPage: () => null }))
vi.mock("./settings", () => ({
  ExamNotificationContent: () => null,
  ExamSettingsWidget: () => null,
  ExamCompactSettingsWidget: () => null,
}))

import { definition, manifest } from "./index"

const shellManifest: PluginManifest = {
  id: "orahako.shell",
  name: "Shell",
  version: "1.0.0",
  apiVersion: 1,
  kind: "shell",
  entry: "index.js",
}

function createRuntime() {
  const ui = new PluginUIRegistry()
  const slots = new PluginSlotRegistry()
  const notifications = new PluginNotificationRegistry()
  const runtime = new PluginRuntime((ctx, current) => {
    ui.createService(ctx, current)
    slots.createService(ctx, current)
    notifications.createService(ctx, current)
  })
  runtime.register(
    shellManifest,
    (ctx) => {
      ctx.slots.declare({ name: "settings.startupOptions", kind: "list" })
      ctx.slots.declare({ name: "settings.notifications.content", kind: "list" })
      ctx.slots.declare({ name: "settings.notifications.reminders", kind: "list" })
      ctx.slots.declare({ name: "settings.widgets", kind: "list" })
    },
    "builtin"
  )
  runtime.start(shellManifest.id)
  return { runtime, slots, ui, notifications }
}

describe("exams plugin", () => {
  it("exports a valid manifest", () => {
    expect(validatePluginManifest(manifest)).toBe(manifest)
    expect(manifest.kind).toBe("feature")
  })

  it("registers the exams page and academic navigation", () => {
    const { runtime, ui } = createRuntime()
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

  it("contributes exam notification and widget settings", () => {
    const { runtime, slots, notifications } = createRuntime()
    runtime.register(manifest, definition, "builtin")
    runtime.start(manifest.id)

    expect(notifications.getSnapshot()).toEqual(["exams"])
    expect(slots.select("settings.notifications.content")).toEqual([
      expect.objectContaining({ pluginId: manifest.id, id: "exams", order: 20 }),
    ])
    expect(slots.select("settings.notifications.reminders")).toEqual([])
    expect(slots.select("settings.widgets")).toEqual([
      expect.objectContaining({ pluginId: manifest.id, id: "exam", order: 20 }),
      expect.objectContaining({ pluginId: manifest.id, id: "exam-compact", order: 20 }),
    ])
    expect(slots.select("settings.startupOptions")).toEqual([])

    runtime.stop(manifest.id)
    expect(notifications.getSnapshot()).toEqual([])
    expect(slots.select("settings.notifications.content")).toEqual([])
    expect(slots.select("settings.widgets")).toEqual([])
  })
})
