import { hasSlice, supportsPlugin, type ProviderRuntimeSnapshot } from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  RouteLocation,
  SlotComponent,
} from "@orahako/sdk"
import { FilterTrigger } from "@orahako/ui-primitives"
import type { ExamsDictionary } from "./dictionary"
import type { ExamsViewStoreInstance } from "./store"

export interface ExamsHeaderActionsInject {
  readonly hooks: {
    readonly location: ObservableSource<RouteLocation>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly queriedTerm: ObservableSource<string>
  }
  readonly pluginId: string
}

type ExamsHeaderActionsProps = DerivedComponentProps<
  Record<string, never>,
  ExamsDictionary,
  undefined,
  ExamsViewStoreInstance,
  ExamsHeaderActionsInject
>

export const ExamsHeaderActions: SlotComponent<ExamsHeaderActionsProps> = (props) => {
  const location = props.useLocation()
  const provider = props.useProvider((state) => state.provider)
  const queriedTerm = props.useQueriedTerm()
  const onExamsPage = location.route
    ? location.route === "exams"
    : location.pluginId === props.pluginId && (location.pageId ?? "index") === "index"

  if (
    !onExamsPage ||
    !hasSlice(provider, "exams") ||
    !supportsPlugin(provider?.supportedPlugins, props.pluginId)
  ) {
    return null
  }

  return (
    <FilterTrigger
      className="md:hidden"
      label={queriedTerm || props.t("exams.termLabel")}
      onClick={() => props.actions.setFilterDrawerOpen(true)}
    />
  )
}
