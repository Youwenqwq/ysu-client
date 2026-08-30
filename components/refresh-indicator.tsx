"use client"

import { Spinner } from "@/components/ui/spinner"
import { useRefreshStore } from "@/lib/stores/refresh"
import { cn } from "@/lib/utils"

export function RefreshIndicator({ className }: { className?: string }) {
  const count = useRefreshStore((s) => s.count)
  if (count === 0) return null
  return (
    <Spinner className={cn("size-4 text-muted-foreground", className)} aria-label="Refreshing" />
  )
}
