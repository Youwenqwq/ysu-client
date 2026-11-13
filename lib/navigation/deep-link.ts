import { pluginPageHref } from "@ysu/plugin-sdk/ui"
import { CORE_DASHBOARD_FALLBACK_HREF, resolveSemanticTarget } from "../plugins/navigation"
import type { SemanticNavSources } from "../plugins/navigation"

/**
 * Map a `ysuclient://` host to the semantic id of the destination page. The ids
 * are core-owned and stable; the concrete plugin page is resolved at runtime.
 */
const NOTIFICATION_DESTINATIONS: Record<string, string> = {
  grades: "grades",
  exams: "exams",
  schedule: "schedule",
}

export function notificationDestination(url: string, sources?: SemanticNavSources): string | null {
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== "ysuclient:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      parsed.search ||
      parsed.hash
    ) {
      return null
    }
    if (parsed.host === "settings") return "/dashboard/me/settings"
    const semanticId = NOTIFICATION_DESTINATIONS[parsed.host]
    if (!semanticId) return null
    // URL parsing stays semantic until a live registry is available.
    if (!sources) return `/dashboard/plugin/?route=${encodeURIComponent(semanticId)}`
    const target = resolveSemanticTarget(semanticId, sources)
    return target ? pluginPageHref(target.pluginId, target.pageId) : CORE_DASHBOARD_FALLBACK_HREF
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
