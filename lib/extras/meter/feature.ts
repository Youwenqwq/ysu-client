import { AirVent } from "lucide-react"
import type { ExtraFeature } from "../registry"

export const meterFeature: ExtraFeature = {
  id: "meter",
  nav: { titleKey: "meter.nav", url: "/dashboard/meter", icon: AirVent },
  titleKeys: {
    "/dashboard/meter": "meter.title",
  },
}
