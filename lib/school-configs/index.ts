import type { SchoolConfig } from "./types"

export const DEFAULT_SCHOOL_ID = "ysu"

// Provider plugins populate this runtime catalog through registerSchool().
// The core does not bundle school-owned configuration.
const schoolConfigs: Record<string, SchoolConfig> = {}

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
