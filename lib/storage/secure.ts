/**
 * Native storage adapter: Keystore / Keychain on Capacitor, plaintext files on macOS.
 *
 * Provides platform storage for:
 * - Zustand persist adapter (credential, session, username)
 * - Remember-me credentials (username + password)
 * - CASTGC cookie persistence
 */
import { SecureStorage, type DataType } from "@aparajita/capacitor-secure-storage"
import { toast } from "sonner"
import { STORAGE_KEYS } from "./keys"
import { isMacOSApp, macSecureStorage } from "@/lib/native/macos"

// Mac builds fail closed if WK is unavailable: never fall back to the
// Capacitor web implementation, which would write credentials to localStorage.
const platformStorage = isMacOSApp ? {
  ...macSecureStorage,
  async get(name: string): Promise<DataType | null> {
    const value = await macSecureStorage.getItem(name)
    if (value === null) return null
    try {
      return JSON.parse(value)
    } catch {
      // Parse errors must not expose stored credentials.
      throw new Error("macOS secure storage contains invalid JSON")
    }
  },
  async set(name: string, value: DataType): Promise<void> {
    await macSecureStorage.setItem(name, JSON.stringify(value))
  },
  remove: macSecureStorage.removeItem,
} : SecureStorage

// ─── Key constants ──────────────────────────────────────────────────────── //

const AUTH_TOKEN_KEY = STORAGE_KEYS.secureAuthToken
const LEGACY_AUTH_TOKEN_KEY = STORAGE_KEYS.legacySecureAuthToken
const REMEMBER_KEY = STORAGE_KEYS.secureRememberedCredentials
const LEGACY_REMEMBER_KEY = STORAGE_KEYS.legacySecureRememberedCredentials

// ─── SSR guard ──────────────────────────────────────────────────────────── //
// SecureStorage's web implementation accesses `localStorage` which doesn't
// exist during Next.js SSG. Skip all calls on the server.
const isBrowser = typeof window !== "undefined"

// ─── Zustand StateStorage adapter ───────────────────────────────────────── //

function legacySecureStorageKey(name: string): string | null {
  if (name === STORAGE_KEYS.auth) return STORAGE_KEYS.legacyAuth
  return null
}

export const secureStorage = {
  getItem: async (name: string): Promise<string | null> => {
    if (!isBrowser) return null
    try {
      const value = await platformStorage.getItem(name)
      if (value !== null && value !== undefined) return value
      const legacyKey = legacySecureStorageKey(name)
      if (!legacyKey) return null
      const legacyValue = await platformStorage.getItem(legacyKey)
      if (legacyValue !== null && legacyValue !== undefined) {
        await platformStorage.setItem(name, legacyValue)
        await platformStorage.removeItem(legacyKey).catch(() => {})
      }
      return legacyValue ?? null
    } catch (e) {
      toast.error(`安全存储读取失败: ${e instanceof Error ? e.message : String(e)}`)
      return null
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (!isBrowser) return
    try {
      await platformStorage.setItem(name, value)
      const legacyKey = legacySecureStorageKey(name)
      if (legacyKey) await platformStorage.removeItem(legacyKey).catch(() => {})
    } catch (e) {
      toast.error(`凭据保存失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
  removeItem: async (name: string): Promise<void> => {
    if (!isBrowser) return
    try {
      await platformStorage.removeItem(name)
      const legacyKey = legacySecureStorageKey(name)
      if (legacyKey) await platformStorage.removeItem(legacyKey).catch(() => {})
    } catch (e) {
      toast.error(`安全存储删除失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
}

// ─── Remember-me helpers ────────────────────────────────────────────────── //

export async function saveRememberedCredentials(username: string, password: string): Promise<void> {
  if (!isBrowser) return
  try {
    await platformStorage.set(REMEMBER_KEY, { username, password })
    await platformStorage.remove(LEGACY_REMEMBER_KEY).catch(() => {})
  } catch (e) {
    toast.error(`记住密码保存失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function loadRememberedCredentials(): Promise<{
  username: string
  password: string
} | null> {
  if (!isBrowser) return null
  try {
    let data = await platformStorage.get(REMEMBER_KEY)
    if (!data) {
      data = await platformStorage.get(LEGACY_REMEMBER_KEY)
      if (data) {
        await platformStorage.set(REMEMBER_KEY, data)
        await platformStorage.remove(LEGACY_REMEMBER_KEY).catch(() => {})
      }
    }
    if (data && typeof data === "object" && "username" in data && "password" in data) {
      return data as { username: string; password: string }
    }
    return null
  } catch (e) {
    toast.error(`读取记住密码失败: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

export async function clearRememberedCredentials(): Promise<void> {
  if (!isBrowser) return
  try {
    await platformStorage.remove(REMEMBER_KEY)
    await platformStorage.remove(LEGACY_REMEMBER_KEY).catch(() => {})
  } catch {
    // ignore
  }
}

// ─── Auth token helpers ─────────────────────────────────────────────────── //

export async function saveAuthToken(value: string): Promise<void> {
  if (!isBrowser) return
  try {
    await platformStorage.set(AUTH_TOKEN_KEY, value)
    await platformStorage.remove(LEGACY_AUTH_TOKEN_KEY).catch(() => {})
  } catch (e) {
    toast.error(`登录凭据保存失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function loadAuthToken(): Promise<string | null> {
  if (!isBrowser) return null
  try {
    let val = await platformStorage.get(AUTH_TOKEN_KEY)
    if (typeof val === "string" && val) return val
    val = await platformStorage.get(LEGACY_AUTH_TOKEN_KEY)
    if (typeof val === "string" && val) {
      await platformStorage.set(AUTH_TOKEN_KEY, val)
      await platformStorage.remove(LEGACY_AUTH_TOKEN_KEY).catch(() => {})
      return val
    }
    return null
  } catch (e) {
    toast.error(`读取登录凭据失败: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

export async function removeAuthToken(): Promise<void> {
  if (!isBrowser) return
  try {
    await platformStorage.remove(AUTH_TOKEN_KEY)
    await platformStorage.remove(LEGACY_AUTH_TOKEN_KEY).catch(() => {})
  } catch {
    // ignore
  }
}

// Backward-compatible YSU CAS token aliases.
export const saveCASTGC = saveAuthToken
export const loadCASTGC = loadAuthToken
export const removeCASTGC = removeAuthToken
