import { Award, Eye, Sparkles } from "lucide-react"
import { hasSlice, type ProviderRuntimeSnapshot } from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import { Card, CardContent, Switch, ToggleGroup, ToggleGroupItem } from "@orahako/ui-primitives"
import type { GradesDictionary } from "./dictionary"
import "./slots"
import type { GpaDisplayMode, GradesSettingsStoreInstance } from "./store"

function isGpaDisplayMode(value: string): value is GpaDisplayMode {
  return value === "initial" || value === "highest"
}

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
  const gpaDisplayMode = useStore((s) => s.gpaDisplayMode)

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

        <div className="flex items-center gap-3 py-3" data-grades-gpa-mode="">
          <Award className="size-5 shrink-0 text-muted-foreground" />
          <div className="flex flex-1 flex-col">
            <span className="text-sm">{t("settings.gpaDisplayMode")}</span>
            <span className="text-xs text-muted-foreground">
              {t("settings.gpaDisplayModeDesc")}
            </span>
          </div>
          <ToggleGroup
            type="single"
            value={gpaDisplayMode}
            onValueChange={(value) => {
              if (isGpaDisplayMode(value)) {
                actions.setGpaDisplayMode(value)
              }
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="initial" className="text-xs">
              {t("settings.gpaModeInitial")}
            </ToggleGroupItem>
            <ToggleGroupItem value="highest" className="text-xs">
              {t("settings.gpaModeHighest")}
            </ToggleGroupItem>
          </ToggleGroup>
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
