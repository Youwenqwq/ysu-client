import type { PluginManifest } from "./manifest"
import type { MarketplaceIndex } from "./market"

export interface PluginManagerState {
  readonly manifest: PluginManifest
  readonly status: string
}

export interface PluginManagerService {
  enable(id: string): Promise<void>
  /** Policy-only stop; unlike disable(), this never changes user preferences. */
  suspend(id: string): void
  disable(id: string): void
  isProtected(id: string): boolean
  /** True when the user explicitly disabled the plugin, independent of runtime status. */
  isUserDisabled(id: string): boolean
  getSnapshot(): readonly PluginManagerState[]
  subscribe(listener: () => void): () => void
}

/** Loading primitives owned by the kernel, not a default application runtime. */
export interface PluginPackageRuntime {
  installFromUrl(
    url: string,
    sha256: string,
    expected: { id: string; version: string }
  ): Promise<PluginManifest>
  applyPluginBundle(pluginIds: readonly string[], index: MarketplaceIndex): Promise<PluginManifest>
  assetUrl(pluginId: string, path: string): string | undefined
  nativeCapabilities(): readonly string[]
}
