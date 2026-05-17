import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { App } from "@capacitor/app";
import { APP_VERSION } from "./version";

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

const OFFICIAL_BASE = "https://ysu.welain.com/updates/";
const GITHUB_RELEASE_BASE =
  "https://github.com/Youwenqwq/ysu-client/releases/latest/download";
const ASSET_NAME = "dist.zip";
const VERSION_JSON_NAME = "version.json";
const APK_NAME = "app-release.apk";
const LAST_CHECK_KEY = "ysu-last-update-check";
const CHECK_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

export const UPDATE_MIRRORS: readonly UpdateMirror[] = [
  { label: "官方源", value: OFFICIAL_BASE },
  { label: "GitHub 直连", value: "" },
  { label: "ghproxy.com", value: "https://ghproxy.com/" },
  { label: "ghfast.top", value: "https://ghfast.top/" },
];

/** Compare two semver strings (major.minor.patch). Returns true if target > current. */
export function isNewer(current: string, target: string): boolean {
  const c = current.split(".").map(Number);
  const t = target.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((t[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((t[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
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

function getApkUrl(mirrorPrefix: string, githubUrl: string): string {
  if (isOfficialSource(mirrorPrefix)) {
    return `${OFFICIAL_BASE}${APK_NAME}`;
  }
  if (!mirrorPrefix) {
    return githubUrl;
  }
  return `${mirrorPrefix}${githubUrl}`;
}

/** Check for a newer version. Respects 30-min cooldown when `auto` is true. */
export async function checkForUpdate(
  auto = false,
  mirrorPrefix = "",
): Promise<UpdateInfo> {
  if (auto) {
    const last = localStorage.getItem(LAST_CHECK_KEY);
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

    const data = await res.json() as {
      webVersion?: string;
      apkVersionCode?: number;
      apkDownloadUrl?: string;
      body?: string;
    };
    const version = data.webVersion ?? "";
    if (!version) {
      return EMPTY_RESULT;
    }

    if (auto) {
      localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
    }

    const result: UpdateInfo = {
      available: isNewer(APP_VERSION, version),
      version,
      downloadUrl: distZipUrl,
      body: data.body ?? "",
      apkUpdateAvailable: false,
      apkDownloadUrl: "",
    };

    if (typeof data.apkVersionCode === "number") {
      const installed = await App.getInfo();
      if (data.apkVersionCode > Number(installed.build)) {
        result.apkUpdateAvailable = true;
        result.apkDownloadUrl = data.apkDownloadUrl
          ? getApkUrl(mirrorPrefix, data.apkDownloadUrl)
          : "";
        // If APK needs update, web update is moot — force APK-only flow
        if (result.apkUpdateAvailable && result.available) {
          result.available = false;
        }
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
