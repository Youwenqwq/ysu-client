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
  /** Suppress errors and respect the configured automatic-check cooldown. */
  readonly automatic?: boolean
  /** Mirror prefix chosen by the user; empty means direct download. */
  readonly mirror?: string
  readonly channel?: UpdateChannel
}

/**
 * Generic OTA and release-download mechanisms. Release locations, mirror
 * presets and asset names belong to the providing plugin's configuration, so a
 * different composition can serve its own repository without changing callers.
 */
export interface PluginUpdateService {
  /** Mirror presets contributed by the active composition. */
  getMirrors(): readonly UpdateMirror[]
  /** Reads the configured release manifest and resolves the newest candidate. */
  checkForUpdate(options?: UpdateCheckOptions): Promise<UpdateInfo>
  /** Downloads the web bundle and schedules it as the next Capacitor bundle. */
  downloadAndApply(info: UpdateInfo, onProgress?: (percent: number) => void): Promise<void>
  /** Applies the pending bundle immediately by reloading the app. */
  applyAndRestart(): Promise<void>
  /** Resets to the bundled assets (emergency rollback). */
  resetToBuiltin(): Promise<void>
  /** Opens an APK URL in the system browser. */
  openApkDownload(url: string): void
  /** Downloads the APK through the generic native file capability. */
  downloadApkInApp(info: UpdateInfo, onProgress?: (percent: number) => void): Promise<void>
  /** Launches the system installer for the last downloaded APK. */
  installDownloadedApk(): Promise<void>
  /** Clears the APK cache directory. */
  clearApkCache(): Promise<void>
}
