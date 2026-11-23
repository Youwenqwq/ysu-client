import { ChevronDown, Sparkles } from "lucide-react"
import {
  hasSlice,
  supportsPlugin,
  type EvaluationTask,
  type EvaluationType,
  type ProviderRuntimeSnapshot,
  type QuerySnapshot,
} from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  RouteLocation,
  SlotComponent,
} from "@orahako/sdk"
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@orahako/ui-primitives"
import type { EvaluationDictionary } from "./dictionary"
import { isEvaluationTaskActive } from "./helpers"
import type { EvaluationViewStoreInstance } from "./view-store"

export interface EvaluationHeaderActionsInject {
  readonly hooks: {
    readonly location: ObservableSource<RouteLocation>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly types: ObservableSource<QuerySnapshot<EvaluationType[]>>
    readonly selectedType: ObservableSource<string | null>
    readonly tasks: ObservableSource<QuerySnapshot<EvaluationTask[]>>
  }
  readonly pluginId: string
  readonly selectType: (code: string) => Promise<void>
}

export type EvaluationHeaderActionsProps = DerivedComponentProps<
  Record<string, never>,
  EvaluationDictionary,
  undefined,
  EvaluationViewStoreInstance,
  EvaluationHeaderActionsInject
>

export const EvaluationHeaderActions: SlotComponent<EvaluationHeaderActionsProps> = (props) => {
  const location = props.useLocation()
  const provider = props.useProvider((snapshot) => snapshot.provider)
  const onEvaluationPage = location.route
    ? location.route === "evaluation"
    : location.pluginId === props.pluginId && (location.pageId ?? "index") === "index"
  if (
    !onEvaluationPage ||
    !hasSlice(provider, "evaluation") ||
    !supportsPlugin(provider?.supportedPlugins, props.pluginId)
  ) {
    return null
  }

  return <EvaluationControls {...props} />
}

function EvaluationControls(props: EvaluationHeaderActionsProps) {
  const { t, useTypes, useSelectedType, useTasks, selectType, actions } = props
  const types = useTypes((query) => query.data ?? [])
  const selectedType = useSelectedType()
  const tasks = useTasks((query) => query.data ?? [])
  if (types.length === 0) return null

  const selectedTypeName = types.find((type) => type.code === selectedType)?.name
  const hasBatchTasks = Boolean(selectedType) && tasks.some((task) => isEvaluationTaskActive(task))

  return (
    <div className="flex items-center gap-1 md:hidden">
      {hasBatchTasks && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={actions.openBatchSelect}
          aria-label={t("evaluation.batchAuto")}
        >
          <Sparkles className="size-4" />
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-sm">
            <span className="max-w-[7rem] truncate">
              {selectedTypeName || t("evaluation.title")}
            </span>
            <ChevronDown className="ml-0.5 size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[10rem]">
          {types.map((type) => (
            <DropdownMenuItem
              key={type.code ?? type.name}
              onSelect={() => void selectType(type.code || "")}
              className="flex items-center justify-between gap-3"
            >
              <span>{type.name}</span>
              {type.count > 0 && <Badge variant="secondary">{type.count}</Badge>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
