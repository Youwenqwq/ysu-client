import { create } from "zustand"

export interface ActivePluginRoute {
  pluginId: string
  pageId: string
  title: string
  titleKey?: string
  parent?: string
  primary?: boolean
  capability?: string
}

interface PluginRouteState {
  current?: ActivePluginRoute
  setCurrent(current?: ActivePluginRoute): void
}

export const usePluginRouteStore = create<PluginRouteState>((set) => ({
  current: undefined,
  setCurrent: (current) => set({ current }),
}))
