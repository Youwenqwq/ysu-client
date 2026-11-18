import type { GetEvents, Parameters as CordisParameters, ThisType } from "@cordisjs/core"
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
  applyPluginBundle(pluginIds: readonly string[], index: MarketplaceIndex): Promise<PluginManifest>
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
  safeMode?(): boolean
}

export type AnalyticsTrackReason = "sent" | "disabled" | "duplicate" | "unavailable" | "failed"

export interface AnalyticsTrackOptions {
  readonly enabled: boolean
  readonly oncePerDay?: boolean
  readonly dedupeKey?: string
}

export interface AnalyticsTrackResult {
  readonly tracked: boolean
  readonly reason: AnalyticsTrackReason
  readonly date: string | null
}

export interface PluginAnalyticsService {
  readonly endpoint: string | null
  track(
    payload: Readonly<Record<string, unknown>>,
    options: AnalyticsTrackOptions
  ): Promise<AnalyticsTrackResult>
}

export type AnnouncementLevel = "info" | "warning" | "critical"

export interface PluginAnnouncement {
  readonly id: string
  readonly title: string
  readonly content: string
  readonly level: AnnouncementLevel
  readonly publishedAt?: string
  readonly expireAt?: string
}

export interface AnnouncementCheckOptions {
  readonly signal?: AbortSignal
}

export interface PluginAnnouncementService {
  readonly endpoint: string | null
  check(options?: AnnouncementCheckOptions): Promise<PluginAnnouncement | null>
  dismiss(id: string): void
}

export type UpdateChannel = "stable" | "prerelease"

export interface UpdateMirror {
  readonly label: string
  readonly value: string
}

export interface UpdateManifestEntry {
  readonly webVersion?: string
  readonly webDownloadUrl?: string
  readonly apkVersionCode?: number
  readonly apkDownloadUrl?: string
  readonly body?: string
}

export interface UpdateManifest extends UpdateManifestEntry {
  readonly channels?: Partial<Record<UpdateChannel, UpdateManifestEntry>>
}

export interface UpdateInfo {
  readonly available: boolean
  readonly version: string
  readonly downloadUrl: string
  readonly body: string
  readonly apkUpdateAvailable: boolean
  readonly apkDownloadUrl: string
}

export interface UpdateCheckOptions {
  readonly automatic?: boolean
  readonly mirror?: string
  readonly channel?: UpdateChannel
}

export interface PluginUpdateService {
  getMirrors(): readonly UpdateMirror[]
  checkForUpdate(options?: UpdateCheckOptions): Promise<UpdateInfo>
  downloadAndApply(info: UpdateInfo, onProgress?: (percent: number) => void): Promise<void>
  applyAndRestart(): Promise<void>
  resetToBuiltin(): Promise<void>
  openApkDownload(url: string): void
  downloadApkInApp(info: UpdateInfo, onProgress?: (percent: number) => void): Promise<void>
  installDownloadedApk(): Promise<void>
  clearApkCache(): Promise<void>
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
  analytics: PluginAnalyticsService
  announcement: PluginAnnouncementService
  updater: PluginUpdateService
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WaterfallValue<F> = F extends (value: infer V, ...rest: any[]) => any ? V : never

declare module "@cordisjs/core" {
  interface Context extends OrahakoServiceMap {
    waterfall<K extends keyof GetEvents<this>>(
      name: K,
      ...args: CordisParameters<GetEvents<this>[K]>
    ): Promise<WaterfallValue<GetEvents<this>[K]>>
    waterfall<K extends keyof GetEvents<this>>(
      thisArg: ThisType<GetEvents<this>[K]>,
      name: K,
      ...args: CordisParameters<GetEvents<this>[K]>
    ): Promise<WaterfallValue<GetEvents<this>[K]>>
  }

  interface Lifecycle {
    waterfall(...args: unknown[]): Promise<unknown>
  }

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
