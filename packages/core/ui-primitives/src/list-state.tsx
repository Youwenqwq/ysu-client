import { useEffect, type ReactNode } from "react"
import { toast } from "sonner"
import { CalendarOff } from "lucide-react"

import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./empty"
import { Skeleton } from "./skeleton"
import { cn } from "./utils"

export function useErrorToast(error: { message?: string } | undefined, fallbackMessage?: string) {
  useEffect(() => {
    if (!error) return
    const text = error.message || fallbackMessage
    if (text) toast.error(text)
  }, [error, fallbackMessage])
}

export interface LoadingCardsProps {
  count?: number
  className?: string
}

export function LoadingCards({ count = 3, className = "h-24" }: LoadingCardsProps) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={className} />
      ))}
    </div>
  )
}

export interface EmptyStateProps {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon ?? <CalendarOff />}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}

export interface ValidatingListProps {
  validating: boolean
  className?: string
  children?: ReactNode
}

export function ValidatingList({ validating, className, children }: ValidatingListProps) {
  return (
    <div className={cn("transition-opacity", validating && "opacity-50", className)}>
      {children}
    </div>
  )
}
