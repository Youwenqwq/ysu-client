import { describe, expect, it } from "vitest"
import { supportsPlugin } from "./provider-capabilities"

describe("supportsPlugin", () => {
  it("allows every plugin when the provider declares no allowlist", () => {
    expect(supportsPlugin(undefined, "orahako.schedule")).toBe(true)
    expect(supportsPlugin(undefined, "third-party.plugin")).toBe(true)
  })

  it("allows only the listed manifest ids", () => {
    const supported = ["orahako.overview", "orahako.schedule"]
    expect(supportsPlugin(supported, "orahako.overview")).toBe(true)
    expect(supportsPlugin(supported, "orahako.grades")).toBe(false)
  })

  it("treats an empty allowlist as allowing nothing", () => {
    expect(supportsPlugin([], "orahako.schedule")).toBe(false)
  })
})
