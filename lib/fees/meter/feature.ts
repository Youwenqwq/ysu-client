import { AirVent } from "lucide-react"
import type { DashboardFeature } from "@/lib/dashboard-features"

export const meterFeature: DashboardFeature = {
  id: "meter",
  nav: { titleKey: "meter.nav", url: "/dashboard/meter", icon: AirVent },
  titleKeys: {
    "/dashboard/meter": "meter.title",
  },
}
