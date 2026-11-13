import { describe, expect, it } from "vitest"
import { migrateSettings } from "./settings"

describe("settings onboarding migration", () => {
  it("marks pre-onboarding installations as completed", () => {
    expect(migrateSettings({ schoolId: "ysu" }, 0)).toMatchObject({
      schoolId: "ysu",
      onboardingCompleted: true,
    })
  })

  it("does not overwrite current onboarding state", () => {
    expect(migrateSettings({ onboardingCompleted: false }, 1)).toEqual({
      onboardingCompleted: false,
    })
  })
})
