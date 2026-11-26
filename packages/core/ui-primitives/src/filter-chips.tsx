import { cn } from "./utils"

export interface FilterChipItem {
  value: string
  label: string
}

export interface FilterChipsProps {
  items: ReadonlyArray<FilterChipItem>
  value: string | undefined
  onChange: (value: string) => void
  className?: string
}

export function FilterChips({ items, value, onChange, className }: FilterChipsProps) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm transition-colors",
            item.value === value
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-foreground active:bg-muted/60"
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
