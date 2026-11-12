import type { AcademicCapabilities } from "@ysu/plugin-sdk"

export function hasPluginCapability(
  capabilities: AcademicCapabilities,
  capability: string | undefined
): boolean {
  return !capability || (capabilities as unknown as Record<string, boolean>)[capability] === true
}
