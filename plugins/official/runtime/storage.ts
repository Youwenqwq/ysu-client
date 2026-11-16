import {
  definePlugin,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  type CompositionPlugin,
  type PluginKeyValueStorage,
  type PluginStorageService,
} from "@orahako/plugin-sdk"
import { localStorageAdapter } from "./storage/local"
import { secureStorage } from "./storage/secure"

class NamespacedStorageService {
  [PLUGIN_SERVICE_SCOPE](_ctx: unknown, manifest: { id: string }): PluginStorageService {
    return {
      local: namespaced(manifest.id, localStorageAdapter),
      secure: namespaced(manifest.id, secureStorage),
    }
  }
}

function namespaced(
  pluginId: string,
  storage: typeof localStorageAdapter
): PluginKeyValueStorage {
  const prefix = `orahako-plugin:${pluginId}:`
  return {
    getItem: async (key) => storage.getItem(`${prefix}${key}`),
    setItem: async (key, value) => {
      await storage.setItem(`${prefix}${key}`, value)
    },
    removeItem: async (key) => {
      await storage.removeItem(`${prefix}${key}`)
    },
  }
}

export const storageRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "orahako.runtime.storage",
    name: "Namespaced storage",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    provides: ["storage"],
  },
  definition: definePlugin((ctx) => {
    ctx.set("storage", new NamespacedStorageService())
  }),
}
