import type { ObservableSource } from "./observable"

export type RouteParams = Readonly<Record<string, string>>

export type RouteParamInput = Readonly<Record<string, string | number | undefined>>

export type RouteTargetInput =
  | string
  | {
      readonly route: string
      readonly params?: RouteParamInput
    }
  | {
      readonly pluginId: string
      readonly pageId?: string
      readonly params?: RouteParamInput
    }

export interface RouteLocation {
  readonly pathname: string
  readonly search: string
  readonly href: string
  readonly route?: string
  readonly pluginId?: string
  readonly pageId?: string
  readonly params: RouteParams
}

export type RouterBackGuard = () => boolean | Promise<boolean>

export interface PluginRouterService {
  readonly current: ObservableSource<RouteLocation>
  push(target: RouteTargetInput): void
  replace(target: RouteTargetInput): void
  back(): void
  href(target: RouteTargetInput): string
  registerBackGuard(guard: RouterBackGuard): () => void
}

export function withAppBasePath(path: string, basePath = ""): string {
  if (!basePath || !path.startsWith("/")) return path
  return `${basePath}${path}`
}

export function pluginPageHref(
  pluginId: string,
  pageId = "index",
  params?: RouteParamInput
): string {
  const search = new URLSearchParams({ plugin: pluginId, page: pageId })
  for (const [key, value] of Object.entries(params ?? {})) {
    if (key === "plugin" || key === "page" || key === "route") continue
    if (value !== undefined) search.set(key, String(value))
  }
  return `/?${search.toString()}`
}

export function semanticRouteHref(route: string, params?: RouteParamInput): string {
  const search = new URLSearchParams({ route })
  for (const [key, value] of Object.entries(params ?? {})) {
    if (key === "route" || key === "plugin" || key === "page") continue
    if (value !== undefined) search.set(key, String(value))
  }
  return `/?${search.toString()}`
}

export function formatRouteHref(target: RouteTargetInput, basePath?: string): string {
  if (typeof target === "string") {
    if (target.startsWith("/") || target.startsWith("?")) {
      const normalized = target.startsWith("?") ? `/${target}` : target
      return withAppBasePath(normalized, basePath)
    }
    return withAppBasePath(semanticRouteHref(target), basePath)
  }
  if ("route" in target) {
    return withAppBasePath(semanticRouteHref(target.route, target.params), basePath)
  }
  return withAppBasePath(
    pluginPageHref(target.pluginId, target.pageId ?? "index", target.params),
    basePath
  )
}

export function parseRouteLocation(urlOrHref: string): RouteLocation {
  const parsed = new URL(urlOrHref, "https://local.invalid")
  const params: Record<string, string> = {}
  parsed.searchParams.forEach((value, key) => {
    if (key !== "route" && key !== "plugin" && key !== "page") {
      params[key] = value
    }
  })
  const route = parsed.searchParams.get("route") ?? undefined
  const pluginId = parsed.searchParams.get("plugin") ?? undefined
  const pageId = parsed.searchParams.get("page") ?? (pluginId ? "index" : undefined)
  const pathname = parsed.pathname || "/"
  const search = parsed.search
  return {
    pathname,
    search,
    href: `${pathname}${search}`,
    ...(route !== undefined ? { route } : {}),
    ...(pluginId !== undefined ? { pluginId } : {}),
    ...(pageId !== undefined ? { pageId } : {}),
    params,
  }
}
