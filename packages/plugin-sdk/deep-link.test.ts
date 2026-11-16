import { describe, expect, it } from "vitest"
import { pluginPageHref } from "@orahako/plugin-sdk/ui"
import { isCurrentNotificationDestination, notificationDestination as resolveDestination } from "./deep-link"

const notificationDestination = (
  url: string,
  navigation: Parameters<typeof resolveDestination>[1]
) => resolveDestination(url, navigation, "orahako")
import type { NavigationSources, PluginNavigationService } from "@orahako/plugin-sdk"
import { resolveSemanticTarget, type SemanticNavSources } from "@/plugins/official/runtime/navigation/resolvers"

function registry(
  pages: SemanticNavSources["pages"],
  fallbackHref?: string
): PluginNavigationService {
  const sources = {
    pages,
    navigation: [],
    capabilities: undefined,
    supportedPlugins: undefined,
    fallbackHref,
  } as unknown as SemanticNavSources & NavigationSources
  return {
    sources: () => sources,
    resolve: (id) => {
      const target = resolveSemanticTarget(id, sources)
      return target ? { ...target, source: "page" } : undefined
    },
    primary: () => undefined,
    landing: () => fallbackHref ?? "",
    forScope: () => [],
  }
}

describe("notification deep links", () => {
  it("resolves any registered semantic route from a registry snapshot", () => {
    const sources = registry([
      { pluginId: "org.example.app", id: "index", route: "messages" },
      { pluginId: "org.example.other", id: "settings", route: "settings" },
    ])
    expect(notificationDestination("orahako://messages", sources)).toBe(
      pluginPageHref("org.example.app", "index")
    )
    expect(notificationDestination("orahako://settings", sources)).toBe(
      pluginPageHref("org.example.other", "settings")
    )
  })

  it("resolves the same routes through the navigation service", () => {
    const navigation = registry(
      [{ pluginId: "org.example.app", id: "index", route: "messages" }],
      "/home"
    )
    expect(notificationDestination("orahako://messages", navigation)).toBe(
      pluginPageHref("org.example.app", "index")
    )
    expect(notificationDestination("orahako://missing", navigation)).toBe("/home")
  })

  it("falls back to the configured destination, not a core route", () => {
    expect(notificationDestination("orahako://missing", registry([], "/home"))).toBe("/home")
    expect(notificationDestination("orahako://missing", registry([]))).toBeNull()
  })

  it("does not resolve routes whose capability is unavailable", () => {
    const noCapability = {
      ...registry([
        { pluginId: "org.example.app", id: "index", route: "messages", capability: "schedule" },
      ]),
      capabilities: { schedule: false } as unknown as SemanticNavSources["capabilities"],
    }
    expect(notificationDestination("orahako://messages", noCapability)).toBeNull()
  })


  it("rejects malformed and unrelated links", () => {
    const sources = registry([{ pluginId: "org.example.app", id: "index", route: "messages" }])
    expect(notificationDestination("https://messages", sources)).toBeNull()
    expect(notificationDestination("not a url", sources)).toBeNull()
    expect(notificationDestination("orahako://user@messages", sources)).toBeNull()
    expect(notificationDestination("orahako://messages:8443", sources)).toBeNull()
    expect(notificationDestination("orahako://messages/extra", sources)).toBeNull()
    expect(notificationDestination("orahako://messages?tab=1", sources)).toBeNull()
    expect(notificationDestination("orahako://messages#section", sources)).toBeNull()
  })

  it("matches the complete plugin destination including query", () => {
    const destination = notificationDestination(
      "orahako://messages",
      registry([{ pluginId: "org.example.app", id: "index", route: "messages" }])
    )!
    expect(
      isCurrentNotificationDestination(
        "/dashboard/plugin",
        "?plugin=org.example.app&page=index",
        destination
      )
    ).toBe(true)
    expect(
      isCurrentNotificationDestination(
        "/dashboard/plugin",
        "?plugin=org.example.other&page=index",
        destination
      )
    ).toBe(false)
    expect(isCurrentNotificationDestination("/elsewhere", "", destination)).toBe(false)
  })
})
