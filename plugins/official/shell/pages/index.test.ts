import { describe, expect, it } from "vitest"
import { officialShellPages } from "."

describe("official shell pages", () => {
  it("declares one stable semantic route per page", () => {
    const routes = officialShellPages.map((page) => page.route)
    expect(routes.every(Boolean)).toBe(true)
    expect(new Set(routes).size).toBe(routes.length)
    expect(new Set(officialShellPages.map((page) => page.id)).size).toBe(officialShellPages.length)
  })

  it("keeps login provider-independent and account pages provider-scoped", () => {
    const login = officialShellPages.find((page) => page.route === "login")
    expect(login?.requiresProvider).toBe(false)
    for (const route of [
      "me",
      "settings",
      "settings-plugins",
      "settings-widgets",
      "plugins",
      "about",
      "avatar",
      "background",
      "debug",
    ]) {
      expect(officialShellPages.find((page) => page.route === route)?.requiresProvider).toBe(true)
    }
  })
})
