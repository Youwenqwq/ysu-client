import type { StateStorage } from "zustand/middleware"

/** Browser localStorage with no-op persistence during Next.js SSR/SSG. */
export const localStorageAdapter: StateStorage = {
  getItem: (name) => {
    if (typeof window === "undefined") return null
    return window.localStorage.getItem(name)
  },
  setItem: (name, value) => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(name, value)
  },
  removeItem: (name) => {
    if (typeof window === "undefined") return
    window.localStorage.removeItem(name)
  },
}
