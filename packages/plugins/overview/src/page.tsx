import type { ReactNode } from "react"
import { LayoutDashboard, RotateCcw } from "lucide-react"
import {
  createDefaultOverviewLayout,
  normalizeOverviewLayout,
  pluginOverviewWidgetId,
  type DynamicOverviewWidget,
  type OverviewWidgetId,
} from "@orahako/academic-kit"
import {
  hasSlice,
  supportsPlugin,
  type AcademicSliceKey,
  type OverviewWidgetContribution,
  type ProviderRuntimeSnapshot,
  type SchoolProvider,
} from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  PluginLocale,
  SlotComponent,
} from "@orahako/sdk"
import {
  Button,
  Card,
  CardContent,
  cn,
  type CSSCustomProperties,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
  useIsMobile,
} from "@orahako/ui-primitives"
import { overviewWidgetSlotKey } from "./registry"
import "./slots"
import type { OverviewDictionary, OverviewLayoutStoreInstance } from "./store"

export const OVERVIEW_PAGE_CHILDREN = {
  "overview.widget": { kind: "keyed" },
} as const

export const OVERVIEW_PROFILE_WIDGET_ID = "profile"
export const OVERVIEW_WEEK_SUMMARY_WIDGET_ID = "week-summary"

export function isWidgetSupportedByProvider(
  widget: OverviewWidgetContribution,
  provider: SchoolProvider | null
): boolean {
  if (!supportsPlugin(provider?.supportedPlugins, widget.pluginId)) {
    return false
  }
  if (widget.slice !== undefined && !hasSlice(provider, widget.slice)) {
    return false
  }
  if (
    widget.capability !== undefined &&
    !hasSlice(provider, widget.capability as AcademicSliceKey)
  ) {
    return false
  }
  return true
}

export interface OverviewPageInject {
  readonly hooks: {
    readonly layoutHydrated: ObservableSource<boolean>
    readonly widgets: ObservableSource<readonly OverviewWidgetContribution[]>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
  readonly pluginId: string
  readonly resolveWidgetTitle: (widget: OverviewWidgetContribution, locale: PluginLocale) => string
  readonly openSettings: () => void
}

export type OverviewPageProps = DerivedComponentProps<
  Record<string, never>,
  OverviewDictionary,
  typeof OVERVIEW_PAGE_CHILDREN,
  OverviewLayoutStoreInstance,
  OverviewPageInject
>

export const OverviewPage: SlotComponent<OverviewPageProps> = (props) => {
  const { t, locale, useStore, actions, renderSlot } = props
  const hydrated = props.useLayoutHydrated()
  const widgets = props.useWidgets()
  const providerSnap = props.useProvider()
  const storedLayout = useStore((s) => s.overviewLayout)
  const compact = useIsMobile()

  if (!hydrated) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label={t("layout.loading")}>
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const activeProvider = providerSnap.provider
  const available = widgets.filter((widget) => isWidgetSupportedByProvider(widget, activeProvider))

  const dynamicWidgets: DynamicOverviewWidget[] = available.map((widget) => ({
    id: pluginOverviewWidgetId(widget.pluginId, widget.id),
    region: widget.region,
    defaultVisible: widget.defaultVisible,
  }))

  const contributionMap = new Map<OverviewWidgetId, OverviewWidgetContribution>()
  for (const widget of available) {
    contributionMap.set(pluginOverviewWidgetId(widget.pluginId, widget.id), widget)
  }

  const effective = normalizeOverviewLayout(storedLayout, dynamicWidgets)
  const profileLayoutId = pluginOverviewWidgetId(props.pluginId, OVERVIEW_PROFILE_WIDGET_ID)

  let profileNode: { readonly id: OverviewWidgetId; readonly node: ReactNode } | null = null
  const summary: Array<{ readonly id: OverviewWidgetId; readonly node: ReactNode }> = []
  const content: Array<{
    readonly id: OverviewWidgetId
    readonly title: string
    readonly node: ReactNode
  }> = []

  for (const item of effective.items) {
    if (!item.visible) continue
    const contribution = contributionMap.get(item.id)
    if (!contribution) continue
    if (item.id === profileLayoutId && !effective.profileVisible) {
      continue
    }

    const slotKey = overviewWidgetSlotKey(contribution.pluginId, contribution.id)
    const rendered = renderSlot("overview.widget", {}, { key: slotKey })

    if (item.id === profileLayoutId) {
      profileNode = { id: item.id, node: rendered }
    } else if (contribution.region === "summary") {
      summary.push({ id: item.id, node: rendered })
    } else {
      content.push({
        id: item.id,
        title: props.resolveWidgetTitle(contribution, locale),
        node: rendered,
      })
    }
  }

  const showFallback = !profileNode && summary.length === 0 && content.length === 0

  const inlineSummaries =
    summary.length > 0 ? (
      <CardContent
        data-overview-inline=""
        className={cn("grid gap-x-3 gap-y-4", Boolean(profileNode) && "pt-3")}
        style={{ gridTemplateColumns: `repeat(${Math.min(3, summary.length)}, minmax(0, 1fr))` }}
      >
        {summary.map(({ id, node }) => (
          <div key={id} data-overview-widget={id} className="min-w-0">
            {node}
          </div>
        ))}
      </CardContent>
    ) : null

  const summaryGridStyle: CSSCustomProperties = {
    "--summary-columns": summary.length === 4 ? 2 : summary.length,
  }

  return (
    <div data-overview-root="" className="flex min-w-0 flex-col gap-4">
      {compact ? (
        <>
          {profileNode && (
            <div data-overview-widget={profileNode.id} className="min-w-0">
              {profileNode.node}
            </div>
          )}
          {inlineSummaries && <Card>{inlineSummaries}</Card>}
        </>
      ) : (
        (profileNode !== null || summary.length > 0) && (
          <div
            className={cn(
              "grid gap-4",
              profileNode !== null &&
                summary.length > 0 &&
                "lg:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]"
            )}
          >
            {profileNode && (
              <div data-overview-widget={profileNode.id} className="min-w-0 [&>*]:h-full">
                {profileNode.node}
              </div>
            )}
            {summary.length > 0 && (
              <div
                className="grid grid-cols-2 gap-3 xl:grid-cols-[repeat(var(--summary-columns),minmax(0,1fr))]"
                style={summaryGridStyle}
              >
                {summary.map(({ id, node }, index) => {
                  const oddLast = summary.length % 2 === 1 && index === summary.length - 1
                  return (
                    <div
                      key={id}
                      data-overview-widget={id}
                      className={cn("min-w-0 [&>*]:h-full", oddLast && "col-span-2 xl:col-span-1")}
                    >
                      {node}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      )}

      {content.length > 0 && (
        <div data-overview-content="" className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          {content.map(({ id, title, node }) => (
            <section
              key={id}
              aria-label={title}
              data-overview-widget={id}
              className="min-w-0 empty:hidden has-[>[data-overview-wide]]:xl:col-span-2"
            >
              {node}
            </section>
          ))}
        </div>
      )}

      {showFallback && (
        <div data-overview-fallback="">
          <Empty className="border py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayoutDashboard />
              </EmptyMedia>
              <EmptyTitle>{t("layout.empty")}</EmptyTitle>
              <EmptyDescription>{t("layout.emptyDescription")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={props.openSettings}>{t("settingsTitle")}</Button>
              <Button
                variant="outline"
                onClick={() =>
                  actions.setOverviewLayout(createDefaultOverviewLayout(dynamicWidgets))
                }
              >
                <RotateCcw data-icon="inline-start" />
                {t("layout.reset")}
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      )}
    </div>
  )
}
