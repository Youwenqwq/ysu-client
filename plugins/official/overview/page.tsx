"use client"

import { OverviewComposer } from "@/app/dashboard/overview/overview-composer"
import { OverviewDataProvider } from "./context"
import { ProfileWidget } from "./profile-widget"

export function OverviewPage() {
  return (
    <OverviewDataProvider>
      <OverviewComposer
        renderProfile={(compact, summaries) => (
          <ProfileWidget compact={compact}>{summaries}</ProfileWidget>
        )}
      />
    </OverviewDataProvider>
  )
}
