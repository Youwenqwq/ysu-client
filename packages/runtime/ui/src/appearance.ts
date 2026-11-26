import {
  createObservableSource,
  definePlugin,
  PLUGIN_API_VERSION,
  type AppearanceColorMode,
  type AppearanceSnapshot,
  type ObservableSource,
  type PluginAppearanceService,
  type PluginStorageService,
} from "@orahako/sdk"

export const APPEARANCE_RUNTIME_PLUGIN_ID = "orahako.runtime.appearance"

const STORAGE_KEY = "color-mode"

function isColorMode(value: unknown): value is AppearanceColorMode {
  return value === "light" || value === "dark" || value === "system"
}

function detectSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function resolveSnapshot(colorMode: AppearanceColorMode, systemDark: boolean): AppearanceSnapshot {
  const isDark = colorMode === "dark" || (colorMode === "system" && systemDark)
  return {
    colorMode,
    resolvedColorMode: isDark ? "dark" : "light",
    isDark,
  }
}

function syncDocumentDarkClass(isDark: boolean): void {
  if (typeof document === "undefined" || !document.documentElement?.classList) return
  document.documentElement.classList.toggle("dark", isDark)
}

export class AppearanceRegistry implements PluginAppearanceService {
  readonly state: ObservableSource<AppearanceSnapshot>
  private readonly stateSource: ReturnType<typeof createObservableSource<AppearanceSnapshot>>
  private colorMode: AppearanceColorMode
  private systemDark: boolean
  private disposed = false
  private detachMedia: (() => void) | null = null

  constructor(
    private readonly storage?: PluginStorageService,
    initialColorMode: AppearanceColorMode = "system"
  ) {
    this.colorMode = initialColorMode
    this.systemDark = detectSystemPrefersDark()
    const initial = resolveSnapshot(this.colorMode, this.systemDark)
    this.stateSource = createObservableSource<AppearanceSnapshot>(initial)
    this.state = {
      getSnapshot: this.stateSource.getSnapshot,
      subscribe: this.stateSource.subscribe,
    }
    syncDocumentDarkClass(initial.isDark)
    this.attachMediaListener()
    void this.hydrate()
  }

  getSnapshot = (): AppearanceSnapshot => {
    return this.stateSource.getSnapshot()
  }

  subscribe = (listener: () => void): (() => void) => {
    return this.stateSource.subscribe(listener)
  }

  setColorMode = (colorMode: AppearanceColorMode): void => {
    if (this.disposed || !isColorMode(colorMode)) return
    if (this.colorMode !== colorMode) {
      this.colorMode = colorMode
      this.publish()
    }
    void this.persist(colorMode)
  }

  toggleDark = (): void => {
    const current = this.stateSource.getSnapshot()
    this.setColorMode(current.isDark ? "light" : "dark")
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.detachMedia?.()
    this.detachMedia = null
  }

  private attachMediaListener(): void {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = (event: MediaQueryListEvent) => {
      if (this.disposed) return
      if (this.systemDark === event.matches) return
      this.systemDark = event.matches
      this.publish()
    }
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange)
      this.detachMedia = () => mql.removeEventListener("change", onChange)
    }
  }

  private async hydrate(): Promise<void> {
    if (!this.storage) return
    try {
      const stored = await this.storage.local.getItem(STORAGE_KEY)
      if (this.disposed || !stored) return
      if (isColorMode(stored) && stored !== this.colorMode) {
        this.colorMode = stored
        this.publish()
      }
    } catch {
      // Ignore storage read errors; in-memory mode remains authoritative.
    }
  }

  private async persist(colorMode: AppearanceColorMode): Promise<void> {
    if (!this.storage) return
    try {
      await this.storage.local.setItem(STORAGE_KEY, colorMode)
    } catch {
      // Ignore storage write errors; in-memory mode remains authoritative.
    }
  }

  private publish(): void {
    const next = resolveSnapshot(this.colorMode, this.systemDark)
    syncDocumentDarkClass(next.isDark)
    this.stateSource.set(next)
  }
}

export const appearanceRuntimePlugin = definePlugin({
  manifest: {
    id: APPEARANCE_RUNTIME_PLUGIN_ID,
    name: "Appearance runtime",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    provides: ["appearance"],
  },
  optionalInject: ["storage"] as const,
  apply(ctx) {
    const registry = new AppearanceRegistry(ctx.storage)
    ctx.set("appearance", registry)
    ctx.effect(() => () => {
      registry.dispose()
    })
  },
})
