import type { PluginKind } from "@orahako/plugin-sdk"

export type PluginCategory = "provider" | "academic" | "toybox" | "system" | "appearance"

export interface PluginCategoryInput {
  kind?: PluginKind
  required?: boolean
  categories?: readonly string[]
}

export function pluginCategory(plugin: PluginCategoryInput): PluginCategory {
  if (plugin.kind === "provider" || plugin.categories?.includes("provider")) return "provider"
  if (plugin.kind === "shell" || plugin.required || plugin.categories?.includes("system"))
    return "system"
  if (
    plugin.kind === "theme" ||
    plugin.categories?.includes("appearance") ||
    plugin.categories?.includes("theme")
  )
    return "appearance"
  if (plugin.categories?.includes("toybox")) return "toybox"
  return "academic"
}

export function groupByPluginCategory<T extends PluginCategoryInput>(
  plugins: readonly T[]
): Array<{ id: PluginCategory; plugins: T[] }> {
  const order: PluginCategory[] = ["provider", "academic", "toybox", "system", "appearance"]
  return order.flatMap((id) => {
    const matching = plugins.filter((plugin) => pluginCategory(plugin) === id)
    return matching.length > 0 ? [{ id, plugins: matching }] : []
  })
}
