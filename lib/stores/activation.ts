import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import { secureStorage } from "../storage/secure"
import { STORAGE_KEYS } from "../storage/keys"

/**
 * Web 端激活态。token 即激活凭证本身（单共享 token 模型），
 * 由 /api/activate 验证后持久化；/api/proxy 返回 403
 * ACTIVATION_REQUIRED 时（token 被轮换）清除，ActivationGate 随之回落。
 * Native（Capacitor）不使用本 store。
 */
interface ActivationState {
  token: string | null
  hasHydrated: boolean
  setToken: (token: string) => void
  clearToken: () => void
  setHasHydrated: (v: boolean) => void
}

export const useActivationStore = create<ActivationState>()(
  persist(
    (set) => ({
      token: null,
      hasHydrated: false,
      setToken: (token) => set({ token }),
      clearToken: () => set({ token: null }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: STORAGE_KEYS.activation,
      storage: createJSONStorage(() => secureStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true)
      },
    }
  )
)
