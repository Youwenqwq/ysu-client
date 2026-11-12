import { describe, expect, it } from "vitest"
import { isCurrentNotificationDestination, notificationDestination } from "./deep-link"

describe("notification deep links", () => {
  it("matches the complete plugin destination including query", () => {
    const destination = notificationDestination("ysuclient://grades")!
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
    expect(notificationDestination("ysuclient://settings")).toBe("/dashboard/me/settings")
    expect(notificationDestination("https://grades")).toBeNull()
  })
})
