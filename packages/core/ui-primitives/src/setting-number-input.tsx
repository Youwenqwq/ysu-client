import { useEffect, useState, type ComponentType } from "react"

import { Input } from "./input"
import { cn } from "./utils"

export function clampSettingNumber(
  raw: string,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number.parseInt(raw, 10)
  return Math.min(max, Math.max(min, Number.isNaN(parsed) ? fallback : parsed))
}

export interface SettingNumberInputProps {
  icon: ComponentType<{ className?: string }>
  label: string
  description?: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  unit: string
  bordered?: boolean
}

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
}: SettingNumberInputProps) {
  const [local, setLocal] = useState(String(value))

  useEffect(() => {
    setLocal(String(value))
  }, [value])

  function commit() {
    const clamped = clampSettingNumber(local, value, min, max)
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
          aria-label={label}
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
