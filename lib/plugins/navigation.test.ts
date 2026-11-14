import { describe, expect, it } from "vitest"
import {
  CORE_DASHBOARD_FALLBACK_HREF,
  landingPreferenceHref,
  navigationForScope,
  resolveActivePluginNavigation,
  resolveMobileNavigation,
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
    { pluginId: "org.orahako.overview", id: "index" },
    {
      pluginId: "org.orahako.schedule",
      id: "index",
      route: "schedule",
      primary: true,
      capability: "schedule",
    },
    { pluginId: "org.orahako.grades", id: "index", route: "grades" },
    {
      pluginId: "org.orahako.student-info",
      id: "index",
      route: "student-info",
      capability: "studentInfo",
    },
  ],
  navigation: [
    {
      pluginId: "org.orahako.overview",
      id: "overview",
      page: "index",
      title: "总览",
      order: 0,
      primary: true,
    },
    { pluginId: "org.orahako.schedule", id: "schedule", page: "index", title: "日程", order: 10 },
    { pluginId: "org.orahako.grades", id: "grades", page: "index", title: "成绩", order: 20 },
  ],
})

describe("semantic target resolution", () => {
  it("resolves by declared page route, then by navigation id", () => {
    expect(resolveSemanticTarget("schedule", defaultSources)).toEqual({
      pluginId: "org.orahako.schedule",
      pageId: "index",
    })
    // `overview` has no page route; it resolves through its navigation entry.
    expect(resolveSemanticTarget("overview", defaultSources)).toEqual({
      pluginId: "org.orahako.overview",
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

  it("ignores plugin-scoped navigation when resolving global routes", () => {
    const local = sources({
      pages: [{ pluginId: "org.example.app", id: "messages" }],
      navigation: [
        {
          pluginId: "org.example.app",
          id: "messages",
          page: "messages",
          scope: "plugin",
        },
      ],
    })
    expect(resolveSemanticTarget("messages", local)).toBeUndefined()
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
      pluginId: "org.orahako.overview",
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

describe("scoped navigation", () => {
  const navigation: SemanticNavSources["navigation"] = [
    { pluginId: "org.example.app", id: "app", page: "index", order: 20, primary: true },
    {
      pluginId: "org.example.app",
      id: "later",
      page: "later",
      scope: "plugin",
      order: 20,
    },
    {
      pluginId: "org.example.app",
      id: "first",
      page: "index",
      scope: "plugin",
      order: 10,
    },
    {
      pluginId: "org.example.other",
      id: "other",
      page: "index",
      scope: "plugin",
      order: 0,
    },
  ]

  it("filters by scope and owner and sorts deterministically", () => {
    expect(
      navigationForScope(navigation, "plugin", {}, "org.example.app").map((x) => x.id)
    ).toEqual(["first", "later"])
    expect(navigationForScope(navigation, "app", {}).map((x) => x.id)).toEqual(["app"])
  })

  it("uses available local tabs, otherwise global primary tabs", () => {
    expect(
      resolveMobileNavigation(navigation, "org.example.app", {}).items.map((item) => item.id)
    ).toEqual(["first", "later"])
    expect(resolveMobileNavigation(navigation, "org.example.missing", {})).toEqual({
      scope: "app",
      items: [navigation[0]],
    })
    expect(
      resolveMobileNavigation(navigation, "org.example.app", {
        supportedPlugins: ["org.example.other"],
      }).items.map((item) => item.id)
    ).toEqual([])
  })

  it("matches page parameters and inherits parent tabs for detail pages", () => {
    const items: SemanticNavSources["navigation"] = [
      {
        pluginId: "org.example.app",
        id: "map",
        page: "index",
        params: { tab: "map" },
        scope: "plugin",
        order: 0,
      },
      {
        pluginId: "org.example.app",
        id: "ride",
        page: "index",
        params: { tab: "ride" },
        scope: "plugin",
        order: 10,
      },
      {
        pluginId: "org.example.app",
        id: "messages",
        page: "messages",
        scope: "plugin",
        order: 20,
      },
    ]
    const pages: SemanticNavSources["pages"] = [
      { pluginId: "org.example.app", id: "index" },
      { pluginId: "org.example.app", id: "messages", parent: "index" },
      { pluginId: "org.example.app", id: "settings", parent: "index" },
      { pluginId: "org.example.app", id: "thread", parent: "index" },
    ]
    const location = (pageId: string, tab?: string) => ({
      pluginId: "org.example.app",
      pageId,
      params: new URLSearchParams(tab ? { tab } : {}),
    })
    expect(resolveActivePluginNavigation(items, pages, location("index", "ride"))).toBe("ride")
    expect(resolveActivePluginNavigation(items, pages, location("settings", "ride"))).toBe("ride")
    expect(resolveActivePluginNavigation(items, pages, location("messages"))).toBe("messages")
    expect(resolveActivePluginNavigation(items, pages, location("thread"))).toBe("map")
  })

  it("terminates when page parent metadata contains a cycle", () => {
    const pages: SemanticNavSources["pages"] = [
      { pluginId: "org.example.app", id: "a", parent: "b" },
      { pluginId: "org.example.app", id: "b", parent: "a" },
    ]
    expect(
      resolveActivePluginNavigation([], pages, { pluginId: "org.example.app", pageId: "a" })
    ).toBeUndefined()
  })
})

describe("landing preference", () => {
  it("keeps the schedule/overview preference semantics", () => {
    expect(landingPreferenceHref("schedule", defaultSources)).toBe(
      "/dashboard/plugin/?plugin=org.orahako.schedule&page=index"
    )
    expect(landingPreferenceHref("overview", defaultSources)).toBe(
      "/dashboard/plugin/?plugin=org.orahako.overview&page=index"
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
    ).toBe("/dashboard/plugin/?plugin=org.orahako.overview&page=index")
    expect(landingPreferenceHref("overview", sources())).toBe(CORE_DASHBOARD_FALLBACK_HREF)
  })

  it("never targets a disabled or missing plugin", () => {
    const disabledSchedule = sources({
      ...defaultSources,
      capabilities: { ...defaultSources.capabilities!, schedule: false },
    })
    expect(landingPreferenceHref("schedule", disabledSchedule)).toBe(
      "/dashboard/plugin/?plugin=org.orahako.overview&page=index"
    )
  })
})

describe("provider plugin allowlist", () => {
  it("keeps every plugin when the provider declares no list", () => {
    expect(defaultSources.supportedPlugins).toBeUndefined()
    expect(resolveSemanticTarget("grades", defaultSources)).toEqual({
      pluginId: "org.orahako.grades",
      pageId: "index",
    })
    expect(resolvePrimaryTarget(defaultSources)).toEqual({
      pluginId: "org.orahako.overview",
      pageId: "index",
    })
  })

  it("hides page routes and navigation fallbacks from unlisted plugins", () => {
    const noGrades = sources({
      ...defaultSources,
      supportedPlugins: ["org.orahako.overview", "org.orahako.schedule"],
    })
    // `grades` resolves through a declared page route.
    expect(resolveSemanticTarget("grades", noGrades)).toBeUndefined()
    expect(resolveSemanticTarget("schedule", noGrades)).toEqual({
      pluginId: "org.orahako.schedule",
      pageId: "index",
    })

    // `overview` only exists as a navigation entry, so the fallback path filters too.
    const noOverview = sources({
      ...defaultSources,
      supportedPlugins: ["org.orahako.grades"],
    })
    expect(resolveSemanticTarget("overview", noOverview)).toBeUndefined()
    expect(resolveSemanticTarget("grades", noOverview)).toEqual({
      pluginId: "org.orahako.grades",
      pageId: "index",
    })
  })

  it("picks the next allowed primary page and landing target", () => {
    const noOverview = sources({
      ...defaultSources,
      supportedPlugins: ["org.orahako.schedule"],
    })
    expect(resolvePrimaryTarget(noOverview)).toEqual({
      pluginId: "org.orahako.schedule",
      pageId: "index",
    })
    expect(landingPreferenceHref("overview", noOverview)).toBe(
      "/dashboard/plugin/?plugin=org.orahako.schedule&page=index"
    )
  })

  it("requires both the allowlist and the capability", () => {
    const allowlistWithoutCapability = sources({
      ...defaultSources,
      capabilities: { ...defaultSources.capabilities!, schedule: false },
      supportedPlugins: ["org.orahako.schedule"],
    })
    // The allowlist never widens capabilities: `schedule` is listed but disabled.
    expect(resolveSemanticTarget("schedule", allowlistWithoutCapability)).toBeUndefined()
    // Nor can capabilities widen the allowlist: `student-info` is enabled but unlisted.
    expect(resolveSemanticTarget("student-info", allowlistWithoutCapability)).toBeUndefined()
    expect(resolvePrimaryTarget(allowlistWithoutCapability)).toBeUndefined()
  })

  it("treats an empty allowlist as no plugin pages", () => {
    const empty = sources({ ...defaultSources, supportedPlugins: [] })
    expect(resolvePrimaryTarget(empty)).toBeUndefined()
    expect(resolveSemanticTarget("schedule", empty)).toBeUndefined()
    expect(landingPreferenceHref("schedule", empty)).toBe(CORE_DASHBOARD_FALLBACK_HREF)
  })
})

describe("semanticTargetHref", () => {
  it("builds the plugin page URL", () => {
    expect(semanticTargetHref({ pluginId: "org.orahako.exams", pageId: "index" })).toBe(
      "/dashboard/plugin/?plugin=org.orahako.exams&page=index"
    )
  })
})
