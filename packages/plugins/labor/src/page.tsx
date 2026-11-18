import type { ReactNode } from "react"
import { Clock, MapPin, ScrollText, User } from "lucide-react"
import { formatTimeRange } from "@orahako/academic-kit"
import type {
  EnrollableActivity,
  LaborRecord,
  LaborSummary,
  QuerySnapshot,
} from "@orahako/academic-sdk"
import {
  defineStore,
  type DerivedComponentProps,
  type ObservableSource,
  type SlotComponent,
  type Translator,
} from "@orahako/sdk"
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  LoadingCards,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useErrorToast,
  ValidatingList,
} from "@orahako/ui-primitives"
import type { LaborDictionary } from "./dictionary"

export type LaborTab = "records" | "activities"

export interface LaborUiState {
  readonly tab: LaborTab
}

function isLaborTab(value: string): value is LaborTab {
  return value === "records" || value === "activities"
}

export const laborUiStore = defineStore({
  init: (): LaborUiState => ({
    tab: "records",
  }),
  actions: {
    setTab(ctx, tab: string) {
      if (!isLaborTab(tab)) return
      ctx.set((prev) => (prev.tab === tab ? prev : { tab }))
    },
  },
})

export type LaborUiStoreInstance = ReturnType<typeof laborUiStore.create>

export interface LaborPageInject {
  readonly hooks: {
    readonly summary: ObservableSource<QuerySnapshot<LaborSummary>>
    readonly records: ObservableSource<QuerySnapshot<LaborRecord[]>>
    readonly activities: ObservableSource<QuerySnapshot<EnrollableActivity[]>>
  }
}

export type LaborPageProps = DerivedComponentProps<
  Record<string, never>,
  LaborDictionary,
  undefined,
  LaborUiStoreInstance,
  LaborPageInject
>

function RecordsPanel({
  useRecords,
  t,
}: {
  readonly useRecords: LaborPageProps["useRecords"]
  readonly t: Translator<LaborDictionary>
}): ReactNode {
  const recordsQuery = useRecords()
  const records = recordsQuery.data ?? []
  useErrorToast(recordsQuery.error ?? undefined)

  if ((recordsQuery.isLoading || recordsQuery.isRefreshing) && records.length === 0) {
    return <LoadingCards className="h-28" />
  }
  if (records.length === 0) {
    return <EmptyState title={t("labor.noRecords")} />
  }

  return (
    <ValidatingList validating={recordsQuery.isRefreshing} className="flex flex-col gap-4">
      {records.map((record, idx) => {
        const rangeText = formatTimeRange(record.timeStart, record.timeEnd)
        return (
          <Card key={`${record.name}-${record.timeStart ?? idx}`}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base">
                    {record.name}
                    {record.enrollType && (
                      <Badge variant="outline" className="ml-2 align-middle">
                        {record.enrollType}
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {[record.term, record.category].filter(Boolean).join(" · ")}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {record.hours !== undefined && (
                    <span className="text-lg font-semibold tabular-nums">
                      {record.hours}
                      <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                        {t("labor.hoursUnit")}
                      </span>
                    </span>
                  )}
                  {record.status && <Badge variant="secondary">{record.status}</Badge>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                {record.teacher && (
                  <span className="flex items-center gap-1">
                    <User className="size-4" />
                    {record.teacher}
                  </span>
                )}
              </div>
              {rangeText && (
                <div className="flex items-center gap-2">
                  <Clock className="size-4 shrink-0 text-muted-foreground" />
                  <span>{rangeText}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </ValidatingList>
  )
}

function ActivitiesPanel({
  useActivities,
  t,
}: {
  readonly useActivities: LaborPageProps["useActivities"]
  readonly t: Translator<LaborDictionary>
}): ReactNode {
  const activitiesQuery = useActivities()
  const activities = activitiesQuery.data ?? []
  useErrorToast(activitiesQuery.error ?? undefined)

  if ((activitiesQuery.isLoading || activitiesQuery.isRefreshing) && activities.length === 0) {
    return <LoadingCards className="h-28" />
  }
  if (activities.length === 0) {
    return <EmptyState title={t("labor.noActivities")} />
  }

  return (
    <ValidatingList validating={activitiesQuery.isRefreshing} className="flex flex-col gap-4">
      {activities.map((activity, idx) => {
        const activityTime = formatTimeRange(activity.timeStart, activity.timeEnd)
        const enrollWindow = formatTimeRange(activity.enrollStart, activity.enrollEnd)
        return (
          <Card key={`${activity.name}-${activity.timeStart ?? idx}`}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base">{activity.name}</CardTitle>
                  <CardDescription>
                    {[activity.category, activity.department].filter(Boolean).join(" · ")}
                  </CardDescription>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {activity.hours !== undefined && (
                    <span className="text-lg font-semibold tabular-nums">
                      {activity.hours}
                      <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                        {t("labor.hoursUnit")}
                      </span>
                    </span>
                  )}
                  {activity.isEnrolled && <Badge variant="default">{t("labor.enrolled")}</Badge>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                {activity.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="size-4" />
                    {activity.location}
                  </span>
                )}
              </div>
              {activityTime && (
                <div className="flex items-center gap-2">
                  <Clock className="size-4 shrink-0 text-muted-foreground" />
                  <span>
                    {t("labor.activityTime")}: {activityTime}
                  </span>
                </div>
              )}
              {enrollWindow && (
                <div className="flex items-center gap-2">
                  <ScrollText className="size-4 shrink-0 text-muted-foreground" />
                  <span>
                    {t("labor.enrollWindow")}: {enrollWindow}
                  </span>
                </div>
              )}
              {activity.operation && (
                <p className="text-xs text-muted-foreground">{activity.operation}</p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </ValidatingList>
  )
}

export const LaborPage: SlotComponent<LaborPageProps> = (props) => {
  const { t, useStore, actions, useSummary, useRecords, useActivities } = props
  const tab = useStore((s) => s.tab)

  const summaryQuery = useSummary()
  const summary = summaryQuery.data
  useErrorToast(summaryQuery.error ?? undefined)

  return (
    <div className="flex flex-col gap-6" data-labor-page="">
      <Card>
        <CardContent className="py-4">
          {summaryQuery.isLoading && !summary ? (
            <div className="flex gap-8">
              <LoadingCards count={1} className="h-12 w-24" />
              <LoadingCards count={1} className="h-12 w-24" />
            </div>
          ) : summary ? (
            <div
              className={cn(
                "flex gap-8 transition-opacity",
                summaryQuery.isRefreshing && "opacity-50"
              )}
            >
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t("labor.totalHours")}</span>
                <span className="text-2xl font-semibold tabular-nums">
                  {summary.totalHours ?? "-"}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">
                    {t("labor.hoursUnit")}
                  </span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t("labor.totalCredits")}</span>
                <span className="text-2xl font-semibold tabular-nums">
                  {summary.totalCredits ?? "-"}
                </span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={actions.setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="records">{t("labor.recordsTab")}</TabsTrigger>
          <TabsTrigger value="activities">{t("labor.activitiesTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="mt-4">
          <RecordsPanel useRecords={useRecords} t={t} />
        </TabsContent>
        <TabsContent value="activities" className="mt-4">
          <ActivitiesPanel useActivities={useActivities} t={t} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
