import { describe, expect, it } from "vitest"
import { OFFICIAL_PLUGINS } from "./registry"

describe("official plugin identities", () => {
  it("keeps only the school provider in the YSU namespace", () => {
    const ids = OFFICIAL_PLUGINS.map((plugin) => plugin.manifest.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.filter((id) => id.startsWith("ysu."))).toEqual(["ysu.provider"])
    expect(ids).toContain("orahako.shell")
    expect(ids).toContain("orahako.overview")
    expect(ids).toContain("orahako.onboarding")
    expect(ids).not.toContain("zmu.provider")
  })
})
