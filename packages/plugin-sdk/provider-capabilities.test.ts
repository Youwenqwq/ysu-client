import { describe, expect, it } from "vitest"
import type { AcademicProvider } from "./academic"
import { ProviderError, ProviderErrorCode } from "./provider-errors"
import {
  getEnabledCapabilities,
  hasCapability,
  hasProviderMethod,
  requireProviderMethod,
  supportsPlugin,
} from "./provider-capabilities"

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

describe("open capability record", () => {
  it("enables only explicit truthy open keys", () => {
    const capabilities = { grades: true, customTool: true, disabled: false }
    expect(hasCapability(capabilities, "grades")).toBe(true)
    expect(hasCapability(capabilities, "customTool")).toBe(true)
    expect(hasCapability(capabilities, "unknown")).toBe(false)
    expect(hasCapability(capabilities, "disabled")).toBe(false)
    expect(hasCapability(undefined, "grades")).toBe(false)
    expect(getEnabledCapabilities(capabilities)).toEqual(["grades", "customTool"])
  })
})

describe("optional provider modules", () => {
  const lifecycleOnly: AcademicProvider = {
    id: "minimal",
    name: "Minimal University",
    capabilities: {},
    initialize: async () => {},
    reset: async () => {},
    logout: async () => {},
    relogin: async () => true,
  }

  it("reports an absent module method", () => {
    expect(hasProviderMethod(lifecycleOnly, "getGrades")).toBe(false)
    expect(hasProviderMethod(lifecycleOnly, "login")).toBe(false)
  })

  it("requires present module methods without non-null assertions", () => {
    const login = async () => {}
    const provider: AcademicProvider = { ...lifecycleOnly, login }
    expect(requireProviderMethod(provider, "login")).toBe(login)
  })

  it("throws FEATURE_NOT_SUPPORTED for a missing module method", () => {
    try {
      requireProviderMethod(lifecycleOnly, "getGrades")
      expect.unreachable("expected FEATURE_NOT_SUPPORTED")
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError)
      expect((error as ProviderError).code).toBe(ProviderErrorCode.FEATURE_NOT_SUPPORTED)
    }
  })
})
