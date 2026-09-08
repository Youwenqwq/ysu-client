import { CreditCard } from "lucide-react"
import type { DashboardFeature } from "@/lib/dashboard-features"

export const ecardFeature: DashboardFeature = {
  id: "ecard",
  nav: { titleKey: "ecard.nav", url: "/dashboard/ecard", icon: CreditCard },
  titleKeys: {
    "/dashboard/ecard": "ecard.title",
  },
}