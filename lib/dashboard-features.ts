import type { LucideIcon } from "lucide-react"

/** Dashboard navigation and page titles, shared by fee services and extras. */
export interface DashboardFeature {
  id: string
  nav: {
    titleKey: string
    url: string
    icon: LucideIcon
  }
  titleKeys: Record<string, string>
}
