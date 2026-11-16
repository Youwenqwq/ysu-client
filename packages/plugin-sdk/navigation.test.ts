import { describe, expect, it } from "vitest"
import { isAppNavigation } from "./navigation"

describe("isAppNavigation", () => {
  it("treats an omitted scope as application navigation", () => {
    expect(isAppNavigation({})).toBe(true)
  })

  it("distinguishes plugin-scoped navigation", () => {
    expect(isAppNavigation({ scope: "app" })).toBe(true)
    expect(isAppNavigation({ scope: "plugin" })).toBe(false)
  })
})
