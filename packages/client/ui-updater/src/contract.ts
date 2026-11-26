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
  readonly minApkVersionCode?: number
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

declare module "@cordisjs/core" {
  interface Context {
    updater: PluginUpdateService
  }
}
