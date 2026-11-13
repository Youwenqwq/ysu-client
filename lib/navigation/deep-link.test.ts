import { describe, expect, it } from "vitest"
import { isCurrentNotificationDestination, notificationDestination } from "./deep-link"
import type { SemanticNavSources } from "../plugins/navigation"

const registry = (pages: SemanticNavSources["pages"]): SemanticNavSources => ({
  pages,
  navigation: [],
  capabilities: { grades: true, exams: true, schedule: true } as SemanticNavSources["capabilities"],
})

const liveRegistry = registry([
  { pluginId: "ysu.grades", id: "index", route: "grades" },
  { pluginId: "ysu.exams", id: "index", route: "exams" },
  { pluginId: "ysu.schedule", id: "index", route: "schedule" },
])

describe("notification deep links", () => {
  it("resolves a semantic host to the live plugin page", () => {
    expect(notificationDestination("orahako://schedule", liveRegistry)).toBe(
      "/dashboard/plugin/?plugin=ysu.schedule&page=index"
    )
    expect(notificationDestination("orahako://grades", liveRegistry)).toBe(
      "/dashboard/plugin/?plugin=ysu.grades&page=index"
    )
    expect(notificationDestination("orahako://exams", liveRegistry)).toBe(
      "/dashboard/plugin/?plugin=ysu.exams&page=index"
    )
  })
  it("falls back to a core page when the target plugin is missing or lacks capability", () => {
    expect(notificationDestination("orahako://schedule", registry([]))).toBe("/dashboard/me")
    const noCapability: SemanticNavSources = {
      pages: [
        { pluginId: "org.other.schedule", id: "index", route: "schedule", capability: "schedule" },
      ],
      navigation: [],
      capabilities: { schedule: false } as SemanticNavSources["capabilities"],
    }
    expect(notificationDestination("orahako://schedule", noCapability)).toBe("/dashboard/me")
  })

  it("matches the complete plugin destination including query", () => {
    const destination = notificationDestination("orahako://grades", liveRegistry)!
    expect(destination).toBe("/dashboard/plugin/?plugin=ysu.grades&page=index")
    expect(
      isCurrentNotificationDestination(
        "/dashboard/plugin",
        "?plugin=ysu.grades&page=index",
        destination
      )
    ).toBe(true)
    expect(
      isCurrentNotificationDestination(
        "/dashboard/plugin",
        "?plugin=ysu.exams&page=index",
        destination
      )
    ).toBe(false)
    expect(isCurrentNotificationDestination("/dashboard/me", "", destination)).toBe(false)
  })

  it("keeps settings links and rejects unrelated protocols", () => {
    expect(notificationDestination("orahako://settings")).toBe("/dashboard/me/settings")
    expect(notificationDestination("https://grades")).toBeNull()
    // An unmapped host stays ignored rather than forcing a fallback destination.
    expect(notificationDestination("orahako://unknown", liveRegistry)).toBeNull()
  })
})
