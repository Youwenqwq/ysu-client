"use client"

import { Bike, ChevronRight, Clock3 } from "lucide-react"
import { Badge } from "@orahako/plugin-ui/components"
import { Skeleton } from "@orahako/plugin-ui/components"
import type { PerlicaMachine } from "../extras/types"
import { usePluginTranslation } from "@orahako/plugin-ui/plugin"
import { PERLICA_PLUGIN_ID } from "../constants"
import { cn } from "@orahako/plugin-ui/components"

interface Props {
  machines: PerlicaMachine[]
  selectedCode: string
  loading?: boolean
  onSelect: (code: string) => void
}

const STALE_POSITION_MS = 6 * 60 * 60 * 1000

function isStalePosition(value: unknown) {
  if (value === null || value === undefined || value === "") return false
  const numeric = Number(value)
  const timestamp = Number.isFinite(numeric)
    ? numeric < 10_000_000_000
      ? numeric * 1000
      : numeric
    : Date.parse(String(value))
  return Number.isFinite(timestamp) && Date.now() - timestamp > STALE_POSITION_MS
}

function batteryTone(battery: number): string {
  if (battery >= 60) {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  }
  if (battery >= 25) {
    return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  }
  return "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
}

function NearbySkeleton() {
  return (
    <div className="divide-y">
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Inset grouped list for nearby bikes. Mirrors the iOS list row anatomy:
 * leading symbol, title with a status badge, secondary detail lines, and a
 * trailing disclosure indicator.
 */
export function PerlicaNearbyList({ machines, selectedCode, loading = false, onSelect }: Props) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)

  if (loading && machines.length === 0) return <NearbySkeleton />
  if (machines.length === 0) return null

  return (
    <div className="divide-y">
      {machines.map((machine) => {
        const code = machine.userCode || machine.machineNo
        const stale = isStalePosition(machine.raw.posDt)
        const selected = selectedCode === machine.userCode || selectedCode === machine.machineNo

        return (
          <button
            key={machine.machineNo || machine.userCode}
            type="button"
            onClick={() => onSelect(code)}
            className={cn(
              "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 active:bg-muted",
              selected && "bg-muted/50"
            )}
          >
            <span
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
                stale && "opacity-60"
              )}
            >
              <Bike className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{code}</span>
                {stale ? (
                  <Badge variant="outline" className="shrink-0 gap-1 text-muted-foreground">
                    <Clock3 className="size-3" />
                    {t("perlica.stalePosition")}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className={cn("shrink-0 tabular-nums", batteryTone(machine.battery))}
                  >
                    {Math.round(machine.battery)}%
                  </Badge>
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {machine.machineNo || t("perlica.noMachineNo")}
                {" · "}
                {t("perlica.distanceMeters", { distance: Math.round(machine.distance) })}
              </span>
              {machine.address ? (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {machine.address}
                </span>
              ) : null}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
