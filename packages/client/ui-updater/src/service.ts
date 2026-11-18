import { App } from "@capacitor/app"
import { CapacitorUpdater } from "@capgo/capacitor-updater"
import { clean, compare, gt, prerelease, valid } from "semver"
import {
  invokeNativeCapability,
  isCapacitor,
  onNativeCapabilityEvent,
  type PluginKeyValueStorage,
  type PluginNativeService,
  type PluginUpdateService,
  type UpdateChannel,
  type UpdateCheckOptions,
  type UpdateInfo,
  type UpdateManifest,
  type UpdateManifestEntry,
  type UpdateMirror,
} from "@orahako/sdk"

const DEFAULT_VERSION_MANIFEST = "version.json"
const DEFAULT_BUNDLE_ASSET = "dist.zip"
const DEFAULT_CHECK_COOLDOWN_MS = 30 * 60 * 1000
const DEFAULT_CHECK_COOLDOWN_KEY = "update-last-check"
const DEFAULT_OTA_CLEANUP_KEY = "ota-cleanup"
export const DEFAULT_MIRRORS: readonly UpdateMirror[] = [{ label: "Direct", value: "" }]

export const EMPTY_UPDATE: UpdateInfo = {
  available: false,
  version: "",
  downloadUrl: "",
  body: "",
  apkUpdateAvailable: false,
  apkDownloadUrl: "",
}

export interface ConfiguredUpdateOptions {
  /** Base URL hosting the release manifest and bundle assets; omit/empty disables remote checks. */
  readonly releaseBaseUrl?: string
  /** Installed application version used for web-bundle comparisons. */
  readonly currentVersion: string
  /** Mirror presets exposed to UI controls; defaults to direct download only. */
  readonly mirrors?: readonly UpdateMirror[]
  /** Asset origins that may be prefixed with a mirror; empty disables mirroring on explicit asset URLs. */
  readonly mirrorableOrigins?: readonly string[]
  readonly versionManifestName?: string
  readonly bundleAssetName?: string
  readonly checkCooldownMs?: number
  readonly checkCooldownStorageKey?: string
  readonly otaCleanupStorageKey?: string
  readonly storage?: PluginKeyValueStorage
  readonly native?: Pick<PluginNativeService, "isNative" | "capabilities">
  readonly now?: () => number
}

interface UpdateCandidate extends UpdateManifestEntry {
  readonly webVersion: string
  readonly normalizedVersion: string
}

function normalizeVersion(version: string): string | null {
  const trimmed = version.trim()
  return valid(trimmed) ?? clean(trimmed) ?? null
}

function isAllowedTarget(version: string, channel: UpdateChannel): boolean {
  return channel === "prerelease" || prerelease(version) === null
}

/** Compare two semver strings. Returns true when target > current for the channel. */
export function isNewer(
  current: string,
  target: string,
  channel: UpdateChannel = "stable"
): boolean {
  const currentVersion = normalizeVersion(current)
  const targetVersion = normalizeVersion(target)
  if (!currentVersion || !targetVersion) return false
  if (!isAllowedTarget(targetVersion, channel)) return false
  return gt(targetVersion, currentVersion)
}

function toTopLevelEntry(data: UpdateManifest): UpdateManifestEntry {
  return {
    ...(data.webVersion !== undefined ? { webVersion: data.webVersion } : {}),
    ...(data.webDownloadUrl !== undefined ? { webDownloadUrl: data.webDownloadUrl } : {}),
    ...(data.apkVersionCode !== undefined ? { apkVersionCode: data.apkVersionCode } : {}),
    ...(data.apkDownloadUrl !== undefined ? { apkDownloadUrl: data.apkDownloadUrl } : {}),
    ...(data.body !== undefined ? { body: data.body } : {}),
  }
}

function getChannelCandidates(data: UpdateManifest, channel: UpdateChannel): UpdateCandidate[] {
  const topLevel = toTopLevelEntry(data)
  const stable = data.channels?.stable ? { ...topLevel, ...data.channels.stable } : topLevel
  const entries = channel === "stable" ? [stable] : [stable, data.channels?.prerelease]

  return entries.flatMap((entry) => {
    if (!entry?.webVersion) return []
    const normalizedVersion = normalizeVersion(entry.webVersion)
    if (!normalizedVersion || !isAllowedTarget(normalizedVersion, channel)) {
      return []
    }
    return [{ ...entry, webVersion: entry.webVersion, normalizedVersion }]
  })
}

function getHighestVersionCandidate(
  candidates: readonly UpdateCandidate[]
): UpdateCandidate | undefined {
  const sorted = [...candidates].sort((a, b) => compare(a.normalizedVersion, b.normalizedVersion))
  return sorted[sorted.length - 1]
}

