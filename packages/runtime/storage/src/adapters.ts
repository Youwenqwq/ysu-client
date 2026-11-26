import { SecureStorage } from "@aparajita/capacitor-secure-storage"
import { isCapacitor, type PluginKeyValueStorage } from "@orahako/sdk"

export interface WebStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function defaultResolveWebStorage(): WebStorageLike | undefined {
  try {
    return typeof globalThis.localStorage !== "undefined" ? globalThis.localStorage : undefined
  } catch {
    return undefined
  }
}

/**
 * Creates a `PluginKeyValueStorage` backed by Web `localStorage` with an
 * instance-scoped in-memory fallback when DOM storage is absent or throws
 * quota / security errors.
 */
export function createLocalStorageAdapter(
  resolveWebStorage: () => WebStorageLike | undefined = defaultResolveWebStorage
): PluginKeyValueStorage {
  const fallback = new Map<string, string>()

  return {
    async getItem(key: string): Promise<string | null> {
      if (fallback.has(key)) {
        return fallback.get(key) ?? null
      }
      const store = resolveWebStorage()
      if (!store) return null
      try {
        return store.getItem(key)
      } catch {
        return null
      }
    },

    async setItem(key: string, value: string): Promise<void> {
      const store = resolveWebStorage()
      if (!store) {
        fallback.set(key, value)
        return
      }
      try {
        store.setItem(key, value)
        fallback.delete(key)
      } catch {
        fallback.set(key, value)
      }
    },

    async removeItem(key: string): Promise<void> {
      fallback.delete(key)
      const store = resolveWebStorage()
      if (!store) return
      try {
        store.removeItem(key)
      } catch {
        // Ignore SecurityError / unavailable DOM storage during removal.
      }
    },
  }
}

export interface SecureStorageAdapterOptions {
  readonly isNative?: () => boolean
  readonly nativeBackend?: PluginKeyValueStorage
  readonly webFallback?: PluginKeyValueStorage
}

function createCapacitorSecureBackend(): PluginKeyValueStorage {
  return {
    async getItem(key: string): Promise<string | null> {
      const value = await SecureStorage.getItem(key)
      return value ?? null
    },
    async setItem(key: string, value: string): Promise<void> {
      await SecureStorage.setItem(key, value)
    },
    async removeItem(key: string): Promise<void> {
      await SecureStorage.removeItem(key)
    },
  }
}

/**
 * Creates a `PluginKeyValueStorage` backed by `@aparajita/capacitor-secure-storage`
 * on Capacitor native platforms and a safe `localStorage` fallback on Web.
 */
export function createSecureStorageAdapter(
  options: SecureStorageAdapterOptions = {}
): PluginKeyValueStorage {
  const checkNative = options.isNative ?? isCapacitor
  const nativeBackend = options.nativeBackend ?? createCapacitorSecureBackend()
  const webFallback = options.webFallback ?? createLocalStorageAdapter()

  return {
    getItem(key: string): Promise<string | null> {
      return checkNative() ? nativeBackend.getItem(key) : webFallback.getItem(key)
    },
    setItem(key: string, value: string): Promise<void> {
      return checkNative() ? nativeBackend.setItem(key, value) : webFallback.setItem(key, value)
    },
    removeItem(key: string): Promise<void> {
      return checkNative() ? nativeBackend.removeItem(key) : webFallback.removeItem(key)
    },
  }
}
