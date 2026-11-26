import type { ReactNode } from "react"
import { BarChart3 } from "lucide-react"
import type { DerivedComponentProps, SlotComponentOwner } from "@orahako/sdk"
import { Switch } from "@orahako/ui-primitives"
import type { AnalyticsDictionary } from "./dictionary"
import type { AnalyticsConsentStore } from "./store"

declare module "@orahako/sdk" {
  interface SlotMap {
    "settings.general": { kind: "list"; owner: Record<string, never> }
  }
}

export interface AnalyticsSettingsToggleInject {
  readonly onConsentChange: (enabled: boolean) => void
}

export type AnalyticsSettingsToggleProps = DerivedComponentProps<
  SlotComponentOwner<"settings.general">,
  AnalyticsDictionary,
  undefined,
  AnalyticsConsentStore,
  AnalyticsSettingsToggleInject
>

export function AnalyticsSettingsToggle(props: AnalyticsSettingsToggleProps): ReactNode {
  const { t, useStore, onConsentChange } = props
  const consent = useStore((state) => state.consent)

  return (
    <div className="flex items-center gap-3 py-3">
      <BarChart3 className="size-5 shrink-0 text-muted-foreground" />
      <div className="flex flex-1 flex-col">
        <span className="text-sm">{t("settings.analyticsEnabled")}</span>
        <span className="text-xs text-muted-foreground">{t("settings.analyticsDesc")}</span>
      </div>
      <Switch checked={consent} onCheckedChange={onConsentChange} />
    </div>
  )
}
