import type { Context } from "@cordisjs/core"
import type { PluginManifest } from "@orahako/plugin-sdk"
import type {
  PluginProviderService,
  ProviderFactory,
  SchoolRegistration,
} from "@orahako/plugin-sdk/providers"
import { registerSchoolConfig, unregisterSchoolConfig } from "@/lib/server-config"
import { trackPluginRegistration } from "@/lib/plugins/track-registration"
import type { AcademicProvider } from "./types"
import { ProviderError, ProviderErrorCode } from "./errors"

export type { ProviderFactory, SchoolRegistration, PluginProviderService }

interface ProviderEntry {
  factory: ProviderFactory
}

/**
 * Host-side registry for provider plugins.
 *
 * Plugins contribute schools through a Cordis-scoped service; disposing the
 * plugin scope removes everything it registered. The host only ever reads from
 * this registry, so no provider implementation is imported or constructed until
 * a plugin registers it and the app asks for it.
 */
export class ProviderPluginRegistry {
  private readonly providers = new Map<string, ProviderEntry>()
  private readonly listeners = new Set<(schoolId: string) => void>()

  /** Cordis service factory: inject into PluginRuntime alongside the UI service. */
  createService = (ctx: Context, _manifest: PluginManifest): void => {
    const service: PluginProviderService = {
      registerProvider: (schoolId, factory) =>
        trackPluginRegistration(ctx, () => this.addProvider(schoolId, factory)),
      registerSchool: (registration) =>
        trackPluginRegistration(ctx, () => this.addSchool(registration)),
      hasProvider: (schoolId) => this.hasProvider(schoolId),
    }
    ctx.set("providers", service)
  }

  hasProvider(schoolId: string): boolean {
    return this.providers.has(schoolId)
  }

  getRegisteredProviderIds(): string[] {
    return Array.from(this.providers.keys())
  }

  createProvider(schoolId: string): AcademicProvider {
    const entry = this.providers.get(schoolId)
    if (!entry) {
      throw new ProviderError(
        ProviderErrorCode.FEATURE_NOT_SUPPORTED,
        `Unsupported school provider: ${schoolId}`,
        undefined,
        501
      )
    }
    return entry.factory()
  }

  subscribe = (listener: (schoolId: string) => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private addProvider(schoolId: string, factory: ProviderFactory): () => void {
    const entry: ProviderEntry = { factory }
    this.providers.set(schoolId, entry)
    this.publish(schoolId)
    return () => {
      if (this.providers.get(schoolId) !== entry) return
      this.providers.delete(schoolId)
      this.publish(schoolId)
    }
  }

  private addSchool(registration: SchoolRegistration): () => void {
    const { config } = registration
    registerSchoolConfig(config)
    this.publish(config.id)
    const removeProvider = this.addProvider(config.id, registration.providerFactory)
    return () => {
      removeProvider()
      unregisterSchoolConfig(config)
      this.publish(config.id)
    }
  }

  private publish(schoolId: string): void {
    for (const listener of this.listeners) listener(schoolId)
  }
}

export const providerRegistry = new ProviderPluginRegistry()
