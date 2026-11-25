import type { HttpRequest, HttpResponse, PluginHttpService } from "./http"
import type { PluginI18nService } from "./i18n"
import type { PluginManifest } from "./manifest"
import type { MarketplaceIndex } from "./market"
import type { PluginNativeService } from "./native"
import type { PluginNavigationService } from "./navigation"
import type { ObservableSource } from "./observable"
import type { PluginRouterService } from "./router"
import type { PluginSettingsService } from "./settings"
import type { PluginSlotService } from "./slots"
import type { PluginUIService } from "./ui"
import type { PluginWidgetService } from "./widgets"

export interface PluginKeyValueStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

export interface PluginStorageService {
  readonly local: PluginKeyValueStorage
  readonly secure: PluginKeyValueStorage
}

export interface PluginAssetService {
  url(path: string): string | undefined
}

/** Observable host preference values shared by the kernel and UI runtimes. */
export interface PluginHostPreferenceSnapshot {
  readonly activeShell?: string
  readonly activeTheme?: string
  readonly startupPage?: string
}

/** Host-owned, persisted preference facade exposed to the app runtime. */
export interface PluginHostPreferences {
  readonly state: ObservableSource<PluginHostPreferenceSnapshot>
  isPluginDisabled(id: string): boolean
  setPluginDisabled(id: string, disabled: boolean): void
  getActiveShell(): string | undefined
  setActiveShell(shellId: string | undefined): void
  getActiveTheme(): string | undefined
  setActiveTheme(themeId: string | undefined): void
  getStartupPage(): string | undefined
  setStartupPage(route: string | undefined): void
}

export interface InstalledPluginSummary {
  readonly manifest: PluginManifest
  readonly installedAt: number
  readonly fileCount: number
  readonly byteSize: number
}

export interface PluginInstallerService {
  installFromMarket(pluginId: string): Promise<PluginManifest>
}

export interface PluginManagerState {
  readonly manifest: PluginManifest
  readonly source?: "builtin" | "external"
  readonly status: string
  readonly error?: string
}

export interface PluginManagerService {
  readonly state: ObservableSource<readonly PluginManagerState[]>
  enable(id: string): Promise<void>
  /** Policy-only stop; unlike disable(), this never changes user preferences. */
  suspend(id: string): void
  disable(id: string): void
  isProtected(id: string): boolean
  /** True when the user explicitly disabled the plugin, independent of runtime status. */
  isUserDisabled(id: string): boolean
  getSnapshot(): readonly PluginManagerState[]
  subscribe(listener: () => void): () => void
}

export interface PluginPackageRuntime {
  installFromUrl(
    url: string,
    sha256: string,
    expected: { id: string; version: string }
  ): Promise<PluginManifest>
  applyPluginBundle(
    pluginIds: readonly string[],
    index: MarketplaceIndex,
    marketBaseUrl: string
  ): Promise<PluginManifest>
  assetUrl(pluginId: string, path: string): string | undefined
  nativeCapabilities(): readonly string[]
  /** Optional on minimal test/embedded runtimes; always provided by PluginHost. */
  installPackage?(input: Uint8Array | ArrayBuffer | Blob): Promise<PluginManifest>
  uninstall?(id: string): Promise<void>
  listInstalled?(): Promise<readonly InstalledPluginSummary[]>
  marketUrl?(): string | undefined
  appVersion?(): string
  loadErrors?(): ReadonlyMap<string, string>
  getActiveShell?(): string | undefined
  setActiveShell?(shellId: string | undefined): void
  /** Optional on minimal test/embedded runtimes; always provided by PluginHost. */
  preferenceState?: ObservableSource<PluginHostPreferenceSnapshot>
  getActiveTheme?(): string | undefined
  setActiveTheme?(themeId: string | undefined): void
  getStartupPage?(): string | undefined
  setStartupPage?(route: string | undefined): void
  defaultLanding?(): string | undefined
  defaultShell?(): string | undefined
  safeMode?(): boolean
}

export interface OrahakoServiceMap {
  router: PluginRouterService
  navigation: PluginNavigationService
  ui: PluginUIService
  slots: PluginSlotService
  settings: PluginSettingsService
  i18n: PluginI18nService
  storage: PluginStorageService
  http: PluginHttpService
  native: PluginNativeService
  widgets: PluginWidgetService
  assets: PluginAssetService
  plugins: PluginInstallerService
  packageRuntime: PluginPackageRuntime
  pluginManager: PluginManagerService
}

declare module "@cordisjs/core" {
  interface Context extends OrahakoServiceMap {}

  interface Events {
    "http/request"(
      request: HttpRequest
    ): HttpRequest | void | undefined | Promise<HttpRequest | void | undefined>
    "http/response"(
      response: HttpResponse,
      request: HttpRequest
    ): HttpResponse | void | undefined | Promise<HttpResponse | void | undefined>
  }
}
