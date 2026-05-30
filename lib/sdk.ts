/**
 * SDK 初始化层 —— CAS / JWXT / jwmobile 模块状态管理。
 *
 * 从 auth-store 加载/保存凭据,提供状态恢复与重置。
 */
import {
  CASCredential,
  restoreCredential,
  resetCAS,
  restoreCASCookies,
  logoutCAS,
  getJar as getCasJar,
} from "./cas";
import {
  JWXTSession,
  restoreSession as restoreJWXTSession,
  resetJWXT,
  getJar as getJwxtJar,
} from "./jwxt";
import {
  MobileSession,
  restoreSession as restoreMobileSession,
  resetMobileAuth,
  getJar as getMobileJar,
} from "./jwmobile";
import { useAuthStore } from "./auth-store";
import { initServerConfig } from "./server-config";
import { clearAllCache, cleanStaleCacheVersions } from "./cache";
import { useRefreshStore } from "./refresh-store";
import { isCapacitor } from "./platform";
import { stopNotify } from "./notify";
import { removeCASTGC } from "./secure-storage";

/** 从 auth-store 恢复 CAS 凭据、JWXT 会话和 mobile 会话到各自的 jar。 */
export async function initSDK(): Promise<void> {
  // 从 settings-store 初始化自定义服务器地址
  initServerConfig();
  // 清理因 credential 轮换产生的孤立缓存
  cleanStaleCacheVersions();
  // OTA 更新后清理旧版本和下载缓存，仅当 updater 设置了标志位时才执行
  if (localStorage.getItem("ysu-ota-cleanup")) {
    localStorage.removeItem("ysu-ota-cleanup");
    cleanOtaArtifacts();
  }
  // Restore CASTGC to CapacitorHttp system cookie store (for native platforms)
  await restoreCASCookies();

  const { credential, jwxtSession, mobileSession } = useAuthStore.getState();
  if (credential) {
    const casCredential = CASCredential.fromJSON(credential);
    await restoreCredential(casCredential);
  }
  if (jwxtSession) {
    try {
      const session = JWXTSession.fromJSON(jwxtSession);
      if (!session.isEmpty()) {
        await restoreJWXTSession(session);
      }
    } catch {
      // 无效的 JWXT session,忽略
    }
  }
  if (mobileSession) {
    try {
      const session = MobileSession.fromJSON(mobileSession);
      if (!session.isEmpty()) {
        await restoreMobileSession(session);
      }
    } catch {
      // 无效的 mobile session,忽略
    }
  }
}

/** 将当前 JWXT jar 中的会话持久化到 auth-store。 */
export async function persistJWXTSession(): Promise<void> {
  const session = await JWXTSession.fromJar(getJwxtJar());
  if (!session.isEmpty()) {
    useAuthStore.getState().setJWXTSession(session.toJSON());
  }
}

/** 将当前 mobile jar 中的会话持久化到 auth-store。 */
export async function persistMobileSession(): Promise<void> {
  const session = await MobileSession.fromJar(getMobileJar());
  if (!session.isEmpty()) {
    useAuthStore.getState().setMobileSession(session.toJSON());
  }
}

/**
 * 清理 OTA 旧版本和下载临时文件。
 * 启动时执行，插件不在工作中，不存在文件句柄竞争。
 */
async function cleanOtaArtifacts(): Promise<void> {
  if (!isCapacitor()) return;

  // 清理旧 OTA 版本（手动模式下 autoDeletePrevious 不生效）
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    const [{ bundles }, current] = await Promise.all([
      CapacitorUpdater.list(),
      CapacitorUpdater.current(),
    ]);
    for (const b of bundles) {
      if (b.id === "builtin" || b.id === current.bundle.id) continue;
      await CapacitorUpdater.delete({ id: b.id }).catch(() => {});
    }
  } catch {
    // 忽略
  }

  // 清理 OTA 下载缓存
  try {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    await Filesystem.rmdir({
      path: "capgo_downloads",
      directory: Directory.Cache,
      recursive: true,
    });
  } catch {
    // 目录不存在或无法删除，忽略
  }

  // 清理 APK 下载缓存
  try {
    const { clearApkCache } = await import("./updater");
    await clearApkCache();
  } catch {
    // 忽略
  }
}

/** 重置所有 SDK 状态(登出时调用)。 */
export function resetSDK(): void {
  void (async () => {
    try {
      await logoutCAS();
    } catch {
      // 忽略 CAS 服务端登出失败
    } finally {
      await removeCASTGC().catch(() => {});
    }
  })();
  resetCAS();
  resetJWXT();
  resetMobileAuth();
  clearAllCache();
  useRefreshStore.setState({ count: 0, stale: 0 });
  // Stop all notification services on logout
  stopNotify();
}

/** 获取 CAS cookie jar(调试用)。 */
export { getCasJar };
/** 获取 JWXT cookie jar(调试用)。 */
export { getJwxtJar };
/** 获取 mobile cookie jar(调试用)。 */
export { getMobileJar };
