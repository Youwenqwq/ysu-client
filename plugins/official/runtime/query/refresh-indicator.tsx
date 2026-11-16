"use client"

import { Spinner } from "@orahako/plugin-ui/components"
import { useRefreshStore } from "@/plugins/official/runtime/query/refresh-store"
import { cn } from "@orahako/plugin-ui/components"

export function RefreshIndicator({ className }: { className?: string }) {
  const count = useRefreshStore((s) => s.count)
  if (count === 0) return null
  return (
    <Spinner className={cn("size-4 text-muted-foreground", className)} aria-label="Refreshing" />
  )
}
