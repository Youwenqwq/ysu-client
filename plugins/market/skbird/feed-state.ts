import type { SkbirdThread } from "./types"

export const SKBIRD_FEED_STATE_KEY = "skbird-feed-state"

export type SkbirdFeedTab = "hot" | "latest" | "top" | "reward"

export interface SkbirdFeedSnapshot {
  version: 1
  tab: SkbirdFeedTab
  wd: string
  submittedWd: string
  cateId: string
  range: string
  threads: SkbirdThread[]
  hasMore: boolean
  cursor: string
  searchPage: number
  searchOpen: boolean
  scrollY: number
  mainScrollTop: number
}

type StorageLike = Pick<Storage, "getItem" | "setItem">

function isFeedTab(value: unknown): value is SkbirdFeedTab {
  return value === "hot" || value === "latest" || value === "top" || value === "reward"
}
function isThread(value: unknown): value is SkbirdThread {
  if (value === null || typeof value !== "object") return false
  const thread = value as Partial<SkbirdThread>
  return typeof thread.threadId === "string" && Array.isArray(thread.imgPaths)
}

function isSnapshot(value: unknown): value is SkbirdFeedSnapshot {
  if (value === null || typeof value !== "object") return false
  const snapshot = value as Partial<SkbirdFeedSnapshot>
  return (
    snapshot.version === 1 &&
    isFeedTab(snapshot.tab) &&
    typeof snapshot.wd === "string" &&
    typeof snapshot.submittedWd === "string" &&
    typeof snapshot.cateId === "string" &&
    typeof snapshot.range === "string" &&
    Array.isArray(snapshot.threads) &&
    snapshot.threads.every(isThread) &&
    typeof snapshot.hasMore === "boolean" &&
    typeof snapshot.cursor === "string" &&
    typeof snapshot.searchPage === "number" &&
    Number.isFinite(snapshot.searchPage) &&
    typeof snapshot.searchOpen === "boolean" &&
    typeof snapshot.scrollY === "number" &&
    Number.isFinite(snapshot.scrollY) &&
    typeof snapshot.mainScrollTop === "number" &&
    Number.isFinite(snapshot.mainScrollTop)
  )
}

export function readSkbirdFeedSnapshot(storage?: StorageLike): SkbirdFeedSnapshot | null {
  const target = storage ?? (typeof window === "undefined" ? undefined : window.sessionStorage)
  if (!target) return null

  try {
    const raw = target.getItem(SKBIRD_FEED_STATE_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return isSnapshot(value) ? value : null
  } catch {
    return null
  }
}

export function writeSkbirdFeedSnapshot(snapshot: SkbirdFeedSnapshot, storage?: StorageLike): void {
  const target = storage ?? (typeof window === "undefined" ? undefined : window.sessionStorage)
  if (!target) return

  try {
    target.setItem(SKBIRD_FEED_STATE_KEY, JSON.stringify(snapshot))
  } catch {
    // sessionStorage unavailable or quota exceeded
  }
}
