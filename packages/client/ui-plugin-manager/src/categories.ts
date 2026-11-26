import type { PluginKind } from "@orahako/sdk"

export type PluginCategory = "provider" | "academic" | "toybox" | "system" | "appearance"

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
    plugin.kind === "runtime" ||
    plugin.kind === "shell" ||
    plugin.required ||
    plugin.categories?.includes("system")
  ) {
    return "system"
  }
  if (
    plugin.kind === "theme" ||
    plugin.categories?.includes("appearance") ||
    plugin.categories?.includes("theme")
  ) {
    return "appearance"
  }
  if (plugin.categories?.includes("toybox")) {
    return "toybox"
  }
  return "academic"
}

const CATEGORY_ORDER: readonly PluginCategory[] = [
  "provider",
  "academic",
  "toybox",
  "system",
  "appearance",
]

export function groupByPluginCategory<T extends PluginCategoryInput>(
  plugins: readonly T[]
): Array<{ readonly id: PluginCategory; readonly plugins: T[] }> {
  return CATEGORY_ORDER.flatMap((id) => {
    const matching = plugins.filter((plugin) => pluginCategory(plugin) === id)
    return matching.length > 0 ? [{ id, plugins: matching }] : []
  })
}
