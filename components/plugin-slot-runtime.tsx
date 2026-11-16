"use client"

import { Component, createElement, useMemo, useSyncExternalStore, type ReactNode } from "react"
import { PluginSlotRuntimeContext, type PluginSlotRuntime } from "@orahako/plugin-sdk"
import type { PluginSlotRegistryService } from "@orahako/plugin-sdk"

class SlotContributionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error("Plugin slot contribution failed", error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

const EMPTY_SNAPSHOT = { declarations: [], contributions: [] } as const
const NOOP_SUBSCRIBE = () => () => {}

export function PluginSlotRuntimeProvider({
  registry,
  children,
}: {
  registry?: PluginSlotRegistryService
  children: ReactNode
}) {
  const snapshot = useSyncExternalStore(
    registry?.subscribe ?? NOOP_SUBSCRIBE,
    registry?.getSnapshot ?? (() => EMPTY_SNAPSHOT),
    () => EMPTY_SNAPSHOT
  )
  const runtime = useMemo<PluginSlotRuntime>(
    () => ({
      hasContributions(name, itemKey) {
        return (registry?.select(name, itemKey).length ?? 0) > 0
      },
      renderSlot(name, props, itemKey, fallback) {
        if (!snapshot.declarations.some((slot) => slot.name === name)) return fallback
        const contributions = registry?.select(name, itemKey) ?? []
        if (contributions.length === 0) return fallback
        return contributions.map((contribution) => (
          <SlotContributionBoundary
            key={`${contribution.pluginId}:${contribution.id}:${contribution.generation}`}
          >
            {createElement(contribution.component, props)}
          </SlotContributionBoundary>
        ))
      },
    }),
    [snapshot, registry]
  )
  return (
    <PluginSlotRuntimeContext.Provider value={runtime}>
      {children}
    </PluginSlotRuntimeContext.Provider>
  )
}
