import { getSlice, type SchoolProvider, type SessionSnapshot } from "@orahako/academic-sdk"
import type { ObservableSource } from "@orahako/sdk"
import type { EpaySettingsStoreInstance } from "./store"

/** Minimum interval between automatic unpaid-fee checks per account: 3 hours. */
export const MIN_EPAY_CHECK_INTERVAL_MS = 3 * 3600 * 1000

const IN_FLIGHT_BY_STORE = new WeakMap<EpaySettingsStoreInstance, Map<string, string | null>>()

export interface EpayCheckResult {
  readonly hasUnpaid: boolean
  readonly count: number
  readonly total: number
}

export interface EpayProviderLookup {
  getSnapshot?: () => { readonly provider: SchoolProvider | null }
  getActive?: () => SchoolProvider
}

export interface EpaySessionLookup {
  getSnapshot(): Pick<SessionSnapshot, "username" | "credential"> & {
    readonly isAuthenticated?: boolean
  }
}

/** Session fields whose readiness or change should schedule an automatic unpaid-fee check. */
export interface EpaySessionTriggerState {
  readonly hasHydrated: boolean
  readonly isAuthenticated: boolean
  readonly username: string | null
  readonly credential: string | null
}

/**
 * Returns true when a session notification changes hydration, authentication, username or
 * credential. Unchanged notifications are ignored; the cooldown and in-flight guards inside
 * `runEpayAutoCheck` remain the deduplication source for repeated requests.
 */
export function shouldTriggerEpayCheckOnSession(
  previous: EpaySessionTriggerState,
  current: EpaySessionTriggerState
): boolean {
  return (
    previous.hasHydrated !== current.hasHydrated ||
    previous.isAuthenticated !== current.isAuthenticated ||
    previous.username !== current.username ||
    previous.credential !== current.credential
  )
}

export interface EpayAutoCheckOptions {
  readonly session: EpaySessionLookup
  readonly provider: EpayProviderLookup
  readonly store: EpaySettingsStoreInstance
  readonly inFlight?: Map<string, string | null>
  readonly minIntervalMs?: number
  readonly now?: () => number
  readonly isDisposed?: () => boolean
}

function getInFlightMap(
  store: EpaySettingsStoreInstance,
  explicit?: Map<string, string | null>
): Map<string, string | null> {
  if (explicit) return explicit
  const existing = IN_FLIGHT_BY_STORE.get(store)
  if (existing) return existing
  const created = new Map<string, string | null>()
  IN_FLIGHT_BY_STORE.set(store, created)
  return created
}

function resolveActiveProvider(provider: EpayProviderLookup): SchoolProvider | null {
  if (typeof provider.getSnapshot === "function") {
    return provider.getSnapshot().provider
  }
  if (typeof provider.getActive === "function") {
    try {
      return provider.getActive()
    } catch {
      return null
    }
  }
  return null
}

async function ensureStoreHydrated(hydrated: ObservableSource<boolean>): Promise<void> {
  if (hydrated.getSnapshot()) return
  await new Promise<void>((resolve) => {
    const unsubscribe = hydrated.subscribe(() => {
      if (hydrated.getSnapshot()) {
        unsubscribe()
        resolve()
      }
    })
    if (hydrated.getSnapshot()) {
      unsubscribe()
      resolve()
    }
  })
}

/**
 * Triggers a rate-limited automatic unpaid-fee check against the active school provider's
 * `epay` slice, reading and persisting per-account cooldown timestamps on the plugin's
 * scoped `epaySettingsStore`.
 */
export async function runEpayAutoCheck(
  options: EpayAutoCheckOptions
): Promise<EpayCheckResult | null> {
  const {
    session,
    provider,
    store,
    minIntervalMs = MIN_EPAY_CHECK_INTERVAL_MS,
    now = Date.now,
    isDisposed,
  } = options

  if (!store.hydrated.getSnapshot()) {
    await ensureStoreHydrated(store.hydrated)
  }
  if (isDisposed?.()) return null

  const settings = store.source.getSnapshot()
  if (!settings.notifyEnabled) return null

  const initialAuth = session.getSnapshot()
  if (initialAuth.isAuthenticated === false) return null
  const { username, credential } = initialAuth
  if (!username || !credential) return null

  const checkingAccounts = getInFlightMap(store, options.inFlight)
  if (checkingAccounts.get(username) === credential) return null

  const account = settings.accountSettings[username]
  const lastCheckedAt = account?.lastCheckedAt ?? 0
  if (now() - lastCheckedAt < minIntervalMs) return null

  const activeProvider = resolveActiveProvider(provider)
  const epaySlice = getSlice(activeProvider, "epay")
  if (!epaySlice) return null

  checkingAccounts.set(username, credential)

  try {
    const status = await epaySlice.fetchPayments()
    if (isDisposed?.()) return null

    const currentAuth = session.getSnapshot()
    if (
      currentAuth.isAuthenticated === false ||
      currentAuth.username !== username ||
      currentAuth.credential !== credential ||
      !store.source.getSnapshot().notifyEnabled
    ) {
      return null
    }

    const unpaid = status.unpaid
    store.actions.setLastCheckedAt(username, now())
    return {
      hasUnpaid: unpaid.length > 0,
      count: unpaid.length,
      total: unpaid.reduce((sum, record) => sum + Math.round(record.amountN * 100), 0) / 100,
    }
  } catch {
    return null
  } finally {
    if (checkingAccounts.get(username) === credential) {
      checkingAccounts.delete(username)
    }
  }
}
