export type SummaryWidgetId = "week" | "ecard" | "gpa" | "evaluation"
export type ContentWidgetId =
  | "course-progress"
  | "today-courses"
  | "upcoming-exams"
  | "evaluation-tasks"
export type OverviewWidgetId = SummaryWidgetId | ContentWidgetId
export type OverviewRegion = "summary" | "content"

interface WidgetDefinition {
  region: OverviewRegion
  titleKey: string
  descriptionKey: string
  defaultVisible: boolean
}

export const OVERVIEW_WIDGETS = {
  week: {
    region: "summary",
    titleKey: "overviewLayout.widgets.week.title",
    descriptionKey: "overviewLayout.widgets.week.description",
    defaultVisible: true,
  },
  ecard: {
    region: "summary",
    titleKey: "overviewLayout.widgets.ecard.title",
    descriptionKey: "overviewLayout.widgets.ecard.description",
    defaultVisible: true,
  },
  gpa: {
    region: "summary",
    titleKey: "overviewLayout.widgets.gpa.title",
    descriptionKey: "overviewLayout.widgets.gpa.description",
    defaultVisible: false,
  },
  evaluation: {
    region: "summary",
    titleKey: "overviewLayout.widgets.evaluation.title",
    descriptionKey: "overviewLayout.widgets.evaluation.description",
    defaultVisible: true,
  },
  "course-progress": {
    region: "content",
    titleKey: "overviewLayout.widgets.courseProgress.title",
    descriptionKey: "overviewLayout.widgets.courseProgress.description",
    defaultVisible: true,
  },
  "today-courses": {
    region: "content",
    titleKey: "overviewLayout.widgets.todayCourses.title",
    descriptionKey: "overviewLayout.widgets.todayCourses.description",
    defaultVisible: true,
  },
  "upcoming-exams": {
    region: "content",
    titleKey: "overviewLayout.widgets.upcomingExams.title",
    descriptionKey: "overviewLayout.widgets.upcomingExams.description",
    defaultVisible: true,
  },
  "evaluation-tasks": {
    region: "content",
    titleKey: "overviewLayout.widgets.evaluationTasks.title",
    descriptionKey: "overviewLayout.widgets.evaluationTasks.description",
    defaultVisible: true,
  },
} as const satisfies Record<OverviewWidgetId, WidgetDefinition>

export const OVERVIEW_WIDGET_IDS = Object.keys(OVERVIEW_WIDGETS) as OverviewWidgetId[]

export interface OverviewLayout {
  version: 1
  profileVisible: boolean
  items: { id: OverviewWidgetId; visible: boolean }[]
}

export function createDefaultOverviewLayout(): OverviewLayout {
  return {
    version: 1,
    profileVisible: true,
    items: OVERVIEW_WIDGET_IDS.map((id) => ({
      id,
      visible: OVERVIEW_WIDGETS[id].defaultVisible,
    })),
  }
}

export function isOverviewWidgetId(value: unknown): value is OverviewWidgetId {
  return typeof value === "string" && Object.hasOwn(OVERVIEW_WIDGETS, value)
}

export function normalizeOverviewLayout(value: unknown): OverviewLayout {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("items" in value) ||
    !Array.isArray(value.items)
  ) {
    return createDefaultOverviewLayout()
  }

  const seen = new Set<OverviewWidgetId>()
  const items: OverviewLayout["items"] = []
  for (const item of value.items) {
    if (
      typeof item !== "object" ||
      item === null ||
      !isOverviewWidgetId(item.id) ||
      seen.has(item.id)
    )
      continue
    seen.add(item.id)
    items.push({ id: item.id, visible: item.visible === true })
  }
  // A saved layout is customized: future widgets must not appear without consent.
  for (const id of OVERVIEW_WIDGET_IDS) {
    if (!seen.has(id)) items.push({ id, visible: false })
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
  targetId: OverviewWidgetId
): OverviewLayout {
  const region = OVERVIEW_WIDGETS[activeId].region
  if (activeId === targetId || OVERVIEW_WIDGETS[targetId].region !== region) return layout
  const visibleItems = layout.items.filter(
    (item) => item.visible && OVERVIEW_WIDGETS[item.id].region === region
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
      item.visible && OVERVIEW_WIDGETS[item.id].region === region ? visibleItems[index++] : item
    ),
  }
}
