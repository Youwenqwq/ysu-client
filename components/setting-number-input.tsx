"use client"

import { useState, type ComponentType } from "react"
import { Input } from "./ui/input"
import { cn } from "@/lib/utils"

export function SettingNumberInput({
  icon: Icon,
  label,
  description,
  value,
  onChange,
  min,
  max,
  unit,
  bordered,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  description?: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  unit: string
  bordered?: boolean
}) {
  const [local, setLocal] = useState(String(value))

  function commit() {
    const parsed = parseInt(local, 10)
    const clamped = Math.min(max, Math.max(min, Number.isNaN(parsed) ? value : parsed))
    setLocal(String(clamped))
    if (clamped !== value) onChange(clamped)
  }

  return (
    <div className={cn("flex items-center gap-3 py-3", bordered && "border-t border-border")}>
      <Icon className="size-5 shrink-0 text-muted-foreground" />
      <div className="flex flex-1 flex-col">
        <span className="text-sm">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          name="setting-number"
          type="number"
          value={local}
          onChange={(event) => setLocal(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit()
              event.currentTarget.blur()
            }
          }}
          className="h-7 w-16 text-right text-sm"
          min={min}
          max={max}
        />
        <span className="text-sm text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}
