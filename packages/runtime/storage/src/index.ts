import {
  definePlugin,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  type Context,
  type PluginKeyValueStorage,
  type PluginManifest,
  type PluginStorageService,
  type ScopedPluginService,
} from "@orahako/sdk"
import {
  createLocalStorageAdapter,
  createSecureStorageAdapter,
  type SecureStorageAdapterOptions,
  type WebStorageLike,
} from "./adapters"

export {
  createLocalStorageAdapter,
  createSecureStorageAdapter,
  type SecureStorageAdapterOptions,
  type WebStorageLike,
}

export interface ScopedStorageAdapters {
  readonly local?: PluginKeyValueStorage
  readonly secure?: PluginKeyValueStorage
}

export function formatPluginStorageKey(pluginId: string, key: string): string {
  const normalizedId = pluginId.trim()
  if (!normalizedId) {
    throw new Error("Plugin ID must be a non-empty string for scoped storage")
  }
  return `orahako-plugin:${normalizedId}:${key}`
}

function createNamespacedKeyValueStorage(
  pluginId: string,
  backend: PluginKeyValueStorage
): PluginKeyValueStorage {
  const normalizedId = pluginId.trim()
  if (!normalizedId) {
    throw new Error("Plugin ID must be a non-empty string for scoped storage")
  }
  return {
    getItem: (key: string) => backend.getItem(formatPluginStorageKey(normalizedId, key)),
    setItem: (key: string, value: string) =>
      backend.setItem(formatPluginStorageKey(normalizedId, key), value),
    removeItem: (key: string) => backend.removeItem(formatPluginStorageKey(normalizedId, key)),
  }
}

/**
 * Constructs a `PluginStorageService` strictly namespaced under
 * `orahako-plugin:<pluginId>:<key>` for both `local` and `secure` backends.
 */
export function createScopedStorage(
  pluginId: string,
  adapters?: ScopedStorageAdapters
): PluginStorageService {
  const localBackend = adapters?.local ?? createLocalStorageAdapter()
  const secureBackend = adapters?.secure ?? createSecureStorageAdapter()
  return {
    local: createNamespacedKeyValueStorage(pluginId, localBackend),
    secure: createNamespacedKeyValueStorage(pluginId, secureBackend),
  }
}

export class NamespacedStorageService implements ScopedPluginService<PluginStorageService> {
  private readonly localBackend: PluginKeyValueStorage
  private readonly secureBackend: PluginKeyValueStorage

  constructor(adapters?: ScopedStorageAdapters) {
    this.localBackend = adapters?.local ?? createLocalStorageAdapter()
    this.secureBackend = adapters?.secure ?? createSecureStorageAdapter()
  }

  [PLUGIN_SERVICE_SCOPE](_ctx: Context, manifest: PluginManifest): PluginStorageService {
    return createScopedStorage(manifest.id, {
      local: this.localBackend,
      secure: this.secureBackend,
    })
  }
}

export const storageRuntimePlugin = definePlugin({
  manifest: {
    id: "orahako.runtime.storage",
    name: "Namespaced storage",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    provides: ["storage"],
  },
  apply(ctx) {
    ctx.set("storage", new NamespacedStorageService())
  },
})
