import { CapacitorUpdater } from "@capgo/capacitor-updater"
import { App } from "@capacitor/app"
import { clean, compare, gt, prerelease, valid } from "semver"
import type {
  PluginUpdateService,
  UpdateChannel,
  UpdateCheckOptions,
  UpdateInfo,
  UpdateManifest,
  UpdateManifestEntry,
  UpdateMirror,
} from "@orahako/plugin-sdk"
import {
  invokeNativeCapability,
  isCapacitor,
  onNativeCapabilityEvent,
} from "@orahako/plugin-sdk/native"

const DEFAULT_VERSION_MANIFEST = "version.json"
const DEFAULT_BUNDLE_ASSET = "dist.zip"
const DEFAULT_CHECK_COOLDOWN_MS = 30 * 60 * 1000
const DEFAULT_CHECK_COOLDOWN_KEY = "orahako-update-last-check"
const DEFAULT_MIRRORS: readonly UpdateMirror[] = [{ label: "Direct", value: "" }]

const EMPTY_UPDATE: UpdateInfo = {
  available: false,
  version: "",
  downloadUrl: "",
  body: "",
  apkUpdateAvailable: false,
  apkDownloadUrl: "",
}

export interface UpdateStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ConfiguredUpdateOptions {
  /** Base URL that hosts the release manifest and bundle assets. */
  releaseBaseUrl: string
  /** Installed application version used for web-bundle comparisons. */
  currentVersion: string
  /** Mirror presets shown by the host; defaults to direct download only. */
  mirrors?: readonly UpdateMirror[]
  /** Asset origins that may be prefixed with a mirror; empty disables it. */
  mirrorableOrigins?: readonly string[]
  versionManifestName?: string
  bundleAssetName?: string
  checkCooldownMs?: number
  checkCooldownStorageKey?: string
  /** When set, a successful bundle download marks this key for OTA cleanup. */
  otaCleanupStorageKey?: string
  storage?: UpdateStorage | null
  now?: () => number
}

interface UpdateCandidate extends UpdateManifestEntry {
  webVersion: string
  normalizedVersion: string
}

function browserStorage(): UpdateStorage | null {
  if (typeof localStorage === "undefined") return null
  return localStorage
}

function normalizeVersion(version: string): string | null {
  const trimmed = version.trim()
  return valid(trimmed) ?? clean(trimmed) ?? null
}

function isAllowedTarget(version: string, channel: UpdateChannel): boolean {
  return channel === "prerelease" || prerelease(version) === null
}

/** Compare two semver strings. Returns true if target > current for the channel. */
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
    webVersion: data.webVersion,
    webDownloadUrl: data.webDownloadUrl,
    apkVersionCode: data.apkVersionCode,
    apkDownloadUrl: data.apkDownloadUrl,
    body: data.body,
  }
}

function getChannelCandidates(
  data: UpdateManifest,
  channel: UpdateChannel
): UpdateCandidate[] {
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
  candidates: UpdateCandidate[]
): UpdateCandidate | undefined {
  const sorted = [...candidates].sort((a, b) => compare(a.normalizedVersion, b.normalizedVersion))
  return sorted[sorted.length - 1]
}

/**
 * Generic release/OTA mechanism. Every remote location, mirror preset and
 * mirrorable origin comes from configuration; this class owns no official
 * repository identity.
 */
export class ConfiguredUpdateService implements PluginUpdateService {
  private readonly releaseBaseUrl: string
  private readonly currentVersion: string
  private readonly mirrors: readonly UpdateMirror[]
  private readonly mirrorableOrigins: ReadonlySet<string>
  private readonly versionManifestName: string
  private readonly bundleAssetName: string
  private readonly checkCooldownMs: number
  private readonly checkCooldownStorageKey: string
  private readonly otaCleanupStorageKey: string | null
  private readonly storage: UpdateStorage | null
  private readonly memory = new Map<string, string>()
  private readonly now: () => number
  private lastDownloadedApkPath: string | null = null

  constructor({
    releaseBaseUrl,
    currentVersion,
    mirrors = DEFAULT_MIRRORS,
    mirrorableOrigins = [],
    versionManifestName = DEFAULT_VERSION_MANIFEST,
    bundleAssetName = DEFAULT_BUNDLE_ASSET,
    checkCooldownMs = DEFAULT_CHECK_COOLDOWN_MS,
    checkCooldownStorageKey = DEFAULT_CHECK_COOLDOWN_KEY,
    otaCleanupStorageKey,
    storage = browserStorage(),
    now = () => Date.now(),
  }: ConfiguredUpdateOptions) {
    const base = releaseBaseUrl.trim().replace(/\/+$/, "")
    if (!base) throw new Error("Update service requires a release base URL")
    this.releaseBaseUrl = base
    this.currentVersion = currentVersion
    this.mirrors = mirrors
    this.mirrorableOrigins = new Set(
      mirrorableOrigins.map((origin) => origin.trim().replace(/\/+$/, "")).filter(Boolean)
    )
    this.versionManifestName = versionManifestName
    this.bundleAssetName = bundleAssetName
    this.checkCooldownMs = checkCooldownMs
    this.checkCooldownStorageKey = checkCooldownStorageKey
    this.otaCleanupStorageKey = otaCleanupStorageKey?.trim() || null
    this.storage = storage
    this.now = now
  }

