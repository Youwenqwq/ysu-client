"use client"

import type { PluginKeyValueStorage } from "@orahako/plugin-sdk"
import {
  Card,
  CardContent,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from "@orahako/plugin-ui/components"
import { useTranslation } from "@orahako/plugin-ui/hooks"
import {
  DENSITY_STORAGE_KEY,
  LONG_MASCOTS_STORAGE_KEY,
  MASCOTS_STORAGE_KEY,
  TIMING_STORAGE_KEY,
  isActivityDensity,
  useActivitySettings,
} from "./state"

function SettingSwitch({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
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

export function NetworkActivitySettings({ storage }: { storage: PluginKeyValueStorage }) {
  const { t } = useTranslation()
  const density = useActivitySettings((state) => state.density)
  const setDensity = useActivitySettings((state) => state.setDensity)
  const showTiming = useActivitySettings((state) => state.showTiming)
  const setShowTiming = useActivitySettings((state) => state.setShowTiming)
  const showMascots = useActivitySettings((state) => state.showMascots)
  const setShowMascots = useActivitySettings((state) => state.setShowMascots)
  const longMascots = useActivitySettings((state) => state.longMascots)
  const setLongMascots = useActivitySettings((state) => state.setLongMascots)

  function handleDensityChange(value: string) {
    if (!isActivityDensity(value)) return
    setDensity(value)
    void storage.setItem(DENSITY_STORAGE_KEY, value).catch(() => {})
  }

  function handleTimingChange(enabled: boolean) {
    setShowTiming(enabled)
    void storage.setItem(TIMING_STORAGE_KEY, String(enabled)).catch(() => {})
  }

  function handleMascotsChange(enabled: boolean) {
    setShowMascots(enabled)
    void storage.setItem(MASCOTS_STORAGE_KEY, String(enabled)).catch(() => {})
  }

  function handleLongMascotsChange(enabled: boolean) {
    setLongMascots(enabled)
    void storage.setItem(LONG_MASCOTS_STORAGE_KEY, String(enabled)).catch(() => {})
  }

  return (
    <Card className="py-0">
      <CardContent className="flex flex-col gap-4 py-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{t("networkActivity.settings.density")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("networkActivity.settings.densityDescription")}
          </p>
        </div>
        <ToggleGroup
          type="single"
          value={density}
          onValueChange={handleDensityChange}
          variant="outline"
          className="w-full"
        >
          <ToggleGroupItem value="compact" className="flex-1 text-xs">
            {t("networkActivity.settings.compact")}
          </ToggleGroupItem>
          <ToggleGroupItem value="detailed" className="flex-1 text-xs">
            {t("networkActivity.settings.detailed")}
          </ToggleGroupItem>
          <ToggleGroupItem value="debug" className="flex-1 text-xs">
            {t("networkActivity.settings.debug")}
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {t(`networkActivity.settings.${density}Description`)}
        </p>
        <SettingSwitch
          label={t("networkActivity.settings.showTiming")}
          description={t("networkActivity.settings.showTimingDescription")}
          checked={showTiming}
          onCheckedChange={handleTimingChange}
        />
        <SettingSwitch
          label={t("networkActivity.settings.showMascots")}
          description={t("networkActivity.settings.showMascotsDescription")}
          checked={showMascots}
          onCheckedChange={handleMascotsChange}
        />
        {showMascots && (
          <SettingSwitch
            label={t(
              longMascots
                ? "networkActivity.settings.longMascotsOn"
                : "networkActivity.settings.longMascotsOff"
            )}
            description={t(
              longMascots
                ? "networkActivity.settings.longMascotsDescriptionOn"
                : "networkActivity.settings.longMascotsDescriptionOff"
            )}
            checked={longMascots}
            onCheckedChange={handleLongMascotsChange}
          />
        )}
      </CardContent>
    </Card>
  )
}
