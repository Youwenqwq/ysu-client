import type { MouseEvent } from "react"
import { ChevronRight, Image as ImageIcon, Palette, Sun } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@orahako/ui-primitives"
import type {
  DerivedComponentProps,
  ObservableSource,
  PluginHostPreferenceSnapshot,
  PluginUIServiceSnapshot,
  SlotComponent,
} from "@orahako/sdk"
import "./slots-declare"
import type { ShellDictionary } from "./dictionary"
import type { AppearanceStoreInstance, ColorMode } from "./store"

export interface AppearanceSettingsInject {
  readonly hooks: {
    readonly ui: ObservableSource<PluginUIServiceSnapshot>
    readonly preference: ObservableSource<PluginHostPreferenceSnapshot>
  }
  readonly getActiveTheme: () => string
  readonly setActiveTheme: (themeId: string | undefined) => void
  readonly backgroundHref: string
  readonly navigateToBackground: () => void
}

export type AppearanceSettingsProps = DerivedComponentProps<
  Record<string, never>,
  ShellDictionary,
  undefined,
  AppearanceStoreInstance,
  AppearanceSettingsInject
>

function isColorMode(value: string): value is ColorMode {
  return value === "light" || value === "dark" || value === "system"
}

function handleSpaClick(event: MouseEvent<HTMLAnchorElement>, navigate: () => void): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return
  }
  event.preventDefault()
  navigate()
}

export const AppearanceSettingsSection: SlotComponent<AppearanceSettingsProps> = (props) => {
  const { t, useStore, actions, getActiveTheme, setActiveTheme } = props
  const uiSnapshot = props.useUi()
  const preference = props.usePreference()
  const colorMode = useStore((s) => s.colorMode)
  const activeTheme = preference.activeTheme ?? getActiveTheme()

  const customThemes = uiSnapshot.themes.filter((theme) => theme.css.trim().length > 0)

  return (
    <>
      <div className="flex items-center gap-3 py-3" data-settings-color-mode="">
        <Sun className="size-5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm">{t("appearance.themeMode")}</span>
        <ToggleGroup
          type="single"
          value={colorMode}
          onValueChange={(value) => {
            if (isColorMode(value)) {
              actions.setColorMode(value)
            }
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="light" className="text-xs">
            {t("appearance.themeLight")}
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" className="text-xs">
            {t("appearance.themeDark")}
          </ToggleGroupItem>
          <ToggleGroupItem value="system" className="text-xs">
            {t("appearance.themeSystem")}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {customThemes.length > 0 && (
        <div className="flex items-center gap-3 py-3" data-settings-custom-theme="">
          <Palette className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-sm">{t("appearance.customTheme")}</span>
          <ToggleGroup
            type="single"
            value={activeTheme || "__default__"}
            onValueChange={(value) => {
              if (!value) return
              setActiveTheme(value === "__default__" ? undefined : value)
            }}
            variant="outline"
            size="sm"
            className="flex flex-wrap justify-end"
          >
            <ToggleGroupItem value="__default__" className="text-xs">
              {t("appearance.defaultTheme")}
            </ToggleGroupItem>
            {customThemes.map((theme) => {
              const qualified = `${theme.pluginId}:${theme.id}`
              return (
                <ToggleGroupItem key={qualified} value={qualified} className="text-xs">
                  {theme.name}
                </ToggleGroupItem>
              )
            })}
          </ToggleGroup>
        </div>
      )}

      <a
        href={props.backgroundHref}
        onClick={(event) => handleSpaClick(event, props.navigateToBackground)}
        className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
        data-settings-background-link=""
      >
        <ImageIcon className="size-5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-sm">{t("appearance.backgroundEntry")}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </a>
    </>
  )
}
