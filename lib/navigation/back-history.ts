import { pluginPageHref } from "@orahako/plugin-sdk/ui"
import { usePluginRouteStore } from "../stores/plugin-route"

const DEPTH_KEY = "__academicBackDepth"

type AppHistory = Pick<History, "state" | "pushState" | "replaceState">

export function appHistoryDepth(history: AppHistory): number {
  const depth: unknown = history.state?.[DEPTH_KEY]
  return typeof depth === "number" && Number.isSafeInteger(depth) && depth >= 0 ? depth : 0
}

/** Mark only entries owned by this app; history.length can include another origin or forward entries. */
export function installBackHistory(history: AppHistory): () => void {
  const pushState = history.pushState
  const replaceState = history.replaceState
  let active = true
  const withDepth = (state: unknown, depth: number) => ({
    ...(state && typeof state === "object" ? state : {}),
    [DEPTH_KEY]: depth,
  })
  replaceState.call(history, withDepth(history.state, appHistoryDepth(history)), "")
  const push: History["pushState"] = function (state, title, url) {
    pushState.call(
      history,
      active ? withDepth(state, appHistoryDepth(history) + 1) : state,
      title,
      url
    )
  }
  const replace: History["replaceState"] = function (state, title, url) {
    replaceState.call(
      history,
      active ? withDepth(state, appHistoryDepth(history)) : state,
      title,
      url
    )
  }
  history.pushState = push
  history.replaceState = replace
  return () => {
    active = false
    // Do not undo another owner's wrapper installed after ours.
    if (history.pushState === push) history.pushState = pushState
    if (history.replaceState === replace) history.replaceState = replaceState
  }
}

/**
 * Where the hardware back button lands when history is exhausted. `homeHref` is
 * the deterministic dashboard home (resolved by the caller from the live plugin
 * registry); `null` means exit the app.
 */
export function backFallback(pathname: string, homeHref: string | null): string | null {
  const path = pathname.replace(/\/+$/, "") || "/"
  if (path === "/dashboard" || path === "/login") return null
  if (path === "/dashboard/plugin") {
    const current = usePluginRouteStore.getState().current
    if (current) {
      const homePageId = current.parent ?? "index"
      const isHome = current.pageId === homePageId && current.primary === true
      if (isHome) return null
      if (current.pageId === homePageId) return homeHref
      return pluginPageHref(current.pluginId, homePageId)
    }
    return homeHref
  }
  if (path.startsWith("/dashboard/me/settings/")) return "/dashboard/me/settings"
  if (path.startsWith("/dashboard/me/")) return "/dashboard/me"
  return homeHref
}
