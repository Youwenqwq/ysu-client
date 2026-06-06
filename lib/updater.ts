import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { App } from "@capacitor/app";
import { registerPlugin } from "@capacitor/core";
import { clean, compare, gt, prerelease, valid } from "semver";
import { APP_VERSION } from "./version";

export type UpdateChannel = "stable" | "prerelease";

export interface UpdateInfo {
  available: boolean;
  version: string;
  downloadUrl: string;
  body: string;
  apkUpdateAvailable: boolean;
  apkDownloadUrl: string;
}

export interface UpdateMirror {
  label: string;
  value: string;
}

interface VersionManifestEntry {
  webVersion?: string;
  webDownloadUrl?: string;
  apkVersionCode?: number;
  apkDownloadUrl?: string;
  body?: string;
}

interface VersionManifest extends VersionManifestEntry {
  channels?: Partial<Record<UpdateChannel, VersionManifestEntry>>;
}

interface UpdateCandidate extends VersionManifestEntry {
  webVersion: string;
  normalizedVersion: string;
}

const OFFICIAL_BASE = "https://ysu.welain.com/updates/";
const GITHUB_RELEASE_BASE =
  "https://github.com/Youwenqwq/ysu-client/releases/latest/download";
const ASSET_NAME = "dist.zip";
const VERSION_JSON_NAME = "version.json";
const APK_NAME = "app-release.apk";
const LAST_CHECK_KEY = "ysu-last-update-check";
const CHECK_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
export const OTA_CLEANUP_FLAG = "ysu-ota-cleanup";

export const UPDATE_MIRRORS: readonly UpdateMirror[] = [
  { label: "官方源", value: OFFICIAL_BASE },
  { label: "GitHub 直连", value: "" },
];

function normalizeVersion(version: string): string | null {
  const trimmed = version.trim();
  return valid(trimmed) ?? clean(trimmed) ?? null;
}

function isAllowedTarget(version: string, channel: UpdateChannel): boolean {
  return channel === "prerelease" || prerelease(version) === null;
}

/** Compare two semver strings. Returns true if target > current for the channel. */
export function isNewer(
  current: string,
  target: string,
  channel: UpdateChannel = "stable",
): boolean {
  const currentVersion = normalizeVersion(current);
  const targetVersion = normalizeVersion(target);
  if (!currentVersion || !targetVersion) return false;
  if (!isAllowedTarget(targetVersion, channel)) return false;
  return gt(targetVersion, currentVersion);
}

const EMPTY_RESULT: UpdateInfo = {
  available: false,
  version: "",
  downloadUrl: "",
  body: "",
  apkUpdateAvailable: false,
  apkDownloadUrl: "",
};

function isOfficialSource(prefix: string): boolean {
  return prefix === OFFICIAL_BASE;
}

function getVersionJsonUrl(mirrorPrefix: string): string {
  if (isOfficialSource(mirrorPrefix)) {
    return `${OFFICIAL_BASE}${VERSION_JSON_NAME}`;
  }
  if (!mirrorPrefix) {
    return `${GITHUB_RELEASE_BASE}/${VERSION_JSON_NAME}`;
  }
  return `${mirrorPrefix}${GITHUB_RELEASE_BASE}/${VERSION_JSON_NAME}`;
}

function getDistZipUrl(mirrorPrefix: string): string {
  if (isOfficialSource(mirrorPrefix)) {
    return `${OFFICIAL_BASE}${ASSET_NAME}`;
  }
  if (!mirrorPrefix) {
    return `${GITHUB_RELEASE_BASE}/${ASSET_NAME}`;
  }
  return `${mirrorPrefix}${GITHUB_RELEASE_BASE}/${ASSET_NAME}`;
}

