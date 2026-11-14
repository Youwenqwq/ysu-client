"use client"

import { OverviewComposer, OverviewDataProvider } from "@orahako/academic"
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
