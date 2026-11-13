import type {
  PerlicaCoords,
  PerlicaGeoArea,
  PerlicaMachine,
  PerlicaOrder,
  PerlicaRideCard,
  PerlicaRideLog,
  PerlicaUserInfo,
} from "./types"

const LEGACY_SNAPSHOT_KEY = "perlica-ui-snapshot-v2"
const SNAPSHOT_TTL = 12 * 60 * 60 * 1000

function snapshotKey(accountId: string) {
  return `${LEGACY_SNAPSHOT_KEY}:${encodeURIComponent(accountId)}`
}

export interface PerlicaSnapshot {
  savedAt: number
  center: PerlicaCoords | null
  machines: PerlicaMachine[]
  machinesAt: number
  user: PerlicaUserInfo | null
  userAt: number
  order: PerlicaOrder | null
  orderAt: number
  logs: PerlicaRideLog[]
  logsAt: number
  cards: PerlicaRideCard[]
  cardsAt: number
  geoArea: PerlicaGeoArea | null
  geoAreaAt: number
}

const EMPTY_SNAPSHOT: PerlicaSnapshot = {
  savedAt: 0,
  center: null,
  machines: [],
  machinesAt: 0,
  user: null,
  userAt: 0,
  order: null,
  orderAt: 0,
  logs: [],
  logsAt: 0,
  cards: [],
  cardsAt: 0,
  geoArea: null,
  geoAreaAt: 0,
}

export function readPerlicaSnapshot(accountId: string): PerlicaSnapshot | null {
  if (typeof window === "undefined") return null
  const key = snapshotKey(accountId)
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<PerlicaSnapshot>
    if (typeof value.savedAt !== "number" || Date.now() - value.savedAt > SNAPSHOT_TTL) {
      window.localStorage.removeItem(key)
      return null
    }
    return {
      ...EMPTY_SNAPSHOT,
      ...value,
      machines: Array.isArray(value.machines) ? value.machines : [],
      logs: Array.isArray(value.logs) ? value.logs : [],
      cards: Array.isArray(value.cards) ? value.cards : [],
    }
  } catch {
    return null
  }
}

export function writePerlicaSnapshot(accountId: string, patch: Partial<PerlicaSnapshot>) {
  if (typeof window === "undefined") return
  try {
    const previous = readPerlicaSnapshot(accountId) ?? EMPTY_SNAPSHOT
    const next = { ...previous, ...patch, savedAt: Date.now() }
    const serialized = JSON.stringify(next, (key, value: unknown) => {
      if (/token|authorization|cookie|credential|secret|password|session/i.test(key)) {
        return undefined
      }
      if (typeof value === "string") return value.replace(/TOKEN:[^\s&?#]+/gi, "[redacted]")
      return value
    })
    window.localStorage.setItem(snapshotKey(accountId), serialized ?? "{}")
  } catch {
    // Storage denial must not block live requests.
  }
}

export function clearPerlicaSnapshot(accountId?: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(LEGACY_SNAPSHOT_KEY)
    if (accountId !== undefined) window.localStorage.removeItem(snapshotKey(accountId))
  } catch {
    // Storage denial needs no user-facing error.
  }
}