function getWebDownloadUrl(
  mirrorPrefix: string,
  webDownloadUrl: string | undefined,
  fallbackUrl: string,
): string {
  if (!webDownloadUrl) return fallbackUrl;
  if (mirrorPrefix && !isOfficialSource(mirrorPrefix) && webDownloadUrl.startsWith("https://github.com/")) {
    return `${mirrorPrefix}${webDownloadUrl}`;
  }
  return webDownloadUrl;
}

function getApkUrl(mirrorPrefix: string, githubUrl: string): string {
  if (isOfficialSource(mirrorPrefix)) {
    return `${OFFICIAL_BASE}${APK_NAME}`;
  }
  if (!mirrorPrefix) {
    return githubUrl;
  }
  return `${mirrorPrefix}${githubUrl}`;
}

function toTopLevelEntry(data: VersionManifest): VersionManifestEntry {
  return {
    webVersion: data.webVersion,
    webDownloadUrl: data.webDownloadUrl,
    apkVersionCode: data.apkVersionCode,
    apkDownloadUrl: data.apkDownloadUrl,
    body: data.body,
  };
}

function getChannelCandidates(
  data: VersionManifest,
  channel: UpdateChannel,
): UpdateCandidate[] {
  const topLevel = toTopLevelEntry(data);
  const stable = data.channels?.stable
    ? { ...topLevel, ...data.channels.stable }
    : topLevel;
  const entries = channel === "stable"
    ? [stable]
    : [stable, data.channels?.prerelease];

  return entries.flatMap((entry) => {
    if (!entry?.webVersion) return [];
    const normalizedVersion = normalizeVersion(entry.webVersion);
    if (!normalizedVersion || !isAllowedTarget(normalizedVersion, channel)) {
      return [];
    }
    return [{ ...entry, webVersion: entry.webVersion, normalizedVersion }];
  });
}

function getHighestVersionCandidate(candidates: UpdateCandidate[]): UpdateCandidate | undefined {
  const sorted = [...candidates].sort((a, b) =>
    compare(a.normalizedVersion, b.normalizedVersion),
  );
  return sorted[sorted.length - 1];
}

async function getApkUpdateCandidate(
  candidates: UpdateCandidate[],
): Promise<UpdateCandidate | undefined> {
  const installed = await App.getInfo();
  const installedBuild = Number(installed.build);
  const sorted = candidates
    .filter(
      (candidate) =>
        typeof candidate.apkVersionCode === "number" &&
        candidate.apkVersionCode > installedBuild,
    )
    .sort((a, b) => (a.apkVersionCode ?? 0) - (b.apkVersionCode ?? 0));
  return sorted[sorted.length - 1];
}

