import { Settings2 } from "lucide-react"
import { useState } from "react"
import type {
  DerivedComponentProps,
  ObservableSource,
  RouteLocation,
  SlotComponent,
} from "@orahako/sdk"
import {
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Input,
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  Switch,
} from "@orahako/ui-primitives"
import type { PluginsDictionary } from "./dictionary"
import type { PluginManagerPreferencesStore } from "./store"

export interface PluginsHeaderActionsInject {
  readonly hooks: {
    readonly location: ObservableSource<RouteLocation>
  }
  readonly pluginId: string
  readonly defaultMarketUrl?: string
}

export type PluginsHeaderActionsProps = DerivedComponentProps<
  Record<string, never>,
  PluginsDictionary,
  undefined,
  PluginManagerPreferencesStore,
  PluginsHeaderActionsInject
>

export const PluginsHeaderActions: SlotComponent<PluginsHeaderActionsProps> = (props) => {
  const { t, useStore, actions } = props
  const location = props.useLocation()
  const showSystemPlugins = useStore((state) => state.showSystemPlugins)
  const marketEnabled = useStore((state) => state.marketEnabled)
  const customMarketUrl = useStore((state) => state.customMarketUrl)
  const [open, setOpen] = useState(false)
  const [marketUrlDraft, setMarketUrlDraft] = useState("")
  const [marketUrlInvalid, setMarketUrlInvalid] = useState(false)

  const onPluginsPage = location.route
    ? location.route === "plugins"
    : location.pluginId === props.pluginId && (location.pageId ?? "plugins") === "plugins"
  if (!onPluginsPage) return null

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      setMarketUrlDraft(customMarketUrl)
      setMarketUrlInvalid(false)
    }
    setOpen(nextOpen)
  }

  const saveMarketUrl = (): void => {
    const nextUrl = marketUrlDraft.trim()
    if (nextUrl) {
      try {
        const url = new URL(nextUrl)
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error()
      } catch {
        setMarketUrlInvalid(true)
        return
      }
    }
    actions.setCustomMarketUrl(nextUrl)
    setOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        data-plugin-settings-trigger=""
        onClick={() => handleOpenChange(true)}
        aria-label={t("settings.title")}
      >
        <Settings2 className="size-4" />
      </Button>
      <ResponsiveModal open={open} onOpenChange={handleOpenChange}>
        <ResponsiveModalContent className="sm:max-w-md">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>{t("settings.title")}</ResponsiveModalTitle>
            <ResponsiveModalDescription>{t("settings.description")}</ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <ResponsiveModalBody>
            <FieldGroup className="gap-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <FieldLabel htmlFor="plugin-show-system">{t("settings.showSystem")}</FieldLabel>
                  <FieldDescription>{t("settings.showSystemDesc")}</FieldDescription>
                </div>
                <Switch
                  id="plugin-show-system"
                  checked={showSystemPlugins}
                  onCheckedChange={actions.setShowSystemPlugins}
                  aria-label={t("settings.showSystem")}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <FieldLabel htmlFor="plugin-enable-market">
                    {t("settings.enableMarket")}
                  </FieldLabel>
                  <FieldDescription>{t("settings.enableMarketDesc")}</FieldDescription>
                </div>
                <Switch
                  id="plugin-enable-market"
                  checked={marketEnabled}
                  onCheckedChange={actions.setMarketEnabled}
                  aria-label={t("settings.enableMarket")}
                />
              </div>
              <Field>
                <FieldLabel htmlFor="plugin-custom-market-url">
                  {t("settings.customMarketUrl")}
                </FieldLabel>
                <Input
                  id="plugin-custom-market-url"
                  type="url"
                  inputMode="url"
                  disabled={!marketEnabled}
                  value={marketUrlDraft}
                  placeholder={props.defaultMarketUrl}
                  aria-invalid={marketUrlInvalid}
                  aria-describedby="plugin-custom-market-url-description"
                  onChange={(event) => {
                    setMarketUrlDraft(event.target.value)
                    setMarketUrlInvalid(false)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      saveMarketUrl()
                    }
                  }}
                />
                <FieldDescription
                  id="plugin-custom-market-url-description"
                  className={marketUrlInvalid ? "text-destructive" : undefined}
                >
                  {t(
                    marketUrlInvalid ? "settings.invalidMarketUrl" : "settings.customMarketUrlDesc"
                  )}
                </FieldDescription>
              </Field>
            </FieldGroup>
          </ResponsiveModalBody>
          <ResponsiveModalFooter>
            <Button type="button" onClick={saveMarketUrl}>
              {t("settings.save")}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>
    </>
  )
}
