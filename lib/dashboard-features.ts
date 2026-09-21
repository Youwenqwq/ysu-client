import type { LucideIcon } from "lucide-react"
import { hasCapability } from "@/providers/capabilities"
import type { AcademicCapabilities } from "@/providers/types"

/** Dashboard navigation and page titles, shared by fee services and extras. */
export interface DashboardFeature {
  id: string
  nav: {
    titleKey: string
    url: string
    icon: LucideIcon
  }
  titleKeys: Record<string, string>
  /** Academic capability gating nav entries and direct access; undefined = always available. */
  capability?: keyof AcademicCapabilities
}

/** Whether a feature's required capability is enabled for the active provider. */
export function isDashboardFeatureAvailable(
  feature: Pick<DashboardFeature, "capability">,
  capabilities: AcademicCapabilities
): boolean {
  return !feature.capability || hasCapability(capabilities, feature.capability)
}
