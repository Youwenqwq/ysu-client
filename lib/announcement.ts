export type AnnouncementLevel = "info" | "warning" | "critical"

export interface AnnouncementInfo {
  id: string
  title: string
  content: string
  level: AnnouncementLevel
  publishedAt: string
  expireAt: string
}

import { getLocalStorageItemWithFallback, STORAGE_KEYS } from "./storage/keys"

const ANNOUNCEMENT_URL = "https://ysu.welain.com/updates/announcement.json"
const LAST_DISMISSED_KEY = STORAGE_KEYS.lastDismissedAnnouncementId
const LEGACY_LAST_DISMISSED_KEY = STORAGE_KEYS.legacyLastDismissedAnnouncementId

function isExpired(expireAt: string): boolean {
  return new Date(expireAt).getTime() <= Date.now()
}

function isFuture(publishedAt: string): boolean {
  return new Date(publishedAt).getTime() > Date.now()
}

export async function checkAnnouncement(): Promise<AnnouncementInfo | null> {
  try {
    const res = await fetch(ANNOUNCEMENT_URL)
    if (!res.ok) return null
    const data = (await res.json()) as Partial<AnnouncementInfo>
    if (!data.id || !data.title) return null
    if (data.publishedAt && isFuture(data.publishedAt)) return null
    if (data.expireAt && isExpired(data.expireAt)) return null
    const lastDismissed = getLocalStorageItemWithFallback(
      LAST_DISMISSED_KEY,
      LEGACY_LAST_DISMISSED_KEY
    )
    if (lastDismissed === data.id) return null
    return data as AnnouncementInfo
  } catch {
    return null
  }
}

export function dismissAnnouncement(id: string): void {
  localStorage.setItem(LAST_DISMISSED_KEY, id)
  localStorage.removeItem(LEGACY_LAST_DISMISSED_KEY)
}
