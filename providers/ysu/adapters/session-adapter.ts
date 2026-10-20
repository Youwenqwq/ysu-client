import {
  initializeSession as initializeProviderSession,
  resetSession as resetProviderSession,
} from "../session"
import { warmupWEU } from "../protocol/jwxt"
import { ensureMobileAuthorized } from "../protocol/jwmobile"
import { isFeatureAvailable } from "@/lib/server-config"
import { isHarmony } from "@/lib/native/harmony"

export async function initializeSession(): Promise<void> {
  await initializeProviderSession()
}

export async function warmupSession(): Promise<void> {
  await warmupWEU()
  if (!isHarmony() && isFeatureAvailable("hasMobile")) {
    ensureMobileAuthorized(true).catch(() => {})
  }
}

export function resetSession(): Promise<void> {
  return resetProviderSession()
}