export class ConfiguredUpdateService implements PluginUpdateService {
  private readonly releaseBaseUrl: string | null
  private readonly currentVersion: string
  private readonly mirrors: readonly UpdateMirror[]
  private readonly mirrorableOrigins: ReadonlySet<string>
  private readonly versionManifestName: string
  private readonly bundleAssetName: string
  private readonly checkCooldownMs: number
  private readonly checkCooldownStorageKey: string
  private readonly otaCleanupStorageKey: string
  private readonly storage: PluginKeyValueStorage | undefined
  private readonly native: Pick<PluginNativeService, "isNative" | "capabilities"> | undefined
  private readonly memory = new Map<string, string>()
  private readonly now: () => number
  private lastDownloadedApkPath: string | null = null
  private disposed = false

  constructor({
    releaseBaseUrl,
    currentVersion,
    mirrors = DEFAULT_MIRRORS,
    mirrorableOrigins = [],
    versionManifestName = DEFAULT_VERSION_MANIFEST,
    bundleAssetName = DEFAULT_BUNDLE_ASSET,
    checkCooldownMs = DEFAULT_CHECK_COOLDOWN_MS,
    checkCooldownStorageKey = DEFAULT_CHECK_COOLDOWN_KEY,
    otaCleanupStorageKey = DEFAULT_OTA_CLEANUP_KEY,
    storage,
    native,
    now = () => Date.now(),
  }: ConfiguredUpdateOptions) {
    const trimmedBase = releaseBaseUrl?.trim().replace(/\/+$/, "") ?? ""
    this.releaseBaseUrl = trimmedBase.length > 0 ? trimmedBase : null
    this.currentVersion = currentVersion
    this.mirrors = mirrors.length > 0 ? mirrors : DEFAULT_MIRRORS
    this.mirrorableOrigins = new Set(
      mirrorableOrigins.map((origin) => origin.trim().replace(/\/+$/, "")).filter(Boolean)
    )
    this.versionManifestName = versionManifestName
    this.bundleAssetName = bundleAssetName
    this.checkCooldownMs = checkCooldownMs
    this.checkCooldownStorageKey = checkCooldownStorageKey
    this.otaCleanupStorageKey = otaCleanupStorageKey
    this.storage = storage
    this.native = native
    this.now = now
  }

  getMirrors(): readonly UpdateMirror[] {
    return this.mirrors
  }

  async checkForUpdate(options: UpdateCheckOptions = {}): Promise<UpdateInfo> {
    if (!this.releaseBaseUrl || this.disposed) {
      return EMPTY_UPDATE
    }

    const automatic = options.automatic ?? false
    const channel = options.channel ?? "stable"
    const mirror = options.mirror?.trim() ?? ""
    const cooldownKey = `${this.checkCooldownStorageKey}:${channel}`

    if (automatic) {
      const last = await this.read(cooldownKey)
      if (last && this.now() - Number(last) < this.checkCooldownMs) {
        return EMPTY_UPDATE
      }
    }

    const versionJsonUrl = this.withMirror(mirror, this.releaseUrl(this.versionManifestName), true)
    const distZipUrl = this.withMirror(mirror, this.releaseUrl(this.bundleAssetName), true)

    try {
      const res = await fetch(versionJsonUrl)
      if (res.status === 403) throw new Error("RATE_LIMIT")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = (await res.json()) as UpdateManifest
      const candidates = getChannelCandidates(data, channel)
      if (candidates.length === 0) return EMPTY_UPDATE

      if (automatic) {
        await this.write(cooldownKey, String(this.now()))
      }

      const webUpdateCandidate = getHighestVersionCandidate(
        candidates.filter((candidate) =>
          isNewer(this.currentVersion, candidate.webVersion, channel)
        )
      )
      const displayCandidate = webUpdateCandidate ?? getHighestVersionCandidate(candidates)
      if (!displayCandidate) return EMPTY_UPDATE

      let available = Boolean(webUpdateCandidate)
      let version = displayCandidate.webVersion
      let body = displayCandidate.body ?? ""
      let apkUpdateAvailable = false
      let apkDownloadUrl = ""
      const downloadUrl = displayCandidate.webDownloadUrl
        ? this.withMirror(mirror, displayCandidate.webDownloadUrl)
        : distZipUrl

      if (this.isNativePlatform()) {
        const apkCandidate = await this.getApkUpdateCandidate(candidates)
        if (apkCandidate) {
          version = apkCandidate.webVersion
          body = apkCandidate.body ?? ""
          apkUpdateAvailable = true
          apkDownloadUrl = apkCandidate.apkDownloadUrl
            ? this.withMirror(mirror, apkCandidate.apkDownloadUrl)
            : ""
          available = false
        }
      }

      return {
        available,
        version,
        downloadUrl,
        body,
        apkUpdateAvailable,
        apkDownloadUrl,
      }
    } catch (error) {
      if (automatic) return EMPTY_UPDATE
      throw error
    }
  }

