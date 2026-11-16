"use client"

import type { AcademicCapabilities, AcademicProviderRuntime } from "@orahako/plugin-sdk/academic"
import { useProviderContext } from "./provider"

export function useProvider(): AcademicProviderRuntime {
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

export function useHasCapability(capability: string): boolean {
  return useProviderContext().provider.capabilities[capability] === true
}
