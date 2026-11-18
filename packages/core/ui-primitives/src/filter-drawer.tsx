import type { ReactNode } from "react"
import { Check, ChevronDown } from "lucide-react"

import { Button } from "./button"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "./drawer"
import { cn } from "./utils"

export interface FilterTriggerProps {
  label: string
  onClick: () => void
  ariaLabel?: string
  className?: string
}

export function FilterTrigger({ label, onClick, ariaLabel, className }: FilterTriggerProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.currentTarget.blur()
        onClick()
      }}
      className={cn("h-8 max-w-44 gap-0.5 px-2 text-sm", className)}
    >
      <span className="truncate">{label}</span>
      <ChevronDown className="size-3.5 shrink-0" />
    </Button>
  )
}

export interface FilterDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
}

export function FilterDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
}: FilterDrawerProps) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription className={description ? undefined : "sr-only"}>
            {description ?? title}
          </DrawerDescription>
        </DrawerHeader>
        <div className="px-4 pb-6">{children}</div>
      </DrawerContent>
    </Drawer>
  )
}

export interface FilterOptionListProps {
  items: ReadonlyArray<{ value: string; label: string }>
  value: string | undefined
  onChange: (value: string) => void
  className?: string
}

export function FilterOptionList({ items, value, onChange, className }: FilterOptionListProps) {
  return (
    <div
      className={cn("flex max-h-[50vh] flex-col divide-y divide-border overflow-y-auto", className)}
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={cn(
              "flex items-center gap-3 py-3 text-left text-sm transition-colors active:bg-muted/60",
              active && "font-medium text-primary"
            )}
          >
            <span className="flex-1">{item.label}</span>
            {active && <Check className="size-4 shrink-0" />}
          </button>
        )
      })}
    </div>
  )
}
