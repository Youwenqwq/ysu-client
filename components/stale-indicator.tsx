"use client"

import { CloudOff } from "lucide-react"
import { useRefreshStore } from "@/lib/stores/refresh"
import { useTranslation } from "@/lib/i18n/use-translation"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export function StaleIndicator({ className }: { className?: string }) {
  const stale = useRefreshStore((s) => s.stale)
  const { t } = useTranslation()

  if (stale === 0) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-md p-1 text-muted-foreground",
            className
          )}
          aria-label={t("app.staleDataTooltip")}
        >
          <CloudOff className="size-4" />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{t("app.staleDataTooltip")}</p>
      </TooltipContent>
    </Tooltip>
  )
}
