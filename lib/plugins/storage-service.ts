import type { PluginKeyValueStorage, PluginStorageService } from "@orahako/plugin-sdk"
import { localStorageAdapter } from "@/lib/storage/local"
import { secureStorage } from "@/lib/storage/secure"
import type { PluginServiceFactory } from "./runtime"

function namespacedStorage(
  pluginId: string,
  storage: typeof localStorageAdapter,
  secure: boolean
): PluginKeyValueStorage {
  const prefix = `orahako-plugin:${pluginId}:`
  return {
    getItem: async (key) => {
      if (secure) return storage.getItem(`${prefix}${key}`)
      return localStorageAdapter.getItem(`${prefix}${key}`)
    },
    setItem: async (key, value) => {
      await storage.setItem(`${prefix}${key}`, value)
    },
    removeItem: async (key) => {
      await storage.removeItem(`${prefix}${key}`)
    },
  }
}

export const createPluginStorageService: PluginServiceFactory = (ctx, manifest) => {
  const storage: PluginStorageService = {
    local: namespacedStorage(manifest.id, localStorageAdapter, false),
    secure: namespacedStorage(manifest.id, secureStorage, true),
  }
  ctx.set("storage", storage)
}
