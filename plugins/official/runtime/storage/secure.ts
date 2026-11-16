/**
 * Secure storage backed by Android Keystore / iOS Keychain.
 *
 * Wraps @aparajita/capacitor-secure-storage as a generic async key/value
 * adapter. Session and plugin services own their own keys and schemas.
 */
import { SecureStorage } from "@aparajita/capacitor-secure-storage"
import { toast } from "sonner"

// ─── SSR guard ──────────────────────────────────────────────────────────── //
// SecureStorage's web implementation accesses `localStorage` which doesn't
// exist during Next.js SSG. Skip all calls on the server.
const isBrowser = typeof window !== "undefined"

// ─── Zustand StateStorage adapter ───────────────────────────────────────── //

export const secureStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (!isBrowser) return null
    try {
      const value = await SecureStorage.getItem(name)
      return value ?? null
    } catch (e) {
      toast.error(`安全存储读取失败: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (!isBrowser) return
    try {
      await SecureStorage.setItem(name, value)
    } catch (e) {
      toast.error(`凭据保存失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
  removeItem: async (name: string): Promise<void> => {
    if (!isBrowser) return
    try {
      await SecureStorage.removeItem(name)
    } catch (e) {
      toast.error(`安全存储删除失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
}


