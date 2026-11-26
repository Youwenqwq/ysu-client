import type { ReactNode } from "react"
import type { DerivedComponentProps, SlotComponent } from "@orahako/sdk"
import { Card, CardContent, Switch, ToggleGroup, ToggleGroupItem } from "@orahako/ui-primitives"
import type { NetworkActivityDictionary } from "./dictionary"
import { isActivityDensity, type ActivityDensity, type ActivitySettingsStore } from "./state"

function SettingSwitch({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  readonly label: string
  readonly description: string
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
}): ReactNode {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/40 pt-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  )
}

const DENSITY_DESCRIPTION_KEY: Readonly<
  Record<
    ActivityDensity,
    "settings.compactDescription" | "settings.detailedDescription" | "settings.debugDescription"
  >
> = {
  compact: "settings.compactDescription",
  detailed: "settings.detailedDescription",
  debug: "settings.debugDescription",
}

export type NetworkActivitySettingsProps = DerivedComponentProps<
  Record<string, never>,
  NetworkActivityDictionary,
  undefined,
  ActivitySettingsStore
>

export const NetworkActivitySettings: SlotComponent<NetworkActivitySettingsProps> = (props) => {
  const { t, useStore, actions } = props
  const density = useStore((state) => state.density)
  const showTiming = useStore((state) => state.showTiming)
  const showCompletionCheck = useStore((state) => state.showCompletionCheck)
  const showMascots = useStore((state) => state.showMascots)
  const longMascots = useStore((state) => state.longMascots)

  return (
    <Card className="py-0">
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t("settings.density")}</h3>
          <p className="text-xs text-muted-foreground">{t("settings.densityDescription")}</p>
        </div>
        <ToggleGroup
          type="single"
          value={density}
          onValueChange={(value) => {
            if (isActivityDensity(value)) {
              actions.setDensity(value)
            }
          }}
          variant="outline"
          className="w-full"
        >
          <ToggleGroupItem value="compact" className="flex-1 text-xs">
            {t("settings.compact")}
          </ToggleGroupItem>
          <ToggleGroupItem value="detailed" className="flex-1 text-xs">
            {t("settings.detailed")}
          </ToggleGroupItem>
          <ToggleGroupItem value="debug" className="flex-1 text-xs">
            {t("settings.debug")}
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">{t(DENSITY_DESCRIPTION_KEY[density])}</p>
        <SettingSwitch
          label={t("settings.showTiming")}
          description={t("settings.showTimingDescription")}
          checked={showTiming}
          onCheckedChange={actions.setShowTiming}
        />
        <SettingSwitch
          label={t("settings.showCompletionCheck")}
          description={t("settings.showCompletionCheckDescription")}
          checked={showCompletionCheck}
          onCheckedChange={actions.setShowCompletionCheck}
        />
        <SettingSwitch
          label={t("settings.showMascots")}
          description={t("settings.showMascotsDescription")}
          checked={showMascots}
          onCheckedChange={actions.setShowMascots}
        />
        {showMascots && (
          <SettingSwitch
            label={t(longMascots ? "settings.longMascotsOn" : "settings.longMascotsOff")}
            description={t(
              longMascots
                ? "settings.longMascotsDescriptionOn"
                : "settings.longMascotsDescriptionOff"
            )}
            checked={longMascots}
            onCheckedChange={actions.setLongMascots}
          />
        )}
      </CardContent>
    </Card>
  )
}
