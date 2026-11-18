import { Wallet2 } from "lucide-react"
import { hasSlice, type ProviderRuntimeSnapshot } from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import { Switch } from "@orahako/ui-primitives"
import type { EpayDictionary } from "./dictionary"
import type { EpaySettingsStoreInstance } from "./store"

export interface EpayNotificationSettingsInject {
  readonly hooks: {
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
}

export type EpayNotificationSettingsProps = DerivedComponentProps<
  Record<string, never>,
  EpayDictionary,
  undefined,
  EpaySettingsStoreInstance,
  EpayNotificationSettingsInject
>

export const EpayNotificationSettings: SlotComponent<EpayNotificationSettingsProps> = (props) => {
  const { t, useStore, actions } = props
  const providerSnap = props.useProvider()
  const notifyEnabled = useStore((s) => s.notifyEnabled)

  if (!hasSlice(providerSnap.provider, "epay")) {
    return null
  }

  return (
    <div data-epay-reminder-settings="">
      <h3 className="flex items-center gap-2 border-t border-border px-0.5 pt-3 pb-0.5 text-xs font-medium text-muted-foreground">
        {t("settings.epayReminderTitle")}
      </h3>

      <div className="flex items-center gap-3 py-3">
        <Wallet2 className="size-5 shrink-0 text-muted-foreground" />
        <div className="flex flex-1 flex-col">
          <span className="text-sm">{t("epay.remindLabel")}</span>
          <span className="text-xs text-muted-foreground">{t("epay.remindDesc")}</span>
        </div>
        <Switch
          aria-label={t("epay.remindLabel")}
          checked={notifyEnabled}
          onCheckedChange={actions.setNotifyEnabled}
        />
      </div>
    </div>
  )
}
