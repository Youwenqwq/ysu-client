/**
 * Secure storage backed by Android Keystore / iOS Keychain.
 *
 * Wraps @aparajita/capacitor-secure-storage for:
 * - Zustand persist adapter (credential, session, username)
 * - Remember-me credentials (username + password)
 * - CASTGC cookie persistence
 */
import { SecureStorage } from "@aparajita/capacitor-secure-storage"
import { toast } from "sonner"
import { STORAGE_KEYS } from "./keys"

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
      const value = await SecureStorage.getItem(name)
      if (value !== null && value !== undefined) return value
      const legacyKey = legacySecureStorageKey(name)
      if (!legacyKey) return null
      const legacyValue = await SecureStorage.getItem(legacyKey)
      if (legacyValue !== null && legacyValue !== undefined) {
        await SecureStorage.setItem(name, legacyValue)
        await SecureStorage.removeItem(legacyKey).catch(() => {})
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
      await SecureStorage.setItem(name, value)
      const legacyKey = legacySecureStorageKey(name)
      if (legacyKey) await SecureStorage.removeItem(legacyKey).catch(() => {})
    } catch (e) {
      toast.error(`凭据保存失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
  removeItem: async (name: string): Promise<void> => {
    if (!isBrowser) return
    try {
      await SecureStorage.removeItem(name)
      const legacyKey = legacySecureStorageKey(name)
      if (legacyKey) await SecureStorage.removeItem(legacyKey).catch(() => {})
    } catch (e) {
      toast.error(`安全存储删除失败: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
}

// ─── Remember-me helpers ────────────────────────────────────────────────── //

export async function saveRememberedCredentials(username: string, password: string): Promise<void> {
  if (!isBrowser) return
  try {
    await SecureStorage.set(REMEMBER_KEY, { username, password })
    await SecureStorage.remove(LEGACY_REMEMBER_KEY).catch(() => {})
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
    let data = await SecureStorage.get(REMEMBER_KEY)
    if (!data) {
      data = await SecureStorage.get(LEGACY_REMEMBER_KEY)
      if (data) {
        await SecureStorage.set(REMEMBER_KEY, data)
        await SecureStorage.remove(LEGACY_REMEMBER_KEY).catch(() => {})
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
    await SecureStorage.remove(REMEMBER_KEY)
    await SecureStorage.remove(LEGACY_REMEMBER_KEY).catch(() => {})
  } catch {
    // ignore
  }
}

// ─── Auth token helpers ─────────────────────────────────────────────────── //

export async function saveAuthToken(value: string): Promise<void> {
  if (!isBrowser) return
  try {
    await SecureStorage.set(AUTH_TOKEN_KEY, value)
    await SecureStorage.remove(LEGACY_AUTH_TOKEN_KEY).catch(() => {})
  } catch (e) {
    toast.error(`登录凭据保存失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function loadAuthToken(): Promise<string | null> {
  if (!isBrowser) return null
  try {
    let val = await SecureStorage.get(AUTH_TOKEN_KEY)
    if (typeof val === "string" && val) return val
    val = await SecureStorage.get(LEGACY_AUTH_TOKEN_KEY)
    if (typeof val === "string" && val) {
      await SecureStorage.set(AUTH_TOKEN_KEY, val)
      await SecureStorage.remove(LEGACY_AUTH_TOKEN_KEY).catch(() => {})
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
    await SecureStorage.remove(AUTH_TOKEN_KEY)
    await SecureStorage.remove(LEGACY_AUTH_TOKEN_KEY).catch(() => {})
  } catch {
    // ignore
  }
}

// Backward-compatible YSU CAS token aliases.
export const saveCASTGC = saveAuthToken
export const loadCASTGC = loadAuthToken
export const removeCASTGC = removeAuthToken
