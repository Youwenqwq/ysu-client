import { Bird } from "lucide-react"
import type { ExtraFeature } from "../registry"

export const skbirdFeature: ExtraFeature = {
  id: "skbird",
  nav: { titleKey: "skbird.nav", url: "/dashboard/skbird", icon: Bird },
  titleKeys: {
    "/dashboard/skbird": "skbird.title",
    "/dashboard/skbird/thread": "skbird.threadTitle",
    "/dashboard/skbird/settings": "skbird.settingsTitle",
    "/dashboard/skbird/me": "skbird.meTitle",
    "/dashboard/skbird/messages": "skbird.messagesTitle",
  },
}
