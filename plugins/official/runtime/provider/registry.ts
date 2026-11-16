import type { Context } from "@cordisjs/core"
import type {
  ManagedProvider,
  PluginProviderService,
  ProviderFactory,
} from "@orahako/plugin-sdk"
import {
  PLUGIN_SERVICE_SCOPE,
  type AcademicPluginContext,
  type PluginContext,
  type ScopedPluginService,
  trackPluginRegistration,
} from "@orahako/plugin-sdk"
import { ProviderError, ProviderErrorCode } from "@orahako/plugin-sdk/provider-errors"

export type { ProviderFactory, PluginProviderService }

interface ProviderEntry {
  readonly id: string
  readonly factory: ProviderFactory
  /** The contributing plugin's scope, invoked when the host builds an instance. */
  readonly context: AcademicPluginContext
}

/**
 * Host-side registry for provider plugins.
 *
 * The registry maps a school id to the factory and plugin scope that
 * contributed it. The host only registers, looks up and creates providers; all
 * school-specific configuration lives inside the contributing plugin.
 *
 * A provider-only slot may be replaced; its disposer is bound to that exact
 * entry, so stale cleanup from a previous plugin cannot remove a newer factory.
 */
export class ProviderPluginRegistry implements ScopedPluginService<PluginProviderService> {
  private readonly entries = new Map<string, ProviderEntry>()
  private readonly listeners = new Set<(schoolId: string) => void>();

  [PLUGIN_SERVICE_SCOPE](ctx: Context): PluginProviderService {
    const pluginContext = ctx as unknown as AcademicPluginContext
    return {
      registerProvider: (schoolId, factory) =>
        trackPluginRegistration(ctx, () => this.addProvider(schoolId, factory, pluginContext)),
      hasProvider: (schoolId) => this.hasProvider(schoolId),
    }
  }

  hasProvider = (schoolId: string): boolean => this.entries.has(schoolId)

  /** Creates a provider with the contributing plugin's context. */
  createProvider = (schoolId: string): ManagedProvider => {
    const entry = this.entries.get(schoolId)
    if (!entry) {
      throw new ProviderError(
        ProviderErrorCode.FEATURE_NOT_SUPPORTED,
        `Unsupported school provider: ${schoolId}`,
        undefined,
        501
      )
    }
    return entry.factory(entry.context as unknown as PluginContext)
  }

  subscribe = (listener: (schoolId: string) => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private addProvider(
    schoolId: string,
    factory: ProviderFactory,
    context: AcademicPluginContext
  ): () => void {
    if (!schoolId) throw new Error("Provider registration requires a school id")
    const entry: ProviderEntry = { id: schoolId, factory, context }
    this.entries.set(schoolId, entry)
    this.publish(schoolId)
    return () => {
      // A disposer may only revoke the registration it created.
      if (this.entries.get(schoolId) !== entry) return
      this.entries.delete(schoolId)
      this.publish(schoolId)
    }
  }

  private publish(schoolId: string): void {
    for (const listener of this.listeners) listener(schoolId)
  }
}
