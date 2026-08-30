"use client"

import { useState } from "react"
import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useTranslation } from "@/lib/i18n/use-translation"
import { applyWebUpdate, dismissWebUpdate } from "@/lib/pwa-updater"
import { usePwaUpdateStore } from "@/lib/stores/pwa-update"

export function PwaUpdatePrompt() {
  const { t } = useTranslation()
  const updateAvailable = usePwaUpdateStore((s) => s.updateAvailable)
  const [applying, setApplying] = useState(false)

  if (!updateAvailable) return null

  const handleApply = async () => {
    setApplying(true)
    try {
      await applyWebUpdate()
    } catch {
      setApplying(false)
    }
  }

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-md items-center gap-3 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur md:bottom-4"
    >
      <RefreshCw className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-sm">{t("update.pwaReady")}</span>
      <Button size="sm" variant="ghost" onClick={() => void dismissWebUpdate()} disabled={applying}>
        {t("update.skip")}
      </Button>
      <Button size="sm" onClick={handleApply} disabled={applying}>
        {applying ? t("update.applying") : t("update.pwaRestart")}
      </Button>
    </div>
  )
}
