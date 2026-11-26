import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react"
import { hasSlice, supportsPlugin, type ProviderRuntimeSnapshot } from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  RouteLocation,
  SlotComponent,
} from "@orahako/sdk"
import { Button, FilterTrigger } from "@orahako/ui-primitives"
import type { GradesDictionary } from "./dictionary"
import { ALL_TERM, type GradesViewStoreInstance } from "./store"

export interface GradesHeaderActionsInject {
  readonly hooks: {
    readonly location: ObservableSource<RouteLocation>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
  readonly pluginId: string
}

export type GradesHeaderActionsProps = DerivedComponentProps<
  Record<string, never>,
  GradesDictionary,
  undefined,
  GradesViewStoreInstance,
  GradesHeaderActionsInject
>

export const GradesHeaderActions: SlotComponent<GradesHeaderActionsProps> = (props) => {
  const { t, actions } = props
  const location = props.useLocation()
  const provider = props.useProvider((snapshot) => snapshot.provider)
  const term = props.useStore((state) => state.term)
  const sortMode = props.useStore((state) => state.sortMode)

  const onGradesPage = location.route
    ? location.route === "grades"
    : location.pluginId === props.pluginId && (location.pageId ?? "index") === "index"
  if (
    !onGradesPage ||
    !hasSlice(provider, "grades") ||
    !supportsPlugin(provider?.supportedPlugins, props.pluginId)
  ) {
    return null
  }

  const SortIcon = sortMode === "asc" ? ArrowUp : sortMode === "desc" ? ArrowDown : ArrowUpDown
  return (
    <div className="flex items-center gap-0.5 md:hidden">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={actions.cycleSort}
        aria-label={t("grades.sortLabel")}
        className={sortMode !== "default" ? "text-primary" : ""}
      >
        <SortIcon className="size-4" />
      </Button>
      <FilterTrigger
        label={term === ALL_TERM ? t("grades.allTerms") : term}
        onClick={() => actions.setFilterDrawerOpen(true)}
      />
    </div>
  )
}
