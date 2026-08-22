import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { SkbirdClient, generateDeviceId } from "./client";
import { secureStorage } from "@/lib/storage/secure";
import { STORAGE_KEYS } from "@/lib/storage/keys";

/**
 * 森空鸟配置。token 来源于 App 抓包（微信登录无法脚本化），过期后需手动更新。
 * deviceId 首次启动随机生成并持久化（与 App 格式一致）。与教务 auth store 完全独立。
 */
interface SkbirdState {
  token: string;
  deviceId: string;
  /** 校区别名（多租户），默认 ysu */
  alias: string;
  hasHydrated: boolean;
  setConfig: (config: { token: string; deviceId: string; alias: string }) => void;
  setHasHydrated: (v: boolean) => void;
}

export const useSkbirdStore = create<SkbirdState>()(
  persist(
    (set) => ({
      token: "",
      deviceId: generateDeviceId(),
      alias: "ysu",
      hasHydrated: false,
      setConfig: ({ token, deviceId, alias }) =>
        set({
          token: token.trim(),
          deviceId: deviceId.trim() || generateDeviceId(),
          alias: alias.trim() || "ysu",
        }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: STORAGE_KEYS.skbird,
      storage: createJSONStorage(() => secureStorage),
      partialize: (s) => ({ token: s.token, deviceId: s.deviceId, alias: s.alias }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

/** 按当前配置构造客户端；未配置 token 时返回 null */
export function getSkbirdClient(): SkbirdClient | null {
  const { token, deviceId, alias } = useSkbirdStore.getState();
  if (!token) return null;
  return new SkbirdClient({ token, deviceId, alias });
}
