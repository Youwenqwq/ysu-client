"use client"

import { cn } from "@/lib/utils"

/**
 * 单选筛选 chips（批次/学期等少量选项的场景）。
 * value 为 string 键；选项少于一屏时横向换行展示。
 */
export function FilterChips({
  items,
  value,
  onChange,
}: {
  items: ReadonlyArray<{ value: string; label: string }>
  value: string | undefined
  onChange: (value: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            "h-7 rounded-none border-2 px-2.5 font-mono text-[0.7rem] tracking-wide transition-colors",
            item.value === value
              ? "border-edge bg-primary text-primary-foreground shadow-[2px_2px_0_0_var(--shadow-color)]"
              : "border-edge/35 bg-background text-foreground hover:border-edge/60 hover:bg-accent active:bg-accent"
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
