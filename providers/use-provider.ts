import { useProviderContext } from "./provider-context"
import type { AcademicCapabilities, AcademicProvider } from "./types"

export function useProvider(): AcademicProvider {
  return useProviderContext().provider
}

export function useProviderReady(): boolean {
  return useProviderContext().isReady
}

export function useProviderCapabilities(): AcademicCapabilities {
  return useProviderContext().provider.capabilities
}

/** Active provider's plugin allowlist; `undefined` means every plugin is allowed. */
export function useSupportedPlugins(): readonly string[] | undefined {
  return useProviderContext().provider.supportedPlugins
}

export function useHasCapability(capability: keyof AcademicCapabilities): boolean {
  return useProviderContext().provider.capabilities[capability] === true
}
