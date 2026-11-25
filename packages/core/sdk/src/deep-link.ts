import type { PluginNavigationService } from "./navigation"
import { pluginPageHref } from "./router"

/**
 * Extracts the semantic route name from an `<scheme>://<route>` deep link URL.
 * Returns `null` when the URL does not match `scheme` or carries unexpected
 * authority, path, query, or fragment components.
 */
export function parseDeepLinkRoute(url: string, scheme: string): string | null {
  const normalizedScheme = scheme.trim().toLowerCase()
  if (!normalizedScheme) return null
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== `${normalizedScheme}:` ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash
    ) {
      return null
    }
    return parsed.host || null
  } catch {
    return null
  }
}

/**
 * Maps an `<scheme>://<route>` notification URL to any semantic route
 * registered by a plugin via `PluginNavigationService`.
 */
export function notificationDestination(
  url: string,
  navigation: Pick<PluginNavigationService, "resolve" | "sources">,
  scheme: string
): string | null {
  const route = parseDeepLinkRoute(url, scheme)
  if (!route) return null
  const target = navigation.resolve(route)
  return target
    ? pluginPageHref(target.pluginId, target.pageId)
    : (navigation.sources().fallbackHref ?? null)
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
