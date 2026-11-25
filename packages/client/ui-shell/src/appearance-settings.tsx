import type { MouseEvent } from "react"
import { ChevronRight, Image as ImageIcon, LayoutTemplate, Palette, Sun } from "lucide-react"
import { ResponsiveSelect, ToggleGroup, ToggleGroupItem } from "@orahako/ui-primitives"
import type {
  AppearanceColorMode,
  AppearanceSnapshot,
  DerivedComponentProps,
  ObservableSource,
  PluginHostPreferenceSnapshot,
  PluginUIServiceSnapshot,
  SlotComponent,
} from "@orahako/sdk"
import "./slots-declare"
import type { ShellDictionary } from "./dictionary"
import type { AppearanceStoreInstance } from "./store"

export interface AppearanceSettingsInject {
  readonly hooks: {
    readonly ui: ObservableSource<PluginUIServiceSnapshot>
    readonly preference: ObservableSource<PluginHostPreferenceSnapshot>
    readonly appearance: ObservableSource<AppearanceSnapshot | null>
  }
  readonly setColorMode: (colorMode: AppearanceColorMode) => void
  readonly getActiveShell: () => string | undefined
  readonly getDefaultShell: () => string | undefined
  readonly setActiveShell: (shellId: string | undefined) => void
  readonly defaultShellQualifiedId: string
  readonly getActiveTheme: () => string
  readonly themeHref: string
  readonly navigateToTheme: () => void
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

function isColorMode(value: string): value is AppearanceColorMode {
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
  const { t, useStore, getActiveTheme } = props
  const uiSnapshot = props.useUi()
  const preference = props.usePreference()
  const appearance = props.useAppearance()
  const fallbackColorMode = useStore((s) => s.colorMode)
  const colorMode = appearance?.colorMode ?? fallbackColorMode
  const activeTheme = preference.activeTheme ?? getActiveTheme()

  const activeShellId = preference.activeShell ?? props.getActiveShell() ?? props.getDefaultShell()
  const isDefaultShellActive =
    !activeShellId || activeShellId === props.defaultShellQualifiedId || activeShellId === "default"

  const shells = uiSnapshot.shells
  const shellItems = shells.map((shell) => ({
    value: `${shell.pluginId}:${shell.id}`,
    label: shell.name,
  }))
  const selectedShellValue =
    shells
      .map((shell) => `${shell.pluginId}:${shell.id}`)
      .find(
        (qualified) => activeShellId === qualified || activeShellId === qualified.split(":")[1]
      ) ??
    shellItems[0]?.value ??
    ""

  const customThemes = uiSnapshot.themes.filter((theme) => theme.css.trim().length > 0)
  const activeThemeName =
    customThemes.find(
      (theme) => activeTheme === `${theme.pluginId}:${theme.id}` || activeTheme === theme.id
    )?.name ?? t("appearance.defaultTheme")

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
              props.setColorMode(value)
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

      {shells.length > 1 && (
        <div className="flex items-center gap-3 py-3" data-settings-shell-select="">
          <LayoutTemplate className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-sm">{t("appearance.shell")}</span>
          <ResponsiveSelect
            value={selectedShellValue}
            onValueChange={(value) => {
              props.setActiveShell(value === props.defaultShellQualifiedId ? undefined : value)
            }}
            items={shellItems}
            title={t("appearance.shell")}
            className="h-8 w-auto max-w-[12rem] min-w-[7.5rem] text-xs"
          />
        </div>
      )}

      {customThemes.length > 0 && (
        <a
          href={props.themeHref}
          onClick={(event) => handleSpaClick(event, props.navigateToTheme)}
          className="flex min-w-0 items-center gap-3 py-3 transition-colors active:bg-muted/60"
          data-settings-theme-link=""
        >
          <Palette className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-sm">{t("appearance.customTheme")}</span>
          <span className="max-w-[45%] truncate text-xs text-muted-foreground">
            {activeThemeName}
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </a>
      )}

      {isDefaultShellActive && (
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
      )}
    </>
  )
}
