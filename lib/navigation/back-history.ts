import { pluginPageHref } from "@ysu/plugin-sdk"
import { usePluginRouteStore } from "@/lib/stores/plugin-route"

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

export function backFallback(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/"
  if (path === "/dashboard" || path === "/login") return null
  if (path === "/dashboard/plugin") {
    const current = usePluginRouteStore.getState().current
    if (current?.pluginId === "ysu.overview" && current.pageId === "index") return null
    return current?.parent
      ? pluginPageHref(current.pluginId, current.parent)
      : pluginPageHref("ysu.overview", "index")
  }
  if (path.startsWith("/dashboard/me/settings/")) return "/dashboard/me/settings"
  if (path.startsWith("/dashboard/me/")) return "/dashboard/me"
  return pluginPageHref("ysu.overview", "index")
}
