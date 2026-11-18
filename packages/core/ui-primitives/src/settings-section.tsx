import type { ReactNode } from "react"

import { cn } from "./utils"

export interface SettingsSectionProps {
  title: ReactNode
  children?: ReactNode
  className?: string
}

export function SettingsSection({ title, children, className }: SettingsSectionProps) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <h2 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}
