import { describe, expect, it } from "vitest"
import { blockedCapabilityForPath } from "./dashboard-nav"
import { isDashboardFeatureAvailable } from "./dashboard-features"
import { ALL_CAPABILITIES, NO_CAPABILITIES } from "@/providers/capabilities"

describe("isDashboardFeatureAvailable", () => {
  it("keeps ungated features available under NO_CAPABILITIES", () => {
    expect(isDashboardFeatureAvailable({}, NO_CAPABILITIES)).toBe(true)
  })

  it("requires the declared capability", () => {
    expect(isDashboardFeatureAvailable({ capability: "grades" }, NO_CAPABILITIES)).toBe(false)
    expect(isDashboardFeatureAvailable({ capability: "grades" }, ALL_CAPABILITIES)).toBe(true)
  })
})

describe("blockedCapabilityForPath", () => {
  it("blocks gated academic pages when the capability is off", () => {
    expect(blockedCapabilityForPath("/dashboard/grades", NO_CAPABILITIES)).toBe("grades")
    expect(blockedCapabilityForPath("/dashboard/evaluation", NO_CAPABILITIES)).toBe("evaluation")
  })

  it("blocks gated fee pages when the capability is off", () => {
    expect(blockedCapabilityForPath("/dashboard/ecard", NO_CAPABILITIES)).toBe("ecard")
  })

  it("allows every page when all capabilities are on", () => {
    expect(blockedCapabilityForPath("/dashboard/grades", ALL_CAPABILITIES)).toBeNull()
    expect(blockedCapabilityForPath("/dashboard/ecard", ALL_CAPABILITIES)).toBeNull()
  })

  it("never blocks ungated routes", () => {
    expect(blockedCapabilityForPath("/dashboard", NO_CAPABILITIES)).toBeNull()
    expect(blockedCapabilityForPath("/dashboard/me", NO_CAPABILITIES)).toBeNull()
    expect(blockedCapabilityForPath("/dashboard/skbird", NO_CAPABILITIES)).toBeNull()
  })

  it("does not treat partial path prefixes as matches", () => {
    expect(blockedCapabilityForPath("/dashboard/grades-archive", NO_CAPABILITIES)).toBeNull()
  })
})
