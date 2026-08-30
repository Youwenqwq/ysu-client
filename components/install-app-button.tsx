"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { useTranslation } from "@/lib/i18n/use-translation"
import { isCapacitor } from "@/lib/native/platform"
import { getState, prompt, subscribe } from "@/lib/pwa-install"

export function InstallAppButton() {
  const { t } = useTranslation()
  const installState = useSyncExternalStore(subscribe, getState, getState)
  const [nativePlatform, setNativePlatform] = useState<boolean | null>(null)
  const [showIosInstructions, setShowIosInstructions] = useState(false)
  const [prompting, setPrompting] = useState(false)

  useEffect(() => {
    setNativePlatform(isCapacitor())
  }, [])

  if (
    nativePlatform !== false ||
    installState.installed ||
    (!installState.deferredPrompt && !installState.isIos)
  ) {
    return null
  }

  const handleInstall = async () => {
    if (!installState.deferredPrompt) {
      setShowIosInstructions(true)
      return
    }

    setPrompting(true)
    try {
      await prompt()
    } finally {
      setPrompting(false)
    }
  }

  return (
    <>
      <Separator />
      <button
        type="button"
        onClick={handleInstall}
        disabled={prompting}
        className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60 disabled:opacity-50"
      >
        <Download className="size-5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-left text-sm">{t("about.installApp")}</span>
        <span className="text-xs text-muted-foreground">{t("about.installAppDesc")}</span>
      </button>

      <Dialog open={showIosInstructions} onOpenChange={setShowIosInstructions}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("about.installAppIosTitle")}</DialogTitle>
            <DialogDescription>{t("about.installAppDesc")}</DialogDescription>
          </DialogHeader>
          <ol className="ml-5 list-decimal space-y-2 text-sm">
            <li>{t("about.installAppIosStep1")}</li>
            <li>{t("about.installAppIosStep2")}</li>
            <li>{t("about.installAppIosStep3")}</li>
          </ol>
          <DialogFooter>
            <Button onClick={() => setShowIosInstructions(false)}>{t("dialog.ok")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
