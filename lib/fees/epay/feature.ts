import { Wallet } from "lucide-react"
import type { DashboardFeature } from "@/lib/dashboard-features"

export const epayFeature: DashboardFeature = {
  id: "epay",
  nav: { titleKey: "epay.nav", url: "/dashboard/epay", icon: Wallet },
  titleKeys: {
    "/dashboard/epay": "epay.title",
  },
}
