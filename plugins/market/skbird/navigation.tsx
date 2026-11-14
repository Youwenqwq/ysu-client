"use client"

import { useSkbirdUnreadCount } from "./store"

export function SkbirdMessagesBadge() {
  const unread = useSkbirdUnreadCount()
  if (unread <= 0) return null
  return (
    <span className="absolute -top-0.5 -right-1.5 size-2 rounded-full bg-destructive">
      <span className="sr-only">{unread}</span>
    </span>
  )
}
