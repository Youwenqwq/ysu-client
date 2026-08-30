/** 缓存版本 —— 数据结构变更时递增，旧版本缓存将被自动丢弃。 */
const CACHE_VERSION = 1

/** 缓存键前缀 */
import { toast } from "sonner"
import { getText } from "../i18n/get-text"
import { STORAGE_KEYS } from "./keys"

const CACHE_PREFIX = STORAGE_KEYS.cachePrefix
const LEGACY_CACHE_PREFIX = STORAGE_KEYS.legacyCachePrefix

/** 默认 TTL: 24 小时 */
export const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24

/** 学生信息等基本不变的数据: 7 天 */
export const LONG_TTL_MS = 1000 * 60 * 60 * 24 * 7

let quotaErrorShown = false

interface CacheEntry<T> {
  v: number
  data: T
  ts: number
}

/**
 * 对凭据类长字符串做简单哈希，避免敏感数据明文出现在 localStorage 键名中，
 * 同时压缩键名长度节省配额。
 */
function hashPart(part: string): string {
  if (part.length < 80) return part
  let hash = 0
  for (let i = 0; i < part.length; i++) {
    const char = part.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return `h${Math.abs(hash).toString(36)}`
}

export function cacheKey(parts: string[]): string {
  return parts.map(hashPart).join("|")
}

/**
 * 读取缓存数据（即使已过期）。
 * 返回 `{ data, stale }` —— stale 为 true 表示数据已过期但可用作占位。
 */
export function cacheGetStale<T>(
  key: string,
  ttl = DEFAULT_TTL_MS
): { data: T; stale: boolean } | null {
  const currentKey = `${CACHE_PREFIX}${key}`
  const legacyKey = `${LEGACY_CACHE_PREFIX}${key}`
  try {
    const raw = localStorage.getItem(currentKey) ?? localStorage.getItem(legacyKey)
    if (!raw) return null
    const entry: CacheEntry<T> = JSON.parse(raw)
    if (entry.v !== CACHE_VERSION) {
      localStorage.removeItem(currentKey)
      localStorage.removeItem(legacyKey)
      return null
    }
    if (!localStorage.getItem(currentKey)) {
      localStorage.setItem(currentKey, raw)
      localStorage.removeItem(legacyKey)
    }
    const stale = Date.now() - entry.ts > ttl
    return { data: entry.data, stale }
  } catch {
    return null
  }
}

export function cacheSet<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { v: CACHE_VERSION, data, ts: Date.now() }
    localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(entry))
  } catch {
    if (!quotaErrorShown) {
      quotaErrorShown = true
      toast.error(getText("app.cacheStorageFull"), {
        description: getText("app.cacheStorageFullDesc"),
      })
    }
  }
}

// ─── 清理 ────────────────────────────────────────────────────────────────

export function clearAllCache(): void {
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && (key.startsWith(CACHE_PREFIX) || key.startsWith(LEGACY_CACHE_PREFIX))) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key)
    }
  } catch {
    // ignore
  }
}

/**
 * 清理因 credential 轮换产生的孤立缓存条目。
 * 每个 prefix family（如 "student"、"schedule"）只保留最新的那条，
 * 旧的 credential 对应的缓存会被删除。
 */
export function cleanStaleCacheVersions(): void {
  try {
    const groups = new Map<string, { key: string; ts: number }[]>()

    for (let i = 0; i < localStorage.length; i++) {
      const fullKey = localStorage.key(i)
      if (!fullKey || !fullKey.startsWith(CACHE_PREFIX)) continue
      const unprefixed = fullKey.slice(CACHE_PREFIX.length)
      // Provider query caches are already scoped by provider + username + feature.
      // Treating all keys that start with "provider" as one legacy cache family
      // would delete unrelated entries such as schedule/class-periods/current-week
      // during app startup, making cold-start cache reads appear ineffective.
      if (unprefixed.startsWith("provider|")) continue
      const prefix = unprefixed.split("|", 1)[0]
      if (!prefix) continue

      let ts = 0
      try {
        const raw = localStorage.getItem(fullKey)
        if (raw) {
          const entry = JSON.parse(raw)
          ts = entry.ts ?? 0
        }
      } catch {
        // 损坏的条目按 ts=0 处理，优先被淘汰
      }

      if (!groups.has(prefix)) groups.set(prefix, [])
      groups.get(prefix)!.push({ key: fullKey, ts })
    }

    for (const [, entries] of groups) {
      if (entries.length <= 1) continue
      // 按时间戳降序排列，保留第一个（最新的），删除其余
      entries.sort((a, b) => b.ts - a.ts)
      for (let i = 1; i < entries.length; i++) {
        localStorage.removeItem(entries[i].key)
      }
    }
  } catch {
    // ignore
  }
}
