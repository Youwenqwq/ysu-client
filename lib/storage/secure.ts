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
const REMEMBER_KEY = STORAGE_KEYS.secureRememberedCredentials

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

// ─── Remember-me helpers ────────────────────────────────────────────────── //

export async function saveRememberedCredentials(username: string, password: string): Promise<void> {
  if (!isBrowser) return
  try {
    await SecureStorage.set(REMEMBER_KEY, { username, password })
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
    const data = await SecureStorage.get(REMEMBER_KEY)
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
  } catch {
    // ignore
  }
}

// ─── Auth token helpers ─────────────────────────────────────────────────── //

export async function saveAuthToken(value: string): Promise<void> {
  if (!isBrowser) return
  try {
    await SecureStorage.set(AUTH_TOKEN_KEY, value)
  } catch (e) {
    toast.error(`登录凭据保存失败: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function loadAuthToken(): Promise<string | null> {
  if (!isBrowser) return null
  try {
    const val = await SecureStorage.get(AUTH_TOKEN_KEY)
    return typeof val === "string" && val ? val : null
  } catch (e) {
    toast.error(`读取登录凭据失败: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}

export async function removeAuthToken(): Promise<void> {
  if (!isBrowser) return
  try {
    await SecureStorage.remove(AUTH_TOKEN_KEY)
  } catch {
    // ignore
  }
}

// Backward-compatible YSU CAS token aliases.
export const saveCASTGC = saveAuthToken
export const loadCASTGC = loadAuthToken
export const removeCASTGC = removeAuthToken
