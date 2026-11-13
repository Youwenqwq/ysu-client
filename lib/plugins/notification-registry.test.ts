import { describe, expect, it, vi } from "vitest"
import type { PluginManifest, PluginNotificationService } from "@orahako/plugin-sdk"
import { PluginRuntime } from "./runtime"
import { PluginNotificationRegistry } from "./notification-registry"

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

const grades = manifest("example.grades")
const exams = manifest("example.exams")
const schedule = manifest("example.schedule")

function setup() {
  const registry = new PluginNotificationRegistry()
  const runtime = new PluginRuntime(registry.createService)
  return { registry, runtime }
}

describe("PluginNotificationRegistry", () => {
  it("publishes registered channels in canonical order", () => {
    const { registry, runtime } = setup()
    runtime.register(
      grades,
      (ctx) => {
        ctx.notifications.register("schedule")
        ctx.notifications.register("grades")
      },
      "external"
    )
    runtime.start(grades.id)

    expect(registry.getSnapshot()).toEqual(["grades", "schedule"])
  })

  it("merges repeated channels and balances repeated registrations", () => {
    const { registry, runtime } = setup()
    let release: (() => void) | undefined
    runtime.register(
      grades,
      (ctx) => {
        release = ctx.notifications.register("exams")
        ctx.notifications.register("exams")
      },
      "external"
    )
    runtime.register(exams, (ctx) => ctx.notifications.register("exams"), "external")
    runtime.start(grades.id)
    runtime.start(exams.id)

    expect(registry.getSnapshot()).toEqual(["exams"])
    release?.()
    expect(registry.getSnapshot()).toEqual(["exams"])

    runtime.stop(grades.id)
    expect(registry.getSnapshot()).toEqual(["exams"])
    runtime.stop(exams.id)
    expect(registry.getSnapshot()).toEqual([])
  })

  it("releases only the channels owned by the disposed plugin", () => {
    const { registry, runtime } = setup()
    runtime.register(
      grades,
      (ctx) => {
        ctx.notifications.register("grades")
        ctx.notifications.register("exams")
      },
      "external"
    )
    runtime.register(schedule, (ctx) => ctx.notifications.register("schedule"), "external")
    runtime.start(grades.id)
    runtime.start(schedule.id)
    expect(registry.getSnapshot()).toEqual(["grades", "exams", "schedule"])

    runtime.stop(grades.id)
    expect(registry.getSnapshot()).toEqual(["schedule"])
  })

  it("notifies subscribers only when the channel set changes", () => {
    const { runtime } = setup()
    const listener = vi.fn()
    let service: PluginNotificationService | undefined
    let release: (() => void) | undefined
    runtime.register(
      grades,
      (ctx) => {
        service = ctx.notifications
        service.subscribe(listener)
        release = service.register("grades")
      },
      "external"
    )
    runtime.register(exams, (ctx) => ctx.notifications.register("grades"), "external")
    runtime.start(grades.id)
    expect(listener).toHaveBeenCalledTimes(1)
    const snapshot = service?.getSnapshot()
    expect(snapshot).toEqual(["grades"])

    runtime.start(exams.id)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(service?.getSnapshot()).toBe(snapshot)

    release?.()
    expect(listener).toHaveBeenCalledTimes(1)
    runtime.stop(exams.id)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(service?.getSnapshot()).toEqual([])
  })

  it("does not leak channels when a plugin restarts", () => {
    const { registry, runtime } = setup()
    runtime.register(grades, (ctx) => ctx.notifications.register("exams"), "external")
    runtime.start(grades.id)
    runtime.stop(grades.id)
    expect(registry.getSnapshot()).toEqual([])

    runtime.start(grades.id)
    expect(registry.getSnapshot()).toEqual(["exams"])
  })
})
