import { describe, expect, it } from "vitest"
import {
  CORE_DASHBOARD_FALLBACK_HREF,
  landingPreferenceHref,
  resolvePrimaryTarget,
  resolveSemanticTarget,
  semanticTargetHref,
  type SemanticNavSources,
} from "./navigation"

function sources(overrides: Partial<SemanticNavSources> = {}): SemanticNavSources {
  return {
    pages: [],
    navigation: [],
    capabilities: {
      schedule: true,
      grades: true,
      studentInfo: true,
    } as SemanticNavSources["capabilities"],
    ...overrides,
  }
}

const defaultSources = sources({
  pages: [
    { pluginId: "org.ysu.overview", id: "index" },
    {
      pluginId: "org.ysu.schedule",
      id: "index",
      route: "schedule",
      primary: true,
      capability: "schedule",
    },
    { pluginId: "org.ysu.grades", id: "index", route: "grades" },
    {
      pluginId: "org.ysu.student-info",
      id: "index",
      route: "student-info",
      capability: "studentInfo",
    },
  ],
  navigation: [
    {
      pluginId: "org.ysu.overview",
      id: "overview",
      page: "index",
      title: "总览",
      order: 0,
      primary: true,
    },
    { pluginId: "org.ysu.schedule", id: "schedule", page: "index", title: "日程", order: 10 },
    { pluginId: "org.ysu.grades", id: "grades", page: "index", title: "成绩", order: 20 },
  ],
})

describe("semantic target resolution", () => {
  it("resolves by declared page route, then by navigation id", () => {
    expect(resolveSemanticTarget("schedule", defaultSources)).toEqual({
      pluginId: "org.ysu.schedule",
      pageId: "index",
    })
    // `overview` has no page route; it resolves through its navigation entry.
    expect(resolveSemanticTarget("overview", defaultSources)).toEqual({
      pluginId: "org.ysu.overview",
      pageId: "index",
    })
  })

  it("skips targets whose capability is unavailable", () => {
    const noSchedule = sources({
      ...defaultSources,
      capabilities: { ...defaultSources.capabilities!, schedule: false },
    })
    expect(resolveSemanticTarget("schedule", noSchedule)).toBeUndefined()
  })

  it("picks deterministically when several plugins claim one semantic id", () => {
    const contested = sources({
      ...defaultSources,
      pages: [...defaultSources.pages, { pluginId: "org.alt", id: "index", route: "schedule" }],
      navigation: [
        ...defaultSources.navigation,
        { pluginId: "org.alt", id: "schedule", page: "index", title: "日程", order: 5 },
      ],
    })
    expect(resolveSemanticTarget("schedule", contested)).toEqual({
      pluginId: "org.alt",
      pageId: "index",
    })
  })

  it("returns nothing when the plugin is missing entirely", () => {
    expect(resolveSemanticTarget("ecard", defaultSources)).toBeUndefined()
    expect(resolveSemanticTarget("schedule", sources())).toBeUndefined()
    expect(
      resolveSemanticTarget("schedule", sources({ navigation: [defaultSources.navigation[1]] }))
    ).toBeUndefined()
  })
})

describe("primary target resolution", () => {
  it("prefers a primary page ordered by navigation order", () => {
    expect(resolvePrimaryTarget(defaultSources)).toEqual({
      pluginId: "org.ysu.overview",
      pageId: "index",
    })
  })

  it("uses a root page, never an arbitrary non-primary page", () => {
    const root = sources({
      pages: [
        { pluginId: "org.example.other", id: "index" },
        { pluginId: "org.example.root", id: "index", root: true },
      ],
    })
    expect(resolvePrimaryTarget(root)).toEqual({ pluginId: "org.example.root", pageId: "index" })
    expect(resolvePrimaryTarget(sources({ pages: [root.pages[0]] }))).toBeUndefined()
  })

  it("yields nothing with an empty registry", () => {
    expect(resolvePrimaryTarget(sources())).toBeUndefined()
  })
})

describe("landing preference", () => {
  it("keeps the schedule/overview preference semantics", () => {
    expect(landingPreferenceHref("schedule", defaultSources)).toBe(
      "/dashboard/plugin/?plugin=org.ysu.schedule&page=index"
    )
    expect(landingPreferenceHref("overview", defaultSources)).toBe(
      "/dashboard/plugin/?plugin=org.ysu.overview&page=index"
    )
  })

  it("falls back to the primary page, then a core page", () => {
    expect(
      landingPreferenceHref(
        "schedule",
        sources({
          pages: defaultSources.pages.slice(0, 1),
          navigation: defaultSources.navigation.slice(0, 1),
        })
      )
    ).toBe("/dashboard/plugin/?plugin=org.ysu.overview&page=index")
    expect(landingPreferenceHref("overview", sources())).toBe(CORE_DASHBOARD_FALLBACK_HREF)
  })

  it("never targets a disabled or missing plugin", () => {
    const disabledSchedule = sources({
      ...defaultSources,
      capabilities: { ...defaultSources.capabilities!, schedule: false },
    })
    expect(landingPreferenceHref("schedule", disabledSchedule)).toBe(
      "/dashboard/plugin/?plugin=org.ysu.overview&page=index"
    )
  })
})

describe("semanticTargetHref", () => {
  it("builds the plugin page URL", () => {
    expect(semanticTargetHref({ pluginId: "org.ysu.exams", pageId: "index" })).toBe(
      "/dashboard/plugin/?plugin=org.ysu.exams&page=index"
    )
  })
})
