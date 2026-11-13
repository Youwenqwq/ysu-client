"use client"

import { OverviewComposer } from "@ysu/plugin-ui/shell"
import { OverviewDataProvider } from "@ysu/academic"
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
