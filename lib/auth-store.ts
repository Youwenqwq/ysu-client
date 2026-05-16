import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { secureStorage } from "./secure-storage";

interface AuthState {
  credential: string | null;
  jwxtSession: string | null;
  mobileSession: string | null;
  username: string | null;
  isAuthenticated: boolean;
  hasHydrated: boolean;
  setCredential: (credential: string, username?: string) => void;
  setJWXTSession: (session: string) => void;
  setMobileSession: (session: string) => void;
  clearCredential: () => void;
  setHasHydrated: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      credential: null,
      jwxtSession: null,
      mobileSession: null,
      username: null,
      isAuthenticated: false,
      hasHydrated: false,
      setCredential: (credential, username) =>
        set({ credential, username, isAuthenticated: true }),
      setJWXTSession: (jwxtSession) => set({ jwxtSession }),
      setMobileSession: (mobileSession) => set({ mobileSession }),
      clearCredential: () =>
        set({
          credential: null,
          jwxtSession: null,
          mobileSession: null,
          username: null,
          isAuthenticated: false,
        }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: "ysu-auth",
      storage: createJSONStorage(() => secureStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
