import type { AcademicProvider } from "./academic"
import type { SchoolConfig } from "./provider-school"

/** Creates a fresh provider instance for one school. */
export type ProviderFactory = () => AcademicProvider

/** A school config plus the provider factory that serves it. */
export interface SchoolRegistration {
  config: SchoolConfig
  providerFactory: ProviderFactory
}

/**
 * Provider capability exposed to plugins as `ctx.providers`.
 *
 * Registrations made through this service are revoked automatically when the
 * contributing plugin's Cordis scope is disposed. Each method also returns a
 * disposer for manual early removal.
 */
export interface PluginProviderService {
  registerProvider(schoolId: string, factory: ProviderFactory): () => void
  registerSchool(registration: SchoolRegistration): () => void
  hasProvider(schoolId: string): boolean
}
