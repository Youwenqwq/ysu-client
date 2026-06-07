"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/stores/auth";
import { startNotifyIfNeeded, stopNotify } from "@/lib/native/notify";
import { isCapacitor } from "@/lib/native/platform";
import { useProvider } from "@/providers/use-provider";

/**
 * 启动成绩/考试通知轮询。
 * 在 SDK 初始化完成后挂载，仅 Capacitor 平台生效。
 */
export function NotifyProvider() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const provider = useProvider();
  const nativeNotification = provider.nativeNotification;

  useEffect(() => {
    if (!isCapacitor() || !isAuthenticated || !nativeNotification) return;
    startNotifyIfNeeded(nativeNotification);
    return () => {
      stopNotify();
    };
  }, [isAuthenticated, nativeNotification]);

  return null;
}
