import { describe, expect, it } from "vitest"
import { PluginRuntime } from "@/lib/plugins/runtime"
import { PluginUIRegistry } from "@/lib/plugins/ui-registry"
import { PluginSlotRegistry } from "@/lib/plugins/slot-registry"
import { PluginNotificationRegistry } from "@/lib/plugins/notification-registry"
import { PluginSettingsRegistry } from "@/lib/plugins/settings-registry"
import { definition as shell, manifest as shellManifest } from "../shell"
import {
  definition as notificationDomain,
  manifest as notificationsManifest,
} from "../notifications"
import { definition as overview, manifest as overviewManifest } from "./index"
import { definition as ecard, manifest as ecardManifest } from "../ecard"
import { definition as evaluation, manifest as evaluationManifest } from "../evaluation"
import { definition as grades, manifest as gradesManifest } from "../grades"
import { definition as exams, manifest as examsManifest } from "../exams"
import { definition as schedule, manifest as scheduleManifest } from "../schedule"

describe("overview widget ownership", () => {
  it("keeps feature cards owned by their plugins and removes them on disable", () => {
    const registry = new PluginUIRegistry()
    const slots = new PluginSlotRegistry()
    const notifications = new PluginNotificationRegistry()
    const settings = new PluginSettingsRegistry()
    const runtime = new PluginRuntime((ctx, manifest) => {
      registry.createService(ctx, manifest)
      slots.createService(ctx, manifest)
      notifications.createService(ctx, manifest)
      settings.createService(ctx, manifest)
    })
    const plugins = [
      [shellManifest, shell],
      [notificationsManifest, notificationDomain],
      [overviewManifest, overview],
      [ecardManifest, ecard],
      [evaluationManifest, evaluation],
      [gradesManifest, grades],
      [examsManifest, exams],
      [scheduleManifest, schedule],
    ] as const
    for (const [manifest, definition] of plugins) runtime.register(manifest, definition, "builtin")
    for (const [manifest] of plugins) runtime.start(manifest.id)

    expect(
      registry.getSnapshot().overviewWidgets.map((widget) => [widget.id, widget.pluginId])
    ).toEqual([
      ["week", "orahako.overview"],
      ["ecard", "orahako.ecard"],
      ["gpa", "orahako.grades"],
      ["evaluation", "orahako.evaluation"],
      ["course-progress", "orahako.schedule"],
      ["today-courses", "orahako.schedule"],
      ["upcoming-exams", "orahako.exams"],
      ["evaluation-tasks", "orahako.evaluation"],
    ])

    runtime.stop("orahako.evaluation")
    runtime.stop("orahako.ecard")
    expect(registry.getSnapshot().overviewWidgets.map((widget) => widget.id)).toEqual([
      "week",
      "gpa",
      "course-progress",
      "today-courses",
      "upcoming-exams",
    ])
  })
})
