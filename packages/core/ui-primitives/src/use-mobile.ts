import * as React from "react"

export const MOBILE_BREAKPOINT_QUERY = "(max-width: 767px)"

/**
 * Viewport mobile breakpoint hook synchronized via `useSyncExternalStore` so
 * parent and child components never observe mismatched desktop/mobile states
 * within a single React commit.
 */
export function useIsMobile(): boolean {
  return React.useSyncExternalStore(
    (callback) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => {}
      }
      const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY)
      mql.addEventListener("change", callback)
      return () => mql.removeEventListener("change", callback)
    },
    () =>
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches
        : false,
    () => false
  )
}
