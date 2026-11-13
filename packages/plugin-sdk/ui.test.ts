import { describe, expect, it } from "vitest"
import { pluginPageHref } from "./ui"

describe("pluginPageHref", () => {
  it("keeps custom parameters but never overrides the target identity", () => {
    expect(
      pluginPageHref("org.example", "detail", {
        plugin: "org.other",
        page: "index",
        id: 42,
        empty: undefined,
      })
    ).toBe("/dashboard/plugin/?plugin=org.example&page=detail&id=42")
  })
})
