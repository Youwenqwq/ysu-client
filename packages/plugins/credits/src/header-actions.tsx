import { hasSlice, supportsPlugin, type ProviderRuntimeSnapshot } from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  RouteLocation,
  SlotComponent,
} from "@orahako/sdk"
import { FilterTrigger } from "@orahako/ui-primitives"
import { getBatchFilters } from "./batch-filters"
import type { CreditsUiStoreInstance } from "./controller"
import type { CreditsDictionary } from "./dictionary"
import type { CreditsPageInject } from "./page"

export interface CreditsHeaderActionsInject {
  readonly hooks: Pick<CreditsPageInject["hooks"], "batches"> & {
    readonly location: ObservableSource<RouteLocation>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
  readonly pluginId: string
}

type CreditsHeaderActionsProps = DerivedComponentProps<
  Record<string, never>,
  CreditsDictionary,
  undefined,
  CreditsUiStoreInstance,
  CreditsHeaderActionsInject
>

export const CreditsHeaderActions: SlotComponent<CreditsHeaderActionsProps> = (props) => {
  const location = props.useLocation()
  const provider = props.useProvider((state) => state.provider)
  const tab = props.useStore((state) => state.tab)
  const onCreditsPage = location.route
    ? location.route === "credits"
    : location.pluginId === props.pluginId && (location.pageId ?? "index") === "index"

  if (
    !onCreditsPage ||
    tab !== "records" ||
    !hasSlice(provider, "credits") ||
    !supportsPlugin(provider?.supportedPlugins, props.pluginId)
  ) {
    return null
  }

  return <CreditsFilterTrigger {...props} />
}

function CreditsFilterTrigger({ useBatches, useStore, actions, t }: CreditsHeaderActionsProps) {
  const { data: batches } = useBatches()
  const batch = useStore((state) => state.batch)
  if (!batches?.length) return null

  const { activeLabel } = getBatchFilters(batches, batch, t)
  return (
    <FilterTrigger
      className="md:hidden"
      label={activeLabel}
      onClick={() => actions.setFilterDrawerOpen(true)}
    />
  )
}
