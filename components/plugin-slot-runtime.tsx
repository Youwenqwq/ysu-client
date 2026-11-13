"use client"

import { Component, createElement, useMemo, useSyncExternalStore, type ReactNode } from "react"
import { PluginSlotRuntimeContext, type PluginSlotRuntime } from "@ysu/plugin-sdk"
import type { PluginSlotRegistry } from "@/lib/plugins/slot-registry"

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

export function PluginSlotRuntimeProvider({
  registry,
  children,
}: {
  registry: PluginSlotRegistry
  children: ReactNode
}) {
  const snapshot = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot
  )
  const runtime = useMemo<PluginSlotRuntime>(
    () => ({
      renderSlot(name, props, itemKey, fallback) {
        if (!snapshot.declarations.some((slot) => slot.name === name)) return fallback
        const contributions = registry.select(name, itemKey)
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
