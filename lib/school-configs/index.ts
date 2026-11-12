import nbuConfig from "./nbu.json"
import type { SchoolConfig } from "./types"

export const DEFAULT_SCHOOL_ID = "ysu"

// YSU ships with its provider plugin and registers itself through the plugin
// host. The core only bundles configs that have no provider-owned home.
const bundledSchoolConfigs = [nbuConfig as SchoolConfig] as const

const schoolConfigs: Record<string, SchoolConfig> = Object.fromEntries(
  bundledSchoolConfigs.map((config) => [config.id, config])
)

export function registerSchoolConfig(config: SchoolConfig): void {
  schoolConfigs[config.id] = config
}

/** Removes a school config contributed by a plugin. No-op when absent. */
export function unregisterSchoolConfig(schoolId: string): void {
  delete schoolConfigs[schoolId]
}

export function getSchoolConfigById(schoolId: string): SchoolConfig | undefined {
  return schoolConfigs[schoolId]
}

export function hasSchoolConfig(schoolId: string): boolean {
  return Object.prototype.hasOwnProperty.call(schoolConfigs, schoolId)
}

export function getAllSchoolConfigs(): readonly SchoolConfig[] {
  return Object.values(schoolConfigs)
}

export function getVisibleSchoolConfigs(): readonly SchoolConfig[] {
  return getAllSchoolConfigs().filter((config) => config.visible)
}
