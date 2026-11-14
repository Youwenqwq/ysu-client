import { describe, expect, it } from "vitest"
import { perlicaTab } from "./app-nav"

describe("perlicaTab", () => {
  it("reads the active section from the URL", () => {
    expect(perlicaTab(new URLSearchParams("tab=history"))).toBe("history")
  })

  it("uses the map for missing or invalid sections", () => {
    expect(perlicaTab(new URLSearchParams())).toBe("map")
    expect(perlicaTab(new URLSearchParams("tab=unknown"))).toBe("map")
  })
})