  getMirrors(): readonly UpdateMirror[] {
    return this.mirrors
  }

  async checkForUpdate(options: UpdateCheckOptions = {}): Promise<UpdateInfo> {
    const automatic = options.automatic ?? false
    const channel = options.channel ?? "stable"
    const mirror = options.mirror?.trim() ?? ""
    const cooldownKey = `${this.checkCooldownStorageKey}:${channel}`

    if (automatic) {
      const last = this.read(cooldownKey)
      if (last && this.now() - Number(last) < this.checkCooldownMs) {
        return EMPTY_UPDATE
      }
    }

    const versionJsonUrl = this.withMirror(
      mirror,
      this.releaseUrl(this.versionManifestName),
      true
    )
    const distZipUrl = this.withMirror(mirror, this.releaseUrl(this.bundleAssetName), true)

    try {
      const res = await fetch(versionJsonUrl)
      if (res.status === 403) throw new Error("RATE_LIMIT")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data = (await res.json()) as UpdateManifest
      const candidates = getChannelCandidates(data, channel)
      if (!candidates.length) return EMPTY_UPDATE

      if (automatic) this.write(cooldownKey, String(this.now()))

      const webUpdateCandidate = getHighestVersionCandidate(
        candidates.filter((candidate) =>
          isNewer(this.currentVersion, candidate.webVersion, channel)
        )
      )
      const displayCandidate = webUpdateCandidate ?? getHighestVersionCandidate(candidates)
      if (!displayCandidate) return EMPTY_UPDATE

      const result: {
        available: boolean
        version: string
        downloadUrl: string
        body: string
        apkUpdateAvailable: boolean
        apkDownloadUrl: string
      } = {
        available: Boolean(webUpdateCandidate),
        version: displayCandidate.webVersion,
        downloadUrl: displayCandidate.webDownloadUrl
          ? this.withMirror(mirror, displayCandidate.webDownloadUrl)
          : distZipUrl,
        body: displayCandidate.body ?? "",
        apkUpdateAvailable: false,
        apkDownloadUrl: "",
      }

      if (isCapacitor()) {
        const apkUpdateCandidate = await this.getApkUpdateCandidate(candidates)
        if (apkUpdateCandidate) {
          result.version = apkUpdateCandidate.webVersion
          result.body = apkUpdateCandidate.body ?? ""
          result.apkUpdateAvailable = true
          result.apkDownloadUrl = apkUpdateCandidate.apkDownloadUrl
            ? this.withMirror(mirror, apkUpdateCandidate.apkDownloadUrl)
            : ""
          if (result.available) result.available = false
        }
      }

      return result
    } catch (err) {
      if (automatic) return EMPTY_UPDATE
      throw err
    }
  }

  async downloadAndApply(
    info: UpdateInfo,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    const listener = await CapacitorUpdater.addListener("download", (state) => {
      onProgress?.(state.percent)
    })

    try {
      const bundle = await CapacitorUpdater.download({
        url: info.downloadUrl,
        version: info.version,
      })
      await CapacitorUpdater.next({ id: bundle.id })
      if (this.otaCleanupStorageKey) this.write(this.otaCleanupStorageKey, "1")
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
    window.open(url, "_system")
  }

  async downloadApkInApp(
    info: UpdateInfo,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    if (!info.apkDownloadUrl) throw new Error("No APK download URL")

    const listener = await onNativeCapabilityEvent<{ percent: number }>(
      "native.files",
      "downloadProgress",
      (data) => onProgress?.(data.percent)
    )

    try {
      const result = await invokeNativeCapability<{ path: string }>(
        "native.files",
        "downloadApk",
        { url: info.apkDownloadUrl }
      )
      this.lastDownloadedApkPath = result.path
    } finally {
      await listener.remove()
    }
  }

  async installDownloadedApk(): Promise<void> {
    if (!this.lastDownloadedApkPath) throw new Error("No APK downloaded")
    await invokeNativeCapability("native.files", "installApk", {
      path: this.lastDownloadedApkPath,
    })
  }

  async clearApkCache(): Promise<void> {
    await invokeNativeCapability("native.files", "clearDirectory")
    this.lastDownloadedApkPath = null
  }

  /** Releases the in-memory APK path; the plugin calls this on disposal. */
  dispose(): void {
    this.lastDownloadedApkPath = null
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
    candidates: UpdateCandidate[]
  ): Promise<UpdateCandidate | undefined> {
    const installed = await App.getInfo()
    const installedBuild = Number(installed.build)
    const sorted = candidates
      .filter(
        (candidate) =>
          typeof candidate.apkVersionCode === "number" &&
          candidate.apkVersionCode > installedBuild
      )
      .sort((a, b) => (a.apkVersionCode ?? 0) - (b.apkVersionCode ?? 0))
    return sorted[sorted.length - 1]
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? this.memory.get(key) ?? null
    } catch {
      return this.memory.get(key) ?? null
    }
  }

  private write(key: string, value: string): void {
    this.memory.set(key, value)
    try {
      this.storage?.setItem(key, value)
    } catch {
      // The in-memory cooldown still prevents repeated automatic checks.
    }
  }
}
