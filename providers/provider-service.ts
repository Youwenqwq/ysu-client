import { mutate } from "swr"
import { useAuthStore } from "@/lib/stores/auth"
import { getSchoolId, setSchoolConfig } from "@/lib/server-config"
import { DEFAULT_SCHOOL_ID, hasSchoolConfig } from "@/lib/school-configs"
import type { AcademicProvider } from "./types"
import { providerRegistry } from "./provider-registry"
import { stopNotify, syncNativeNotifications } from "@/lib/native/notify"

function resolveSupportedSchoolId(schoolId: string): string {
  if (hasSchoolConfig(schoolId) && providerRegistry.hasProvider(schoolId)) {
    return schoolId
  }
  return DEFAULT_SCHOOL_ID
}

let activeSchoolId: string | null = null
let activeProvider: AcademicProvider | null = null
let activeInitializePromise: Promise<AcademicProvider> | null = null
let authOperation = 0

/**
 * Providers are constructed lazily from plugin registrations, never at module
 * import time: the official provider plugin may start after this module loads.
 */
function ensureActiveProvider(schoolId: string): AcademicProvider {
  if (activeProvider && activeSchoolId === schoolId) return activeProvider
  activeProvider = providerRegistry.createProvider(schoolId)
  activeSchoolId = schoolId
  activeInitializePromise = null
  return activeProvider
}

// Replacing or disposing a plugin factory must invalidate the active instance.
providerRegistry.subscribe((changedSchoolId) => {
  if (activeSchoolId === changedSchoolId) {
    activeProvider = null
    activeSchoolId = null
    activeInitializePromise = null
  }
})

export function getActiveProvider(): AcademicProvider {
  const currentSchoolId = getSchoolId()
  const nextSchoolId = resolveSupportedSchoolId(currentSchoolId)
  if (nextSchoolId !== currentSchoolId) {
    setSchoolConfig(nextSchoolId)
  }
  return ensureActiveProvider(nextSchoolId)
}

export function setActiveProviderSchool(schoolId: string): AcademicProvider {
  const nextSchoolId = resolveSupportedSchoolId(schoolId)
  if (nextSchoolId !== getSchoolId()) {
    setSchoolConfig(nextSchoolId)
  }
  return ensureActiveProvider(nextSchoolId)
}

export async function initializeActiveProvider(): Promise<AcademicProvider> {
  const provider = getActiveProvider()
  if (!activeInitializePromise) {
    activeInitializePromise = provider.initialize().then(
      () => provider,
      (error) => {
        activeInitializePromise = null
        throw error
      }
    )
  }
  return activeInitializePromise
}

export async function resetActiveProvider(): Promise<void> {
  await getActiveProvider().reset()
  activeInitializePromise = null
}

export async function logoutActiveProvider(): Promise<void> {
  authOperation++
  stopNotify()
  await getActiveProvider().logout()
  activeInitializePromise = null
}

export async function reloginActiveProvider(): Promise<boolean> {
  const operation = authOperation
  const provider = getActiveProvider()
  const success = (await provider.relogin?.()) ?? false
  if (!success || operation !== authOperation || provider !== getActiveProvider()) return false

  useAuthStore.getState().setSessionExpired(false)
  await syncNativeNotifications(true, true).catch((error) => {
    console.warn("Failed to restore native notifications after relogin", error)
  })
  if (operation !== authOperation || provider !== getActiveProvider()) return false
  void mutate((key) => Array.isArray(key) && key[0] === "provider").catch(() => {})
  return true
}
