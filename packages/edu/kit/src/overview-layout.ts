/** Dynamic widgets contributed by plugins: `plugin:<pluginId>:<widgetId>`. */
export type PluginOverviewWidgetId = `plugin:${string}:${string}`
export type OverviewWidgetId = PluginOverviewWidgetId
export type OverviewRegion = "summary" | "content"

/** The subset of a registered plugin widget the layout algorithms need. */
export interface DynamicOverviewWidget {
  id: PluginOverviewWidgetId
  region: OverviewRegion
  defaultVisible: boolean
}

export interface OverviewLayout {
  version: 1
  profileVisible: boolean
  items: { id: OverviewWidgetId; visible: boolean }[]
}

const PLUGIN_WIDGET_ID = /^plugin:[^:]+:.+$/

export function pluginOverviewWidgetId(pluginId: string, widgetId: string): PluginOverviewWidgetId {
  return `plugin:${pluginId}:${widgetId}`
}

export function isPluginOverviewWidgetId(value: unknown): value is PluginOverviewWidgetId {
  return typeof value === "string" && PLUGIN_WIDGET_ID.test(value)
}

export function isOverviewWidgetId(value: unknown): value is OverviewWidgetId {
  return isPluginOverviewWidgetId(value)
}

export function getOverviewWidgetRegion(
  id: OverviewWidgetId,
  dynamicWidgets: readonly DynamicOverviewWidget[] = []
): OverviewRegion | undefined {
  return dynamicWidgets.find((widget) => widget.id === id)?.region
}

export function createDefaultOverviewLayout(
  dynamicWidgets: readonly DynamicOverviewWidget[] = []
): OverviewLayout {
  return {
    version: 1,
    profileVisible: true,
    items: dynamicWidgets.map((widget) => ({
      id: widget.id,
      visible: widget.defaultVisible,
    })),
  }
}

export function normalizeOverviewLayout(
  value: unknown,
  dynamicWidgets: readonly DynamicOverviewWidget[] = []
): OverviewLayout {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("items" in value) ||
    !Array.isArray(value.items)
  ) {
    return createDefaultOverviewLayout(dynamicWidgets)
  }

  const seen = new Set<OverviewWidgetId>()
  const items: OverviewLayout["items"] = []
  for (const item of value.items) {
    if (typeof item !== "object" || item === null) continue
    const id: unknown = "id" in item ? item.id : undefined
    if (!isOverviewWidgetId(id)) continue
    if (seen.has(id)) continue
    seen.add(id)
    items.push({ id, visible: "visible" in item && item.visible === true })
  }

  for (const widget of dynamicWidgets) {
    if (seen.has(widget.id)) continue
    seen.add(widget.id)
    items.push({ id: widget.id, visible: widget.defaultVisible })
  }
  return {
    version: 1,
    profileVisible:
      "profileVisible" in value && typeof value.profileVisible === "boolean"
        ? value.profileVisible
        : true,
    items,
  }
}

export function moveOverviewWidget(
  layout: OverviewLayout,
  activeId: OverviewWidgetId,
  targetId: OverviewWidgetId,
  dynamicWidgets: readonly DynamicOverviewWidget[] = []
): OverviewLayout {
  if (activeId === targetId) return layout
  const region = getOverviewWidgetRegion(activeId, dynamicWidgets)
  if (region === undefined || getOverviewWidgetRegion(targetId, dynamicWidgets) !== region) {
    return layout
  }
  const visibleItems = layout.items.filter(
    (item) => item.visible && getOverviewWidgetRegion(item.id, dynamicWidgets) === region
  )
  const from = visibleItems.findIndex((item) => item.id === activeId)
  const to = visibleItems.findIndex((item) => item.id === targetId)
  if (from < 0 || to < 0) return layout
  const [moved] = visibleItems.splice(from, 1)
  if (!moved) return layout
  visibleItems.splice(to, 0, moved)
  let index = 0
  return {
    ...layout,
    items: layout.items.map((item) =>
      item.visible && getOverviewWidgetRegion(item.id, dynamicWidgets) === region
        ? visibleItems[index++]!
        : item
    ),
  }
}