  async downloadAndApply(info: UpdateInfo, onProgress?: (percent: number) => void): Promise<void> {
    const listener = await CapacitorUpdater.addListener("download", (state) => {
      onProgress?.(state.percent)
    })
    try {
      const bundle = await CapacitorUpdater.download({
        url: info.downloadUrl,
        version: info.version,
      })
      await CapacitorUpdater.next({ id: bundle.id })
      await this.write(this.otaCleanupStorageKey, "1")
    } finally {
      await listener.remove()
    }
  }

  async applyAndRestart(): Promise<void> {
    await CapacitorUpdater.reload()
  }

  async resetToBuiltin(): Promise<void> {
    await CapacitorUpdater.reset()
  }

  openApkDownload(url: string): void {
    if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(url, "_system")
    }
  }

  async downloadApkInApp(info: UpdateInfo, onProgress?: (percent: number) => void): Promise<void> {
    if (!info.apkDownloadUrl) throw new Error("No APK download URL")

    const listener = await onNativeCapabilityEvent<{ percent: number }>(
      "native.files",
      "downloadProgress",
      (data) => onProgress?.(data.percent)
    )

    try {
      const result = this.native
        ? await this.native.capabilities.invoke<{ path: string }>("native.files", "downloadApk", {
            url: info.apkDownloadUrl,
          })
        : await invokeNativeCapability<{ path: string }>("native.files", "downloadApk", {
            url: info.apkDownloadUrl,
          })
      this.lastDownloadedApkPath = result.path
    } finally {
      await listener.remove()
    }
  }

  async installDownloadedApk(): Promise<void> {
    if (!this.lastDownloadedApkPath) throw new Error("No APK downloaded")
    if (this.native) {
      await this.native.capabilities.invoke("native.files", "installApk", {
        path: this.lastDownloadedApkPath,
      })
    } else {
      await invokeNativeCapability("native.files", "installApk", {
        path: this.lastDownloadedApkPath,
      })
    }
  }

  async clearApkCache(): Promise<void> {
    if (this.native) {
      await this.native.capabilities.invoke("native.files", "clearDirectory")
    } else {
      await invokeNativeCapability("native.files", "clearDirectory")
    }
    this.lastDownloadedApkPath = null
  }

  dispose(): void {
    this.disposed = true
    this.lastDownloadedApkPath = null
  }

  private isNativePlatform(): boolean {
    return this.native ? this.native.isNative : isCapacitor()
  }

  private releaseUrl(assetName: string): string {
    return `${this.releaseBaseUrl}/${assetName}`
  }

  private withMirror(prefix: string, url: string, allowAnyAsset = false): string {
    if (!prefix) return url
    if (!allowAnyAsset && !this.isMirrorable(url)) return url
    return `${prefix}${url}`
  }

  private isMirrorable(url: string): boolean {
    if (this.mirrorableOrigins.size === 0) return false
    try {
      return this.mirrorableOrigins.has(new URL(url).origin)
    } catch {
      return false
    }
  }

  private async getApkUpdateCandidate(
    candidates: readonly UpdateCandidate[]
  ): Promise<UpdateCandidate | undefined> {
    const installed = await App.getInfo()
    const installedBuild = Number(installed.build)
    const sorted = candidates
      .filter(
        (candidate) =>
          typeof candidate.apkVersionCode === "number" && candidate.apkVersionCode > installedBuild
      )
      .sort((a, b) => (a.apkVersionCode ?? 0) - (b.apkVersionCode ?? 0))
    return sorted[sorted.length - 1]
  }

  private async read(key: string): Promise<string | null> {
    const inMemory = this.memory.get(key)
    if (inMemory !== undefined) return inMemory
    try {
      const stored = await this.storage?.getItem(key)
      if (stored !== null && stored !== undefined) {
        this.memory.set(key, stored)
        return stored
      }
    } catch {
      // Fall back to in-memory cooldown map.
    }
    return null
  }

  private async write(key: string, value: string): Promise<void> {
    this.memory.set(key, value)
    try {
      await this.storage?.setItem(key, value)
    } catch {
      // In-memory state still prevents duplicate automatic checks in this session.
    }
  }
}
