import { hasSlice, supportsPlugin, type ProviderRuntimeSnapshot } from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  RouteLocation,
  SlotComponent,
} from "@orahako/sdk"
import { FilterTrigger } from "@orahako/ui-primitives"
import type { ComprehensiveDictionary } from "./dictionary"
import { formatTermLabel } from "./sources"
import type { ComprehensivePageInject } from "./page"
import type { ComprehensiveViewStoreInstance } from "./view-store"

export interface ComprehensiveHeaderActionsInject {
  readonly hooks: Pick<ComprehensivePageInject["hooks"], "terms" | "selectedTerm"> & {
    readonly location: ObservableSource<RouteLocation>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
  readonly pluginId: string
}

type ComprehensiveHeaderActionsProps = DerivedComponentProps<
  Record<string, never>,
  ComprehensiveDictionary,
  undefined,
  ComprehensiveViewStoreInstance,
  ComprehensiveHeaderActionsInject
>

export const ComprehensiveHeaderActions: SlotComponent<ComprehensiveHeaderActionsProps> = (
  props
) => {
  const location = props.useLocation()
  const provider = props.useProvider((state) => state.provider)
  const tab = props.useStore((state) => state.tab)
  const onComprehensivePage = location.route
    ? location.route === "comprehensive"
    : location.pluginId === props.pluginId && (location.pageId ?? "index") === "index"

  if (
    !onComprehensivePage ||
    (tab !== "result" && tab !== "radar") ||
    !hasSlice(provider, "comprehensive") ||
    !supportsPlugin(provider?.supportedPlugins, props.pluginId)
  ) {
    return null
  }

  return <ComprehensiveFilterTrigger {...props} />
}

function ComprehensiveFilterTrigger({
  useTerms,
  useSelectedTerm,
  t,
  actions,
}: ComprehensiveHeaderActionsProps) {
  const { data: terms } = useTerms()
  const selected = useSelectedTerm()
  const selectedItem = terms?.find(
    (item) => selected !== null && item.year === selected.year && item.term === selected.term
  )

  return (
    <FilterTrigger
      className="md:hidden"
      label={selectedItem ? formatTermLabel(selectedItem) : t("comprehensive.title")}
      onClick={() => actions.setFilterDrawerOpen(true)}
    />
  )
}
