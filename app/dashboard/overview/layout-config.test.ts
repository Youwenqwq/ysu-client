import { describe, expect, it } from "vitest"
import { moveOverviewWidget, normalizeOverviewLayout } from "./layout-config"

describe("overview layout persistence", () => {
  it("preserves a customized layout while discarding unknown and duplicate widgets", () => {
    const layout = normalizeOverviewLayout({
      version: 1,
      profileVisible: false,
      items: [
        { id: "ecard", visible: true },
        { id: "retired-widget", visible: true },
        { id: "ecard", visible: false },
        null,
        { id: "gpa", visible: "false" },
      ],
    })
    expect(layout.profileVisible).toBe(false)
    expect(layout.items.filter((item) => item.visible).map((item) => item.id)).toEqual(["ecard"])
    expect(layout.items.filter((item) => item.id === "ecard")).toEqual([
      { id: "ecard", visible: true },
    ])
    expect(normalizeOverviewLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
  })

  it("reorders visible widgets without moving hidden slots or the other region", () => {
    const layout = normalizeOverviewLayout({
      version: 1,
      items: [
        { id: "week", visible: true },
        { id: "gpa", visible: false },
        { id: "ecard", visible: true },
        { id: "today-courses", visible: true },
      ],
    })
    const moved = moveOverviewWidget(layout, "ecard", "week")
    expect(moved.items.slice(0, 4)).toEqual([
      { id: "ecard", visible: true },
      { id: "gpa", visible: false },
      { id: "week", visible: true },
      { id: "today-courses", visible: true },
    ])
    expect(layout.items[0].id).toBe("week")
    expect(moveOverviewWidget(moved, "ecard", "today-courses")).toEqual(moved)
    expect(moveOverviewWidget(moved, "gpa", "week")).toEqual(moved)
  })

  it("does not repopulate an intentionally empty overview when new widget IDs are reconciled", () => {
    const layout = normalizeOverviewLayout({ version: 1, profileVisible: false, items: [] })
    expect(layout.profileVisible).toBe(false)
    expect(layout.items.filter((item) => item.visible)).toEqual([])
    expect(normalizeOverviewLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
  })
})
