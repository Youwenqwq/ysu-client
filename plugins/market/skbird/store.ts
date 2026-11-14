import { useEffect } from "react"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import { SkbirdClient, generateDeviceId } from "./client"
import { secureStorage } from "@orahako/plugin-ui/stores"
import { STORAGE_KEYS } from "@orahako/plugin-ui/stores"
/**
 * 森空鸟配置。token 来源于 App 抓包（微信登录无法脚本化），过期后需手动更新。
 * deviceId 首次启动随机生成并持久化（与 App 格式一致）。与教务 auth store 完全独立。
 */
interface SkbirdState {
  token: string
  deviceId: string
  /** 校区别名（多租户），默认 ysu */
  alias: string
  hasHydrated: boolean
  unreadCount: number
  setConfig: (config: { token: string; deviceId: string; alias: string }) => void
  setHasHydrated: (v: boolean) => void
  setUnreadCount: (count: number) => void
}

export const useSkbirdStore = create<SkbirdState>()(
  persist(
    (set) => ({
      token: "",
      deviceId: generateDeviceId(),
      alias: "ysu",
      hasHydrated: false,
      unreadCount: 0,
      setConfig: ({ token, deviceId, alias }) =>
        set({
          token: token.trim(),
          deviceId: deviceId.trim() || generateDeviceId(),
          alias: alias.trim() || "ysu",
          unreadCount: 0,
        }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
      setUnreadCount: (unreadCount) => set({ unreadCount }),
    }),
    {
      name: STORAGE_KEYS.skbird,
      storage: createJSONStorage(() => secureStorage),
      partialize: (s) => ({
        token: s.token,
        deviceId: s.deviceId,
        alias: s.alias,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)

/** 按当前配置构造客户端；未配置 token 时返回 null */
export function getSkbirdClient(): SkbirdClient | null {
  const { token, deviceId, alias } = useSkbirdStore.getState()
  if (!token) return null
  return new SkbirdClient({ token, deviceId, alias })
}

let unreadRequest: Promise<void> | undefined

function refreshUnread() {
  if (unreadRequest) return unreadRequest
  const config = useSkbirdStore.getState()
  const client = getSkbirdClient()
  if (!client) {
    config.setUnreadCount(0)
    return Promise.resolve()
  }
  const request = client
    .unreadNum()
    .then((unread) => {
      const current = useSkbirdStore.getState()
      if (
        current.token === config.token &&
        current.deviceId === config.deviceId &&
        current.alias === config.alias
      ) {
        current.setUnreadCount(unread.count + unread.imCount)
      }
    })
    .catch(() => {})
  unreadRequest = request
  void request.finally(() => {
    if (unreadRequest === request) unreadRequest = undefined
  })
  return request
}

/** Share one unread snapshot between page actions and the mobile navigation badge. */
export function useSkbirdUnreadCount(): number {
  const token = useSkbirdStore((state) => state.token)
  const deviceId = useSkbirdStore((state) => state.deviceId)
  const alias = useSkbirdStore((state) => state.alias)
  const hasHydrated = useSkbirdStore((state) => state.hasHydrated)
  useEffect(() => {
    if (hasHydrated) void refreshUnread()
  }, [alias, deviceId, hasHydrated, token])
  return useSkbirdStore((state) => state.unreadCount)
}
