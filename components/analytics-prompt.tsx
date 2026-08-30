"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useSettingsStore } from "@/lib/stores/settings"
import { useTranslation } from "@/lib/i18n/use-translation"
import { BarChart3 } from "lucide-react"

interface AnalyticsPromptProps {
  open: boolean
  onClose: () => void
}

export function AnalyticsPrompt({ open, onClose }: AnalyticsPromptProps) {
  const { t } = useTranslation()
  const setAnalyticsConsent = useSettingsStore((s) => s.setAnalyticsConsent)

  function handleAgree() {
    setAnalyticsConsent(true)
    onClose()
  }

  function handleDecline() {
    setAnalyticsConsent(false)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleDecline()
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
          <Button variant="outline" onClick={handleDecline}>
            {t("analyticsPrompt.decline")}
          </Button>
          <Button onClick={handleAgree}>{t("analyticsPrompt.agree")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
