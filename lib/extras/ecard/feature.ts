import { CreditCard } from "lucide-react"
import type { ExtraFeature } from "../registry"

export const ecardFeature: ExtraFeature = {
  id: "ecard",
  nav: { titleKey: "ecard.nav", url: "/dashboard/ecard", icon: CreditCard },
  titleKeys: {
    "/dashboard/ecard": "ecard.title",
  },
}