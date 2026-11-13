"use client"

import { createContext, useContext, type ComponentType, type ReactNode } from "react"

export type PluginSlotKind = "single" | "list" | "keyed"

export interface PluginSlotDeclaration {
  name: string
  kind: PluginSlotKind
}

export interface PluginSlotContribution<Props extends object = object> {
  id: string
  slot: string
  component: ComponentType<Props>
  /** Lower values win for single/keyed slots. */
  priority?: number
  /** Ascending render order for list slots. */
  order?: number
  /** Required for keyed slots. */
  key?: string
}

export interface PluginSlotService {
  declare(slot: PluginSlotDeclaration): () => void
  register<Props extends object>(contribution: PluginSlotContribution<Props>): () => void
}

export interface PluginSlotProps<Props extends object = object> {
  name: string
  props?: Props
  itemKey?: string
  fallback?: ReactNode
}

export interface PluginSlotRuntime {
  renderSlot(
    name: string,
    props: object,
    itemKey: string | undefined,
    fallback: ReactNode
  ): ReactNode
  hasContributions(name: string, itemKey?: string): boolean
}

export const PluginSlotRuntimeContext = createContext<PluginSlotRuntime | undefined>(undefined)

/** Renders a host- or shell-owned extension point without importing host code. */
export function PluginSlot<Props extends object = object>({
  name,
  props,
  itemKey,
  fallback = null,
}: PluginSlotProps<Props>): ReactNode {
  const runtime = useContext(PluginSlotRuntimeContext)
  return runtime?.renderSlot(name, (props ?? {}) as object, itemKey, fallback) ?? fallback
}

/** Subscribe to whether a declared slot currently has a selectable contribution. */
export function usePluginSlotHasContributions(name: string, itemKey?: string): boolean {
  const runtime = useContext(PluginSlotRuntimeContext)
  return runtime?.hasContributions(name, itemKey) ?? false
}
