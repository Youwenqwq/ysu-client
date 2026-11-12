/** Dynamic widgets contributed by plugins: `plugin:<pluginId>:<widgetId>`. */
export type PluginOverviewWidgetId = `plugin:${string}:${string}`
/**
 * IDs written by the overview before its widgets moved into plugins. They stay readable so
 * a persisted layout is migrated once the contributing plugin is registered again.
 */
export type LegacyOverviewWidgetId =
  | "week"
  | "ecard"
  | "gpa"
  | "evaluation"
  | "course-progress"
  | "today-courses"
  | "upcoming-exams"
  | "evaluation-tasks"
export type OverviewWidgetId = PluginOverviewWidgetId | LegacyOverviewWidgetId
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

const LEGACY_WIDGET_IDS: readonly LegacyOverviewWidgetId[] = [
  "week",
  "ecard",
  "gpa",
  "evaluation",
  "course-progress",
  "today-courses",
  "upcoming-exams",
  "evaluation-tasks",
]

export function pluginOverviewWidgetId(pluginId: string, widgetId: string): PluginOverviewWidgetId {
  return `plugin:${pluginId}:${widgetId}` as PluginOverviewWidgetId
}

export function isPluginOverviewWidgetId(value: unknown): value is PluginOverviewWidgetId {
  return typeof value === "string" && PLUGIN_WIDGET_ID.test(value)
}

export function isLegacyOverviewWidgetId(value: unknown): value is LegacyOverviewWidgetId {
  return typeof value === "string" && (LEGACY_WIDGET_IDS as readonly string[]).includes(value)
}

export function isOverviewWidgetId(value: unknown): value is OverviewWidgetId {
  return isPluginOverviewWidgetId(value) || isLegacyOverviewWidgetId(value)
}

function contributedWidgetId(id: PluginOverviewWidgetId): string {
  // `plugin:<pluginId>:<widgetId>`; the widget ID may itself contain colons.
  return id.split(":").slice(2).join(":")
}

function resolveWidgetId(
  id: OverviewWidgetId,
  dynamicWidgets: readonly DynamicOverviewWidget[]
): OverviewWidgetId {
  if (!isLegacyOverviewWidgetId(id)) return id
  const contribution = dynamicWidgets.find((widget) => contributedWidgetId(widget.id) === id)
  return contribution?.id ?? id
}

export function getOverviewWidgetRegion(
  id: OverviewWidgetId,
  dynamicWidgets: readonly DynamicOverviewWidget[] = []
): OverviewRegion | undefined {
  const resolved = resolveWidgetId(id, dynamicWidgets)
  return dynamicWidgets.find((widget) => widget.id === resolved)?.region
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
    // Saved pre-plugin IDs migrate to the contribution that now owns the widget.
    const resolved = resolveWidgetId(id, dynamicWidgets)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    items.push({ id: resolved, visible: "visible" in item && item.visible === true })
  }
  // Installed plugins announce their own initial visibility, so a missing contribution
  // follows its declared default while an existing entry keeps the user's choice.
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
  if (region === undefined || getOverviewWidgetRegion(targetId, dynamicWidgets) !== region)
    return layout
  const visibleItems = layout.items.filter(
    (item) => item.visible && getOverviewWidgetRegion(item.id, dynamicWidgets) === region
  )
  const from = visibleItems.findIndex((item) => item.id === activeId)
  const to = visibleItems.findIndex((item) => item.id === targetId)
  if (from < 0 || to < 0) return layout
  const [moved] = visibleItems.splice(from, 1)
  visibleItems.splice(to, 0, moved)
  let index = 0
  return {
    ...layout,
    // Hidden positions and the other region remain untouched by a reorder.
    items: layout.items.map((item) =>
      item.visible && getOverviewWidgetRegion(item.id, dynamicWidgets) === region
        ? visibleItems[index++]
        : item
    ),
  }
}
