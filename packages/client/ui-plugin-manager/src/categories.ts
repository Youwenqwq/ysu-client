import type { PluginKind } from "@orahako/sdk"

export type PluginCategory = "appearance" | "toybox" | "academic" | "provider" | "system"

export interface PluginCategoryInput {
  readonly kind?: PluginKind
  readonly required?: boolean
  readonly categories?: readonly string[]
}

export function pluginCategory(plugin: PluginCategoryInput): PluginCategory {
  if (plugin.kind === "provider" || plugin.categories?.includes("provider")) {
    return "provider"
  }
  if (
    plugin.kind === "theme" ||
    plugin.kind === "shell" ||
    plugin.categories?.includes("appearance") ||
    plugin.categories?.includes("theme") ||
    plugin.categories?.includes("shell")
  ) {
    return "appearance"
  }
  if (
    plugin.kind === "runtime" ||
    plugin.required ||
    plugin.categories?.includes("system")
  ) {
    return "system"
  }
  if (plugin.categories?.includes("toybox")) {
    return "toybox"
  }
  return "academic"
}

const CATEGORY_ORDER: readonly PluginCategory[] = [
  "appearance",
  "toybox",
  "academic",
  "provider",
  "system",
]

export function groupByPluginCategory<T extends PluginCategoryInput>(
  plugins: readonly T[]
): Array<{ readonly id: PluginCategory; readonly plugins: T[] }> {
  return CATEGORY_ORDER.flatMap((id) => {
    const matching = plugins.filter((plugin) => pluginCategory(plugin) === id)
    return matching.length > 0 ? [{ id, plugins: matching }] : []
  })
}
