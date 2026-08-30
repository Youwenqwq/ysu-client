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

export function useHasCapability(capability: keyof AcademicCapabilities): boolean {
  return useProviderContext().provider.capabilities[capability] === true
}
