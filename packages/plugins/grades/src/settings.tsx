import { Eye, Sparkles } from "lucide-react"
import { hasSlice, type ProviderRuntimeSnapshot } from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import { Card, CardContent, Switch, ToggleGroupItem } from "@orahako/ui-primitives"
import type { GradesDictionary } from "./dictionary"
import "./slots"
import type { GradesSettingsStoreInstance } from "./store"

export type GradesSettingsPanelProps = DerivedComponentProps<
  Record<string, never>,
  GradesDictionary,
  undefined,
  GradesSettingsStoreInstance
>

export const GradesSettingsPanel: SlotComponent<GradesSettingsPanelProps> = (props) => {
  const { t, useStore, actions } = props
  const gradeGachaEnabled = useStore((s) => s.gradeGachaEnabled)
  const gpaVisible = useStore((s) => s.gpaVisible)

  return (
    <Card data-grades-settings="" className="py-0">
      <CardContent className="flex flex-col divide-y divide-border py-1">
        <div className="flex items-center gap-3 py-3">
          <Sparkles className="size-5 shrink-0 text-muted-foreground" />
          <div className="flex flex-1 flex-col">
            <span className="text-sm">{t("settings.gradeGacha")}</span>
            <span className="text-xs text-muted-foreground">{t("settings.gradeGachaDesc")}</span>
          </div>
          <Switch
            aria-label={t("settings.gradeGacha")}
            checked={gradeGachaEnabled}
            onCheckedChange={actions.setGradeGachaEnabled}
          />
        </div>

        <div className="flex items-center gap-3 py-3">
          <Eye className="size-5 shrink-0 text-muted-foreground" />
          <div className="flex flex-1 flex-col">
            <span className="text-sm">{t("settings.gpaVisible")}</span>
            <span className="text-xs text-muted-foreground">{t("settings.gpaVisibleDesc")}</span>
          </div>
          <Switch
            aria-label={t("settings.gpaVisible")}
            checked={gpaVisible}
            onCheckedChange={actions.setGpaVisible}
          />
        </div>
      </CardContent>
    </Card>
  )
}

export interface GradeNotificationContentInject {
  readonly hooks: {
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
}

export type GradeNotificationContentProps = DerivedComponentProps<
  Record<string, never>,
  GradesDictionary,
  undefined,
  undefined,
  GradeNotificationContentInject
>

export const GradeNotificationContent: SlotComponent<GradeNotificationContentProps> = (props) => {
  const providerSnap = props.useProvider()

  if (!hasSlice(providerSnap.provider, "grades")) {
    return null
  }

  return (
    <ToggleGroupItem value="grades" className="text-xs">
      {props.t("settings.notifyGrades")}
    </ToggleGroupItem>
  )
}
