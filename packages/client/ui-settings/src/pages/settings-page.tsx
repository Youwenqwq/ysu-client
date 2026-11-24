import { useEffect, useState, type MouseEvent } from "react"
import { toast } from "sonner"
import {
  ChevronRight,
  Globe,
  Info,
  LayoutDashboard,
  RotateCcw,
  Save,
  Smartphone,
} from "lucide-react"
import {
  Badge,
  Button,
  Card,
  CardContent,
  SettingsSection,
  Switch,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from "@orahako/ui-primitives"
import type {
  DerivedComponentProps,
  ObservableSource,
  PluginHostPreferenceSnapshot,
  PluginLocale,
  PluginSettingsCategory,
  SlotComponent,
} from "@orahako/sdk"
import "../slots-declare"
import type { SettingsDictionary } from "../dictionary"
import {
  normalizeCustomUserAgent,
  resolveEffectiveUserAgent,
  type SettingsStoreInstance,
} from "../store"

export const settingsPageChildren = {
  "settings.appearance": { kind: "list" },
  "settings.startupOptions": { kind: "list" },
  "settings.general": { kind: "list" },
  "settings.account": { kind: "list" },
  "settings.widgets": { kind: "list" },
} as const

export interface SettingsPageInject {
  readonly hooks: {
    readonly categories: ObservableSource<readonly PluginSettingsCategory[]>
    readonly preference: ObservableSource<PluginHostPreferenceSnapshot>
  }
  readonly setLocale: (locale: PluginLocale) => void
  readonly categoryHref: (categoryId: string) => string
  readonly navigateToCategory: (categoryId: string) => void
  readonly aboutHref: string
  readonly navigateToAbout: () => void
  readonly resolveCategoryTitle: (category: PluginSettingsCategory, locale: PluginLocale) => string
  readonly resolveCategoryDescription: (
    category: PluginSettingsCategory,
    locale: PluginLocale
  ) => string
  readonly getStartupPage: () => string | undefined
  readonly setStartupPage: (route: string | undefined) => void
  readonly getDefaultUserAgent: () => string
}

export type SettingsPageProps = DerivedComponentProps<
  Record<string, never>,
  SettingsDictionary,
  typeof settingsPageChildren,
  SettingsStoreInstance,
  SettingsPageInject
>

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

export const SettingsPage: SlotComponent<SettingsPageProps> = (props) => {
  const { t, locale, renderSlot, useStore, actions } = props
  const categories = props.useCategories()
  const preference = props.usePreference()
  const customUserAgentEnabled = useStore((s) => s.customUserAgentEnabled)
  const customUserAgent = useStore((s) => s.customUserAgent)
  const startupPage = preference.startupPage ?? props.getStartupPage() ?? ""

  const [uaDraft, setUaDraft] = useState(customUserAgent)
  useEffect(() => {
    setUaDraft(customUserAgent)
  }, [customUserAgent])

  const startupOptionsNode = renderSlot("settings.startupOptions")
  const appearanceNode = renderSlot("settings.appearance")
  const generalNode = renderSlot("settings.general")
  const widgetsNode = renderSlot("settings.widgets")
  const accountNode = renderSlot("settings.account")

  const effectiveUa = resolveEffectiveUserAgent(
    { customUserAgentEnabled, customUserAgent },
    props.getDefaultUserAgent()
  )

  const handleSaveUa = () => {
    actions.setCustomUserAgent(normalizeCustomUserAgent(uaDraft))
    toast.success(t("userAgentSaved"))
  }

  const handleResetUa = () => {
    actions.resetCustomUserAgent()
    setUaDraft("")
    toast.success(t("userAgentReset"))
  }

  return (
    <div className="flex flex-col gap-6" data-page="settings">
      <h1 className="text-lg font-semibold">{t("title")}</h1>

      <SettingsSection title={t("sectionPreferences")}>
        <Card className="py-0">
          <CardContent className="flex flex-col divide-y divide-border py-1">
            {startupOptionsNode !== null && (
              <div className="flex items-center gap-3 py-3">
                <LayoutDashboard className="size-5 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-sm">{t("startupPage")}</span>
                <ToggleGroup
                  type="single"
                  value={startupPage}
                  onValueChange={(value) => {
                    if (!value) return
                    props.setStartupPage(value)
                  }}
                  variant="outline"
                  size="sm"
                >
                  {startupOptionsNode}
                </ToggleGroup>
              </div>
            )}

            {appearanceNode}

            <div className="flex items-center gap-3 py-3">
              <Globe className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("language")}</span>
              <ToggleGroup
                type="single"
                value={locale}
                onValueChange={(value) => {
                  if (value === "zh" || value === "en") {
                    props.setLocale(value)
                  }
                }}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="zh" className="text-xs">
                  {t("languageZh")}
                </ToggleGroupItem>
                <ToggleGroupItem value="en" className="text-xs">
                  {t("languageEn")}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {generalNode}
          </CardContent>
        </Card>
      </SettingsSection>

      {categories.length > 0 && (
        <SettingsSection title={t("sectionPluginSettings")}>
          <Card className="py-0">
            <CardContent className="flex flex-col divide-y divide-border py-1">
              {categories.map((category) => {
                const Icon = category.icon
                const href = props.categoryHref(category.id)
                const title = props.resolveCategoryTitle(category, locale)
                const description = props.resolveCategoryDescription(category, locale)
                return (
                  <a
                    key={`${category.pluginId}:${category.id}`}
                    href={href}
                    data-category-id={category.id}
                    onClick={(event) =>
                      handleSpaClick(event, () => props.navigateToCategory(category.id))
                    }
                    className="group flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
                  >
                    <div className="rounded-lg bg-muted p-2 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                      <Icon className="size-4.5" />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium">{title}</span>
                      {description && (
                        <span className="truncate text-xs text-muted-foreground">
                          {description}
                        </span>
                      )}
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </a>
                )
              })}
            </CardContent>
          </Card>
        </SettingsSection>
      )}

      {widgetsNode !== null && (
        <SettingsSection title={t("sectionWidgets")}>
          <div className="flex flex-col gap-3">{widgetsNode}</div>
        </SettingsSection>
      )}

      <SettingsSection title={t("sectionNetwork")}>
        <Card className="py-0">
          <CardContent className="flex flex-col gap-3 py-3">
            <div className="flex items-center gap-3">
              <Smartphone className="size-5 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{t("enableCustomUserAgent")}</span>
                  <Badge
                    variant={customUserAgentEnabled ? "secondary" : "outline"}
                    className="text-[10px]"
                  >
                    {customUserAgentEnabled
                      ? t("customUserAgentBadge")
                      : t("defaultUserAgentBadge")}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">{t("customUserAgentDesc")}</span>
              </div>
              <Switch
                checked={customUserAgentEnabled}
                onCheckedChange={(enabled) => actions.setCustomUserAgentEnabled(enabled)}
              />
            </div>

            {effectiveUa && (
              <span className="font-mono text-[11px] break-all text-muted-foreground">
                {effectiveUa}
              </span>
            )}

            {customUserAgentEnabled && (
              <div className="flex flex-col gap-2 pt-1">
                <Textarea
                  name="custom-user-agent"
                  value={uaDraft}
                  onChange={(event) => setUaDraft(event.target.value)}
                  placeholder={t("emptyUserAgentPlaceholder")}
                  className="min-h-20 font-mono text-[11px]"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleResetUa}>
                    <RotateCcw className="mr-1 size-3.5" />
                    {t("resetUserAgent")}
                  </Button>
                  <Button type="button" size="sm" onClick={handleSaveUa}>
                    <Save className="mr-1 size-3.5" />
                    {t("saveUserAgent")}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </SettingsSection>

      {accountNode !== null && (
        <SettingsSection title={t("sectionAccount")}>
          <Card className="py-0">
            <CardContent className="flex flex-col divide-y divide-border py-1">
              {accountNode}
            </CardContent>
          </Card>
        </SettingsSection>
      )}

      <SettingsSection title={t("sectionAbout")}>
        <Card className="py-0">
          <CardContent className="flex flex-col py-1">
            <a
              href={props.aboutHref}
              onClick={(event) => handleSpaClick(event, props.navigateToAbout)}
              className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
            >
              <Info className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{t("about")}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </a>
          </CardContent>
        </Card>
      </SettingsSection>
    </div>
  )
}
