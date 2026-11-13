import { describe, expect, it } from "vitest"
import { PluginManifestError, validatePluginManifest } from "./manifest"

const valid = {
  id: "org.example.theme",
  name: "Example theme",
  version: "1.0.0",
  apiVersion: 1,
  kind: "theme",
  entry: "dist/index.js",
  styles: ["dist/index.css"],
}

describe("validatePluginManifest", () => {
  it("accepts a complete manifest", () => {
    expect(validatePluginManifest(valid)).toEqual(valid)
  })

  it.each([
    ["../entry.js", "entry must be a safe relative JavaScript file path"],
    ["/entry.js", "entry must be a safe relative JavaScript file path"],
    ["assets/../../entry.js", "entry must be a safe relative JavaScript file path"],
  ])("rejects unsafe entry %s", (entry, message) => {
    expect(() => validatePluginManifest({ ...valid, entry })).toThrow(message)
  })

  it("accepts shells with valid plugin dependencies", () => {
    const shell = { ...valid, kind: "shell", requires: ["ysu.provider"] }
    expect(validatePluginManifest(shell)).toEqual(shell)
    expect(() => validatePluginManifest({ ...valid, requires: ["../bad"] })).toThrow(
      "requires must contain valid plugin IDs"
    )
    expect(() => validatePluginManifest({ ...valid, requires: [valid.id] })).toThrow(
      "plugin must not depend on itself"
    )
  })

  it("rejects non-SemVer package and app versions", () => {
    expect(() => validatePluginManifest({ ...valid, version: "latest" })).toThrow(
      "version must be a valid SemVer"
    )
    expect(() => validatePluginManifest({ ...valid, minAppVersion: "1.0" })).toThrow(
      "minAppVersion must be a valid SemVer"
    )
  })

  it("reports incompatible API versions", () => {
    expect(() => validatePluginManifest({ ...valid, apiVersion: 2 })).toThrow(PluginManifestError)
    expect(() => validatePluginManifest({ ...valid, apiVersion: 2 })).toThrow(
      "apiVersion must be 1"
    )
  })
})
