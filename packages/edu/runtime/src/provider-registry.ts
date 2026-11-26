import {
  ProviderError,
  ProviderErrorCode,
  type ProviderFactory,
  type ProviderRegistryService,
  type SchoolProvider,
} from "@orahako/academic-sdk"
import {
  Context,
  definePlugin,
  PLUGIN_API_VERSION,
  PLUGIN_SERVICE_SCOPE,
  trackPluginRegistration,
  type PluginManifest,
  type ScopedPluginService,
} from "@orahako/sdk"

interface ProviderEntry {
  readonly id: string
  readonly factory: ProviderFactory
  readonly context: Context
}

export class ProviderPluginRegistry
  implements ProviderRegistryService, ScopedPluginService<ProviderRegistryService>
{
  private readonly entries = new Map<string, ProviderEntry>()
  private readonly listeners = new Set<(schoolId: string) => void>()
  private readonly fallbackContext: Context

  constructor(fallbackContext: Context = new Context()) {
    this.fallbackContext = fallbackContext
  }

  [PLUGIN_SERVICE_SCOPE](ctx: Context, _manifest: PluginManifest): ProviderRegistryService {
    return {
      registerProvider: (schoolId, factory) =>
        trackPluginRegistration(ctx, () => this.addProvider(schoolId, factory, ctx)),
      hasProvider: this.hasProvider,
      listProviders: this.listProviders,
      createProvider: this.createProvider,
      subscribe: this.subscribe,
    }
  }

  registerProvider = (schoolId: string, factory: ProviderFactory): (() => void) => {
    return this.addProvider(schoolId, factory, this.fallbackContext)
  }

  hasProvider = (schoolId: string): boolean => {
    return this.entries.has(schoolId)
  }

  listProviders = (): readonly string[] => {
    return Array.from(this.entries.keys())
  }

  createProvider = (schoolId: string): SchoolProvider => {
    const entry = this.entries.get(schoolId)
    if (!entry) {
      throw new ProviderError(
        ProviderErrorCode.FEATURE_NOT_SUPPORTED,
        `Unsupported school provider: ${schoolId}`,
        undefined,
        501
      )
    }
    return entry.factory(entry.context)
  }

  subscribe = (listener: (schoolId: string) => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private addProvider(schoolId: string, factory: ProviderFactory, context: Context): () => void {
    if (!schoolId || !schoolId.trim()) {
      throw new Error("Provider registration requires a non-empty school id")
    }
    const entry: ProviderEntry = { id: schoolId, factory, context }
    this.entries.set(schoolId, entry)
    this.publish(schoolId)
    return () => {
      if (this.entries.get(schoolId) !== entry) return
      this.entries.delete(schoolId)
      this.publish(schoolId)
    }
  }

  private publish(schoolId: string): void {
    for (const listener of Array.from(this.listeners)) {
      listener(schoolId)
    }
  }
}

export const providerRegistryRuntimePlugin = definePlugin({
  manifest: {
    id: "orahako.runtime.provider-registry",
    name: "Provider contribution registry",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description: "School provider factory registry scoped to contributing plugins.",
    provides: ["providers"],
  },
  apply(ctx) {
    ctx.set("providers", new ProviderPluginRegistry())
  },
})
