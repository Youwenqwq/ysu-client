import { afterEach, describe, expect, it, vi } from "vitest"
import { YSUProvider } from "./ysu-provider"
import { setSchoolConfig } from "@/lib/server-config"

afterEach(() => {
  setSchoolConfig("ysu")
  vi.unstubAllEnvs()
})

describe("school mobile sign-in capability", () => {
  it.each(["harmony", "web"])("exposes the mobile adapter for YSU on %s", (platform) => {
    vi.stubEnv("NEXT_PUBLIC_APP_PLATFORM", platform)
    setSchoolConfig("ysu")
    const provider = new YSUProvider()
    expect(provider.capabilities.mobileSignin).toBe(true)
    expect(provider.mobile?.getCurrentLesson).toBeTypeOf("function")
    expect(provider.mobile?.doStudentSign).toBeTypeOf("function")
  })

  it("keeps schools without mobile APIs unsupported", () => {
    setSchoolConfig("nbu")
    const provider = new YSUProvider()
    expect(provider.capabilities.mobileSignin).toBe(false)
    expect(provider.mobile).toBeUndefined()
  })
})
