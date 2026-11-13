import { describe, expect, it } from "vitest"
import {
  createDefaultOverviewLayout,
  moveOverviewWidget,
  normalizeOverviewLayout,
  type DynamicOverviewWidget,
} from "./layout-config"

const installedWidgets: DynamicOverviewWidget[] = [
  { id: "plugin:demo:summary-card", region: "summary", defaultVisible: true },
  { id: "plugin:demo:summary-more", region: "summary", defaultVisible: true },
  { id: "plugin:demo:content-a", region: "content", defaultVisible: true },
  { id: "plugin:demo:content-b", region: "content", defaultVisible: false },
]

describe("overview layout persistence", () => {
  it("preserves a customized layout while discarding unknown and duplicate widgets", () => {
    const layout = normalizeOverviewLayout({
      version: 1,
      profileVisible: false,
      items: [
        { id: "plugin:demo:summary-card", visible: true },
        { id: "retired-widget", visible: true },
        { id: "plugin:demo:summary-card", visible: false },
        null,
        { id: "plugin:demo:content-a", visible: "false" },
      ],
    })
    expect(layout.profileVisible).toBe(false)
    expect(layout.items).toEqual([
      { id: "plugin:demo:summary-card", visible: true },
      { id: "plugin:demo:content-a", visible: false },
    ])
    expect(normalizeOverviewLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
  })

  it("reorders visible widgets without moving hidden slots or the other region", () => {
    const layout = normalizeOverviewLayout(
      {
        version: 1,
        items: [
          { id: "plugin:demo:summary-card", visible: true },
          { id: "plugin:demo:summary-more", visible: false },
          { id: "plugin:demo:content-a", visible: true },
          { id: "plugin:demo:content-b", visible: true },
        ],
      },
      installedWidgets
    )
    const moved = moveOverviewWidget(
      layout,
      "plugin:demo:content-b",
      "plugin:demo:content-a",
      installedWidgets
    )
    expect(moved.items.slice(2)).toEqual([
      { id: "plugin:demo:content-b", visible: true },
      { id: "plugin:demo:content-a", visible: true },
    ])
    expect(layout.items[2].id).toBe("plugin:demo:content-a")
    expect(
      moveOverviewWidget(
        moved,
        "plugin:demo:summary-card",
        "plugin:demo:content-a",
        installedWidgets
      )
    ).toEqual(moved)
    expect(
      moveOverviewWidget(
        moved,
        "plugin:demo:summary-more",
        "plugin:demo:summary-card",
        installedWidgets
      )
    ).toEqual(moved)
  })

  it("does not repopulate an intentionally empty overview when new widget IDs are reconciled", () => {
    const layout = normalizeOverviewLayout({ version: 1, profileVisible: false, items: [] })
    expect(layout.profileVisible).toBe(false)
    expect(layout.items.filter((item) => item.visible)).toEqual([])
    expect(normalizeOverviewLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
  })
})

describe("overview layout plugin widgets", () => {
  it("builds the default layout from the installed contributions and their visibility", () => {
    const layout = createDefaultOverviewLayout(installedWidgets)
    expect(layout).toEqual({
      version: 1,
      profileVisible: true,
      items: [
        { id: "plugin:demo:summary-card", visible: true },
        { id: "plugin:demo:summary-more", visible: true },
        { id: "plugin:demo:content-a", visible: true },
        { id: "plugin:demo:content-b", visible: false },
      ],
    })
    // Without contributions the core host owns no widgets of its own.
    expect(createDefaultOverviewLayout().items).toEqual([])
  })

  it("preserves plugin widget slots, order and visibility while dropping malformed IDs", () => {
    const layout = normalizeOverviewLayout(
      {
        version: 1,
        profileVisible: false,
        items: [
          { id: "plugin:retired:notice", visible: true },
          { id: "plugin:bad", visible: true },
          { id: "plugin:demo:summary-card", visible: "yes" },
          { id: "plugin:retired:notice", visible: false },
        ],
      },
      installedWidgets
    )
    expect(layout.items.slice(0, 3)).toEqual([
      { id: "plugin:retired:notice", visible: true },
      { id: "plugin:demo:summary-card", visible: false },
      { id: "plugin:demo:summary-more", visible: true },
    ])
    // An installed contribution without a saved slot falls back to its declared default.
    expect(layout.items).toContainEqual({ id: "plugin:demo:content-a", visible: true })
    expect(layout.items).toContainEqual({ id: "plugin:demo:content-b", visible: false })
    // A plugin ID from an uninstalled plugin keeps its slot through repeated normalization.
    expect(normalizeOverviewLayout(JSON.parse(JSON.stringify(layout)))).toEqual(layout)
  })

  it("migrates IDs saved before widgets moved into plugins", () => {
    const overviewWidgets: DynamicOverviewWidget[] = [
      { id: "plugin:org.hub:week", region: "summary", defaultVisible: true },
      { id: "plugin:org.hub:gpa", region: "summary", defaultVisible: false },
      { id: "plugin:org.hub:today-courses", region: "content", defaultVisible: true },
    ]
    const layout = normalizeOverviewLayout(
      {
        version: 1,
        items: [
          { id: "week", visible: true },
          { id: "gpa", visible: true },
          { id: "today-courses", visible: false },
          // A legacy ID whose contribution is not installed stays readable for later.
          { id: "ecard", visible: true },
        ],
      },
      overviewWidgets
    )
    expect(layout.items).toEqual([
      { id: "plugin:org.hub:week", visible: true },
      { id: "plugin:org.hub:gpa", visible: true },
      { id: "plugin:org.hub:today-courses", visible: false },
      { id: "ecard", visible: true },
    ])
    expect(normalizeOverviewLayout(layout, overviewWidgets)).toEqual(layout)
  })

  it("keeps a saved plugin widget visibility when the plugin is reinstalled", () => {
    const saved = normalizeOverviewLayout({
      version: 1,
      items: [
        { id: "plugin:demo:content-a", visible: false },
        { id: "plugin:demo:summary-card", visible: true },
      ],
    })
    const rehydrated = normalizeOverviewLayout(JSON.parse(JSON.stringify(saved)), installedWidgets)
    expect(rehydrated.items.slice(0, 2)).toEqual([
      { id: "plugin:demo:content-a", visible: false },
      { id: "plugin:demo:summary-card", visible: true },
    ])
  })

  it("reorders dynamic widgets only within their region", () => {
    const layout = normalizeOverviewLayout(
      {
        version: 1,
        items: [
          { id: "plugin:demo:summary-more", visible: true },
          { id: "plugin:demo:summary-card", visible: true },
          { id: "plugin:demo:content-a", visible: true },
          { id: "plugin:demo:content-b", visible: true },
        ],
      },
      installedWidgets
    )
    const summaryMoved = moveOverviewWidget(
      layout,
      "plugin:demo:summary-card",
      "plugin:demo:summary-more",
      installedWidgets
    )
    expect(summaryMoved.items.slice(0, 2)).toEqual([
      { id: "plugin:demo:summary-card", visible: true },
      { id: "plugin:demo:summary-more", visible: true },
    ])
    expect(summaryMoved.items.slice(2)).toEqual(layout.items.slice(2))

    const contentMoved = moveOverviewWidget(
      layout,
      "plugin:demo:content-b",
      "plugin:demo:content-a",
      installedWidgets
    )
    expect(contentMoved.items.slice(2)).toEqual([
      { id: "plugin:demo:content-b", visible: true },
      { id: "plugin:demo:content-a", visible: true },
    ])
    expect(contentMoved.items.slice(0, 2)).toEqual(layout.items.slice(0, 2))

    // Cross-region moves stay rejected, and uninstalled slots have no known region.
    expect(
      moveOverviewWidget(
        layout,
        "plugin:demo:summary-card",
        "plugin:demo:content-a",
        installedWidgets
      )
    ).toEqual(layout)
    const uninstalled = normalizeOverviewLayout({
      version: 1,
      items: [
        { id: "plugin:demo:content-a", visible: true },
        { id: "plugin:demo:summary-card", visible: true },
      ],
    })
    expect(
      moveOverviewWidget(uninstalled, "plugin:demo:content-a", "plugin:demo:summary-card")
    ).toEqual(uninstalled)
  })
})
