import type { ObservableSource } from "./observable"

export type AppearanceColorMode = "light" | "dark" | "system"
export type AppearanceResolvedColorMode = "light" | "dark"

export interface AppearanceSnapshot {
  readonly colorMode: AppearanceColorMode
  readonly resolvedColorMode: AppearanceResolvedColorMode
  readonly isDark: boolean
}

export interface PluginAppearanceService {
  readonly state: ObservableSource<AppearanceSnapshot>
  getSnapshot(): AppearanceSnapshot
  subscribe(listener: () => void): () => void
  setColorMode(colorMode: AppearanceColorMode): void
  toggleDark(): void
}
