import { describe, expect, it } from "vitest"
import { ALL_CAPABILITIES, NO_CAPABILITIES } from "@ysu/plugin-sdk"
import { hasPluginCapability } from "./navigation"

describe("plugin capability gating", () => {
  it("keeps ungated plugin pages available", () => {
    expect(hasPluginCapability(NO_CAPABILITIES, undefined)).toBe(true)
  })

  it("requires the declared provider capability", () => {
    expect(hasPluginCapability(NO_CAPABILITIES, "grades")).toBe(false)
    expect(hasPluginCapability(ALL_CAPABILITIES, "grades")).toBe(true)
  })

  it("fails closed for capabilities unknown to the provider", () => {
    expect(hasPluginCapability(ALL_CAPABILITIES, "futureCapability")).toBe(false)
  })
})
