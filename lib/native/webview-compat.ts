import { registerPlugin } from "@capacitor/core"

export interface WebViewCompatPlugin {
  check(options?: { locale?: string }): Promise<void>
  initSafeArea(): Promise<void>
}

const WebViewCompat = registerPlugin<WebViewCompatPlugin>("WebViewCompat", {
  web: async () => {
    return {
      async check() {
        // No-op on web
      },
      async initSafeArea() {
        // No-op on web
      },
    }
  },
})

export async function initSafeArea(): Promise<void> {
  try {
    await WebViewCompat.initSafeArea()
  } catch {
    // Plugin call is best-effort; fail silently
  }
}

export async function checkWebViewCompat(locale?: string): Promise<void> {
  try {
    await WebViewCompat.check({ locale })
  } catch {
    // Plugin check is best-effort; fail silently
  }
}
