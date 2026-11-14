import {
  initializeSession as initializeProviderSession,
  resetSession as resetProviderSession,
} from "../session"
import { ensureMobileAuthorized } from "../protocol/jwmobile"
import { isFeatureAvailable } from "@orahako/plugin-sdk/host"

export async function initializeSession(): Promise<void> {
  await initializeProviderSession()
}

export async function warmupSession(): Promise<void> {
  if (isFeatureAvailable("hasMobile")) {
    ensureMobileAuthorized(true).catch(() => {})
  }
}

export function resetSession(): void {
  resetProviderSession()
}
