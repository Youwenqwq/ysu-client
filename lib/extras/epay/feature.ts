import { Wallet } from "lucide-react"
import type { ExtraFeature } from "../registry"

export const epayFeature: ExtraFeature = {
  id: "epay",
  nav: { titleKey: "epay.nav", url: "/dashboard/epay", icon: Wallet },
  titleKeys: {
    "/dashboard/epay": "epay.title",
  },
}