import { describe, expect, it } from "vitest"
import type { PluginManifest } from "@orahako/plugin-sdk"
import { PluginNotificationRegistry } from "@/lib/plugins/notification-registry"
import { PluginRuntime } from "@/lib/plugins/runtime"
import { PluginSettingsRegistry } from "@/lib/plugins/settings-registry"
import { PluginSlotRegistry } from "@/lib/plugins/slot-registry"
import { definition, manifest } from "./index"

const shellManifest: PluginManifest = {
  id: "test.shell",
  name: "Test shell",
  version: "1.0.0",
  apiVersion: 1,
  kind: "shell",
  entry: "index.js",
}

const reminderManifest: PluginManifest = {
  id: "test.reminder",
  name: "Test reminder",
  version: "1.0.0",
  apiVersion: 1,
  kind: "feature",
  entry: "index.js",
}

function ReminderSettings() {
  return null
}

describe("notifications plugin", () => {
  it("owns one settings category and cascades nested contributions on disposal", () => {
    const slots = new PluginSlotRegistry()
    const notifications = new PluginNotificationRegistry()
    const settings = new PluginSettingsRegistry()
    const runtime = new PluginRuntime((ctx, plugin) => {
      slots.createService(ctx, plugin)
      notifications.createService(ctx, plugin)
      settings.createService(ctx, plugin)
    })
    runtime.register(
      shellManifest,
      (ctx) => {
        ctx.slots.declare({ name: "shell.overlay", kind: "list" })
      },
      "builtin"
    )
    runtime.start(shellManifest.id)
    runtime.register(manifest, definition, "builtin")
    runtime.start(manifest.id)
    runtime.register(
      reminderManifest,
      (ctx) => {
        ctx.slots.register({
          id: "reminder",
          slot: "settings.notifications.reminders",
          component: ReminderSettings,
        })
        ctx.slots.register({
          id: "app-reminder",
          slot: "settings.notifications.appReminders",
          component: ReminderSettings,
        })
        ctx.notifications.register("schedule")
      },
      "builtin"
    )
    runtime.start(reminderManifest.id)

    expect(settings.getSnapshot()).toEqual([
      expect.objectContaining({ pluginId: manifest.id, id: "notifications" }),
    ])
    expect(slots.select("shell.overlay")).toEqual([
      expect.objectContaining({ pluginId: manifest.id, id: "runtime" }),
    ])
    expect(slots.select("settings.notifications.reminders")).toEqual([
      expect.objectContaining({ pluginId: reminderManifest.id, id: "reminder" }),
    ])
    expect(slots.select("settings.notifications.appReminders")).toEqual([
      expect.objectContaining({ pluginId: reminderManifest.id, id: "app-reminder" }),
    ])
    expect(notifications.getSnapshot()).toEqual(["schedule"])

    runtime.stop(reminderManifest.id)
    expect(slots.select("settings.notifications.reminders")).toEqual([])
    expect(slots.select("settings.notifications.appReminders")).toEqual([])
    expect(notifications.getSnapshot()).toEqual([])

    runtime.start(reminderManifest.id)
    expect(slots.select("settings.notifications.reminders")).toHaveLength(1)
    runtime.stop(manifest.id)
    expect(slots.select("settings.notifications.reminders")).toEqual([])
    expect(slots.select("settings.notifications.appReminders")).toEqual([])
    expect(settings.getSnapshot()).toEqual([])
    expect(slots.select("shell.overlay")).toEqual([])
  })
})
