import { useEffect, useState } from "react"
import { toast } from "sonner"
import { RotateCcw, Save } from "lucide-react"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Switch,
  Textarea,
} from "@orahako/ui-primitives"
import type { DerivedComponentProps, SlotComponent } from "@orahako/sdk"
import "./slots-declare"
import type { SettingsDictionary } from "./dictionary"
import {
  normalizeCustomUserAgent,
  resolveEffectiveUserAgent,
  type SettingsStoreInstance,
} from "./store"

export interface UserAgentDebugInject {
  readonly getDefaultUserAgent: () => string
}

export type UserAgentDebugPanelProps = DerivedComponentProps<
  Record<string, never>,
  SettingsDictionary,
  undefined,
  SettingsStoreInstance,
  UserAgentDebugInject
>

export const UserAgentDebugPanel: SlotComponent<UserAgentDebugPanelProps> = (props) => {
  const { t, useStore, actions } = props
  const customUserAgentEnabled = useStore((s) => s.customUserAgentEnabled)
  const customUserAgent = useStore((s) => s.customUserAgent)
  const [uaDraft, setUaDraft] = useState(customUserAgent)

  useEffect(() => {
    setUaDraft(customUserAgent)
  }, [customUserAgent])

  const effectiveUa = resolveEffectiveUserAgent(
    { customUserAgentEnabled, customUserAgent },
    props.getDefaultUserAgent()
  )

  return (
    <Card data-debug-panel="user-agent">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{t("requestUserAgent")}</span>
          <Badge variant={customUserAgentEnabled ? "secondary" : "outline"} className="text-[10px]">
            {customUserAgentEnabled ? t("customUserAgentBadge") : t("defaultUserAgentBadge")}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <span className="font-mono text-[10px] break-all text-muted-foreground">{effectiveUa}</span>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("enableCustomUserAgent")}</span>
          <Switch
            checked={customUserAgentEnabled}
            onCheckedChange={(enabled) => actions.setCustomUserAgentEnabled(enabled)}
          />
        </div>
        {customUserAgentEnabled && (
          <>
            <Textarea
              name="debug-custom-user-agent"
              value={uaDraft}
              onChange={(event) => setUaDraft(event.target.value)}
              placeholder={t("emptyUserAgentPlaceholder")}
              className="min-h-20 font-mono text-[11px]"
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  actions.resetCustomUserAgent()
                  setUaDraft("")
                  toast.success(t("userAgentReset"))
                }}
              >
                <RotateCcw className="mr-1 size-3.5" />
                {t("resetUserAgent")}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  actions.setCustomUserAgent(normalizeCustomUserAgent(uaDraft))
                  toast.success(t("userAgentSaved"))
                }}
              >
                <Save className="mr-1 size-3.5" />
                {t("saveUserAgent")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
