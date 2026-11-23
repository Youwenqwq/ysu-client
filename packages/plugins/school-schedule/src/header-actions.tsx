import type { CodeItem, MajorInfo, QuerySnapshot } from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  RouteLocation,
  SlotComponent,
} from "@orahako/sdk"
import { FilterTrigger } from "@orahako/ui-primitives"
import type { SchoolScheduleDictionary } from "./dictionary"
import type { SchoolScheduleFilterStoreInstance } from "./store"
import "./slots"

export interface SchoolScheduleHeaderActionsInject {
  readonly hooks: {
    readonly location: ObservableSource<RouteLocation>
    readonly gradeYears: ObservableSource<QuerySnapshot<CodeItem[]>>
    readonly departments: ObservableSource<QuerySnapshot<CodeItem[]>>
    readonly majors: ObservableSource<QuerySnapshot<MajorInfo[]>>
    readonly campuses: ObservableSource<QuerySnapshot<CodeItem[]>>
    readonly buildings: ObservableSource<QuerySnapshot<CodeItem[]>>
  }
  readonly pluginId: string
}

export type SchoolScheduleHeaderActionsProps = DerivedComponentProps<
  Record<string, never>,
  SchoolScheduleDictionary,
  undefined,
  SchoolScheduleFilterStoreInstance,
  SchoolScheduleHeaderActionsInject
>

export const SchoolScheduleHeaderActions: SlotComponent<SchoolScheduleHeaderActionsProps> = (
  props
) => {
  const { t, useStore, actions } = props
  const location = props.useLocation()
  const tab = useStore((state) => state.tab)
  const grade = useStore((state) => state.grade)
  const department = useStore((state) => state.department)
  const major = useStore((state) => state.major)
  const selectedClass = useStore((state) => state.selectedClass)
  const campus = useStore((state) => state.campus)
  const building = useStore((state) => state.building)
  const searchedRoomName = useStore((state) => state.searchedRoomName)
  const selectedRoom = useStore((state) => state.selectedRoom)

  const gradeYears = props.useGradeYears().data ?? []
  const departments = props.useDepartments().data ?? []
  const majors = props.useMajors().data ?? []
  const campuses = props.useCampuses().data ?? []
  const buildings = props.useBuildings().data ?? []

  if (location.route !== "school-schedule" && location.pluginId !== props.pluginId) return null
  if ((tab === "class" && selectedClass) || (tab === "room" && selectedRoom)) return null

  const label =
    tab === "class"
      ? [
          gradeYears.find((item) => item.id === grade)?.name,
          departments.find((item) => item.id === department)?.name,
          majors.find((item) => item.id === major)?.name,
        ]
          .filter(Boolean)
          .join(" · ")
      : [
          campuses.find((item) => item.id === campus)?.name,
          buildings.find((item) => item.id === building)?.name,
          searchedRoomName || null,
        ]
          .filter(Boolean)
          .join(" · ")

  return (
    <div className="md:hidden" data-school-schedule-header-actions="">
      <FilterTrigger
        label={label || t("selectHint")}
        onClick={() =>
          tab === "class" ? actions.setClassDrawerOpen(true) : actions.setRoomDrawerOpen(true)
        }
      />
    </div>
  )
}
