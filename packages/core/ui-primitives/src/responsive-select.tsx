import { useState } from "react"
import { ChevronDownIcon } from "lucide-react"

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerNested,
  DrawerTitle,
} from "./drawer"
import { FilterOptionList } from "./filter-drawer"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { useIsMobile } from "./use-mobile"
import { cn } from "./utils"

export interface ResponsiveSelectItem {
  value: string
  label: string
}

export interface ResponsiveSelectProps {
  value: string
  onValueChange: (value: string) => void
  items: ReadonlyArray<ResponsiveSelectItem>
  placeholder?: string
  title?: string
  nested?: boolean
  className?: string
  id?: string
  ariaLabel?: string
}

export function ResponsiveSelect({
  value,
  onValueChange,
  items,
  placeholder,
  title,
  nested,
  className,
  id,
  ariaLabel,
}: ResponsiveSelectProps) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const activeLabel = items.find((item) => item.value === value)?.label
  const DrawerRoot = nested ? DrawerNested : Drawer

  if (!isMobile) {
    return (
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} aria-label={ariaLabel} className={cn("w-full", className)}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <>
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        onClick={(e) => {
          e.currentTarget.blur()
          setOpen(true)
        }}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none dark:bg-input/30",
          className
        )}
      >
        <span className={cn("line-clamp-1", !activeLabel && "text-muted-foreground")}>
          {activeLabel ?? placeholder}
        </span>
        <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <DrawerRoot open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title ?? placeholder ?? ""}</DrawerTitle>
            <DrawerDescription className="sr-only">{title ?? placeholder ?? ""}</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-6">
            <FilterOptionList
              items={items}
              value={value}
              onChange={(nextValue) => {
                onValueChange(nextValue)
                setOpen(false)
              }}
            />
          </div>
        </DrawerContent>
      </DrawerRoot>
    </>
  )
}
