import type { ReactNode } from "react"
import { BarChart3 } from "lucide-react"
import type { DerivedComponentProps, ObservableSource, SlotComponentOwner } from "@orahako/sdk"
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Switch,
} from "@orahako/ui-primitives"
import type { AnalyticsDictionary } from "./dictionary"
import type { AnalyticsConsentStore } from "./store"

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.overlay": { kind: "list"; owner: Record<string, never> }
    "settings.general": { kind: "list"; owner: Record<string, never> }
  }
}

export interface AnalyticsPromptInject {
  readonly onAgree: () => void
  readonly onDecline: () => void
  readonly hooks: {
    readonly promptOpen: ObservableSource<boolean>
  }
}

export type AnalyticsPromptProps = DerivedComponentProps<
  SlotComponentOwner<"shell.overlay">,
  AnalyticsDictionary,
  undefined,
  AnalyticsConsentStore,
  AnalyticsPromptInject
>

export function AnalyticsPrompt(props: AnalyticsPromptProps): ReactNode {
  const { t, onAgree, onDecline, usePromptOpen } = props
  const open = usePromptOpen()

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onDecline()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <BarChart3 className="size-5 text-primary" />
            <DialogTitle>{t("analyticsPrompt.title")}</DialogTitle>
          </div>
          <DialogDescription className="pt-2 leading-relaxed">
            {t("analyticsPrompt.content")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onDecline}>
            {t("analyticsPrompt.decline")}
          </Button>
          <Button onClick={onAgree}>{t("analyticsPrompt.agree")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export type AnalyticsSettingsToggleProps = DerivedComponentProps<
  SlotComponentOwner<"settings.general">,
  AnalyticsDictionary,
  undefined,
  AnalyticsConsentStore,
  undefined
>

export function AnalyticsSettingsToggle(props: AnalyticsSettingsToggleProps): ReactNode {
  const { t, useStore, actions } = props
  const consent = useStore((state) => state.consent)

  return (
    <Card className="py-0">
      <CardContent className="flex flex-col py-1">
        <div className="flex items-center gap-3 py-3">
          <BarChart3 className="size-5 shrink-0 text-muted-foreground" />
          <div className="flex flex-1 flex-col">
            <span className="text-sm">{t("settings.analyticsEnabled")}</span>
            <span className="text-xs text-muted-foreground">{t("settings.analyticsDesc")}</span>
          </div>
          <Switch
            checked={consent}
            onCheckedChange={(checked) => {
              actions.setConsent(checked)
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}
