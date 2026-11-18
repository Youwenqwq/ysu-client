import type { PluginNavigationService } from "./navigation"
import { pluginPageHref } from "./router"

/**
 * Maps an `<scheme>://<route>` notification URL to any semantic route
 * registered by a plugin via `PluginNavigationService`.
 */
export function notificationDestination(
  url: string,
  navigation: Pick<PluginNavigationService, "resolve" | "sources">,
  scheme: string
): string | null {
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== `${scheme}:` ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash
    ) {
      return null
    }
    const route = parsed.host
    if (!route) return null
    const target = navigation.resolve(route)
    return target
      ? pluginPageHref(target.pluginId, target.pageId)
      : (navigation.sources().fallbackHref ?? null)
  } catch {
    return null
  }
}

export function isCurrentNotificationDestination(
  pathname: string,
  search: string,
  destination: string
): boolean {
  const target = new URL(destination, "https://local.invalid")
  const normalize = (path: string) => path.replace(/\/+$/, "")
  return normalize(pathname) === normalize(target.pathname) && search === target.search
}
