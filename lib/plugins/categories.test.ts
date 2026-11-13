import { describe, expect, it } from "vitest"
import { groupByPluginCategory, pluginCategory } from "./categories"

describe("plugin categories", () => {
  it("uses explicit provider/toybox metadata and infrastructure kinds", () => {
    expect(pluginCategory({ kind: "provider" })).toBe("provider")
    expect(pluginCategory({ kind: "feature", categories: ["toybox"] })).toBe("toybox")
    expect(pluginCategory({ kind: "feature", required: true })).toBe("system")
    expect(pluginCategory({ kind: "shell" })).toBe("system")
    expect(pluginCategory({ kind: "theme" })).toBe("appearance")
    expect(pluginCategory({ kind: "feature" })).toBe("academic")
  })

  it("groups in stable category order without empty groups", () => {
    const groups = groupByPluginCategory([
      { id: "feature", kind: "feature" as const },
      { id: "provider", kind: "provider" as const },
      { id: "toybox", kind: "feature" as const, categories: ["toybox"] },
    ])
    expect(groups.map((group) => [group.id, group.plugins.map((plugin) => plugin.id)])).toEqual([
      ["provider", ["provider"]],
      ["academic", ["feature"]],
      ["toybox", ["toybox"]],
    ])
  })
})
