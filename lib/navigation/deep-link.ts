import { pluginPageHref } from "@ysu/plugin-sdk"

export function notificationDestination(url: string): string | null {
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
    switch (parsed.host) {
      case "grades":
        return pluginPageHref("ysu.grades", "index")
      case "exams":
        return pluginPageHref("ysu.exams", "index")
      case "schedule":
        return pluginPageHref("ysu.schedule", "index")
      case "settings":
        return "/dashboard/me/settings"
      default:
        return null
    }
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
