import type { ManagedProvider } from "./provider-runtime"
import type { PluginContext } from "./runtime"

/** Creates a fresh provider instance using the contributing plugin's context. */
export type ProviderFactory = (ctx: PluginContext) => ManagedProvider

/**
 * Provider contribution capability exposed to plugins as `ctx.providers`.
 *
 * Registrations made through this service are revoked automatically when the
 * contributing plugin's Cordis scope is disposed. `registerProvider` returns a
 * disposer for manual early removal.
 */
export interface PluginProviderService {
  registerProvider(schoolId: string, factory: ProviderFactory): () => void
  hasProvider(schoolId: string): boolean
}

/** Read side of the provider registry owned by the host. */
export interface PluginProviderRegistryService extends PluginProviderService {
  createProvider(schoolId: string): ManagedProvider
  subscribe(listener: (schoolId: string) => void): () => void
}
