import { pluginPageHref } from "@orahako/plugin-sdk/ui"
import type { PluginNavigationService } from "@orahako/plugin-sdk"

/**
 * Map an `orahako://` host to any semantic route registered by a plugin. The
 * route is resolved through the navigation service when available; unknown
 * hosts stay semantic until a live registry can resolve them.
 */
export function notificationDestination(
  url: string,
  navigation: PluginNavigationService,
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