/** Check for a newer version. Respects 30-min cooldown when `auto` is true. */
export async function checkForUpdate(
  auto = false,
  mirrorPrefix = OFFICIAL_BASE,
  channel: UpdateChannel = "stable",
): Promise<UpdateInfo> {
  if (auto) {
    const last = localStorage.getItem(`${LAST_CHECK_KEY}:${channel}`);
    if (last && Date.now() - Number(last) < CHECK_COOLDOWN_MS) {
      return EMPTY_RESULT;
    }
  }

  const versionJsonUrl = getVersionJsonUrl(mirrorPrefix);
  const distZipUrl = getDistZipUrl(mirrorPrefix);

  try {
    const res = await fetch(versionJsonUrl);

    if (res.status === 403) {
      throw new Error("RATE_LIMIT");
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json() as VersionManifest;
    const candidates = getChannelCandidates(data, channel);
    if (!candidates.length) {
      return EMPTY_RESULT;
    }

    if (auto) {
      localStorage.setItem(`${LAST_CHECK_KEY}:${channel}`, String(Date.now()));
    }

    const webUpdateCandidate = getHighestVersionCandidate(
      candidates.filter((candidate) =>
        isNewer(APP_VERSION, candidate.webVersion, channel),
      ),
    );
    const displayCandidate = webUpdateCandidate ?? getHighestVersionCandidate(candidates);
    if (!displayCandidate) {
      return EMPTY_RESULT;
    }

    const result: UpdateInfo = {
      available: Boolean(webUpdateCandidate),
      version: displayCandidate.webVersion,
      downloadUrl: getWebDownloadUrl(
        mirrorPrefix,
        displayCandidate.webDownloadUrl,
        distZipUrl,
      ),
      body: displayCandidate.body ?? "",
      apkUpdateAvailable: false,
      apkDownloadUrl: "",
    };

    const apkUpdateCandidate = await getApkUpdateCandidate(candidates);
    if (apkUpdateCandidate) {
      result.version = apkUpdateCandidate.webVersion;
      result.body = apkUpdateCandidate.body ?? "";
      result.apkUpdateAvailable = true;
      result.apkDownloadUrl = apkUpdateCandidate.apkDownloadUrl
        ? getApkUrl(mirrorPrefix, apkUpdateCandidate.apkDownloadUrl)
        : "";
      // If APK needs update, web update is moot — force APK-only flow
      if (result.available) {
        result.available = false;
      }
    }

    return result;
  } catch (err) {
    if (auto) return EMPTY_RESULT;
    throw err;
  }
}

/** Download the update bundle and set it as the next active bundle. */
export async function downloadAndApply(
  info: UpdateInfo,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const listener = await CapacitorUpdater.addListener("download", (state) => {
    onProgress?.(state.percent);
  });

  try {
    const bundle = await CapacitorUpdater.download({
      url: info.downloadUrl,
      version: info.version,
    });
    await CapacitorUpdater.next({ id: bundle.id });
    // 标记需要清理旧 OTA 版本，由下次 initSDK 执行
    localStorage.setItem(OTA_CLEANUP_FLAG, "1");
  } finally {
    await listener.remove();
  }
}

/** Immediately apply the pending bundle and restart the app. */
export async function applyAndRestart(): Promise<void> {
  await CapacitorUpdater.reload();
}

/** Reset to the original bundled assets (emergency rollback). */
export async function resetToBuiltin(): Promise<void> {
  await CapacitorUpdater.reset();
}

/** Open APK download URL in browser for system download & install. */
export function openApkDownload(url: string): void {
  window.open(url, "_system");
}

// ---------------------------------------------------------------------------
// In-app APK download via native YsuFile plugin
// ---------------------------------------------------------------------------

interface YsuFilePlugin {
  downloadApk(options: { url: string; fileName?: string }): Promise<{ path: string }>;
  installApk(options: { path: string }): Promise<void>;
  clearDirectory(options: { path?: string }): Promise<void>;
  addListener(eventName: "downloadProgress", listener: (state: { percent: number }) => void): Promise<{ remove: () => void }>;
}

const YsuFile = registerPlugin<YsuFilePlugin>("YsuFile");

/** Path of the last successfully downloaded APK (kept in module scope). */
let lastDownloadedApkPath: string | null = null;

/** Download APK to app cache directory (with progress callback). */
export async function downloadApkInApp(
  info: UpdateInfo,
  onProgress?: (percent: number) => void,
): Promise<void> {
  if (!info.apkDownloadUrl) {
    throw new Error("No APK download URL");
  }

  const listener = await YsuFile.addListener("downloadProgress", (state) => {
    onProgress?.(state.percent);
  });

  try {
    const result = await YsuFile.downloadApk({ url: info.apkDownloadUrl });
    lastDownloadedApkPath = result.path;
  } finally {
    await listener.remove();
  }
}

/** Launch system installer for the previously downloaded APK. */
export async function installDownloadedApk(): Promise<void> {
  if (!lastDownloadedApkPath) {
    throw new Error("No APK downloaded");
  }
  await YsuFile.installApk({ path: lastDownloadedApkPath });
}

/** Clear the APK cache directory. */
export async function clearApkCache(): Promise<void> {
  await YsuFile.clearDirectory({});
  lastDownloadedApkPath = null;
}
