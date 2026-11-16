/**
 * Lifecycle every runtime-managed provider must implement.
 *
 * The runtime only selects, initializes, retires and re-authenticates
 * providers; it never depends on academic capabilities, school configuration
 * or any other domain-specific field.
 */
export interface ManagedProvider {
  initialize(): Promise<void>
  reset(): Promise<void>
  logout(): Promise<void>
  relogin(): Promise<boolean>
}

export type ProviderRuntimeStatus = "unavailable" | "initializing" | "ready" | "error"

export interface ProviderRuntimeSnapshot {
  readonly status: ProviderRuntimeStatus
  readonly schoolId: string | null
  readonly provider: ManagedProvider | null
  readonly error: Error | null
  readonly generation: number
}

export interface PluginProviderRuntimeService {
  getSnapshot(): ProviderRuntimeSnapshot
  subscribe(listener: () => void): () => void
  getActive(): ManagedProvider
  selectSchool(schoolId: string): ManagedProvider
  initialize(): Promise<ManagedProvider>
  reset(): Promise<void>
  logout(): Promise<void>
  relogin(): Promise<boolean>
}
