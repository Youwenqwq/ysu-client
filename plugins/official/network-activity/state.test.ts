import { beforeEach, describe, expect, it } from "vitest"
import type { PluginKeyValueStorage } from "@orahako/plugin-sdk"
import {
  DENSITY_STORAGE_KEY,
  TIMING_STORAGE_KEY,
  isActivityDensity,
  loadActivitySettings,
  useActivitySettings,
} from "./state"

function storageWith(values: Record<string, string>): PluginKeyValueStorage {
  return {
    getItem: async (key) => values[key] ?? null,
    setItem: async () => {},
    removeItem: async () => {},
  }
}

beforeEach(() => {
  useActivitySettings.setState({ density: "compact", showTiming: false })
})

describe("activity settings", () => {
  it("validates density values", () => {
    expect(isActivityDensity("compact")).toBe(true)
    expect(isActivityDensity("detailed")).toBe(true)
    expect(isActivityDensity("debug")).toBe(true)
    expect(isActivityDensity("expanded")).toBe(false)
    expect(isActivityDensity(null)).toBe(false)
  })

  it("loads density and timing from plugin storage", async () => {
    await loadActivitySettings(
      storageWith({
        [DENSITY_STORAGE_KEY]: "debug",
        [TIMING_STORAGE_KEY]: "true",
      })
    )
    expect(useActivitySettings.getState()).toMatchObject({
      density: "debug",
      showTiming: true,
    })
  })

  it("keeps timing off by default and on invalid values", async () => {
    await loadActivitySettings(
      storageWith({
        [DENSITY_STORAGE_KEY]: "unknown",
        [TIMING_STORAGE_KEY]: "yes",
      })
    )
    expect(useActivitySettings.getState()).toMatchObject({
      density: "compact",
      showTiming: false,
    })
  })
})
