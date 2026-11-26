import { useMemo } from "react"
import { RefreshCw, Wallet } from "lucide-react"
import {
  hasSlice,
  isProviderError,
  ProviderErrorCode,
  type EpayRecord,
  type EpayRecordStatus,
  type EpaySessionStatus,
  type ProviderRuntimeSnapshot,
  type QuerySnapshot,
  type SessionSnapshot,
} from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  RouteLocation,
  SlotComponent,
} from "@orahako/sdk"
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Separator,
  Skeleton,
} from "@orahako/ui-primitives"
import type { EpayDictionary } from "./dictionary"

export interface EpayPageInject {
  readonly hooks: {
    readonly session: ObservableSource<SessionSnapshot>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly epay: ObservableSource<QuerySnapshot<EpaySessionStatus>>
  }
  readonly getRecordStatus: (record: EpayRecord) => EpayRecordStatus
}

export type EpayPageProps = DerivedComponentProps<
  Record<string, never>,
  EpayDictionary,
  undefined,
  undefined,
  EpayPageInject
>

export interface EpayHeaderActionsInject {
  readonly hooks: EpayPageInject["hooks"] & {
    readonly location: ObservableSource<RouteLocation>
  }
  readonly pluginId: string
}

type EpayHeaderActionsProps = DerivedComponentProps<
  Record<string, never>,
  EpayDictionary,
  undefined,
  undefined,
  EpayHeaderActionsInject
>

function canQueryEpay(provider: ProviderRuntimeSnapshot, session: SessionSnapshot): boolean {
  return (
    provider.status === "ready" &&
    hasSlice(provider.provider, "epay") &&
    session.hasHydrated &&
    Boolean(session.username) &&
    Boolean(session.credential) &&
    session.isAuthenticated
  )
}

export const EpayHeaderActions: SlotComponent<EpayHeaderActionsProps> = (props) => {
  const location = props.useLocation()
  const onPage = location.route
    ? location.route === "epay"
    : location.pluginId === props.pluginId && (location.pageId ?? "index") === "index"
  return onPage ? <EpayHeaderRefresh {...props} /> : null
}

function EpayHeaderRefresh({ t, useSession, useProvider, useEpay }: EpayHeaderActionsProps) {
  const session = useSession()
  const provider = useProvider()
  const query = useEpay()
  const canQuery = canQueryEpay(provider, session)
  const loading = canQuery && (query.isLoading || query.isRefreshing)

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="md:hidden"
      onClick={() => {
        if (canQuery) void query.refresh()
      }}
      disabled={loading}
      aria-label={t("epay.refresh")}
    >
      <RefreshCw className={cn("size-4", loading && "animate-spin")} />
    </Button>
  )
}

function isAuthError(error: Error | null): boolean {
  if (!error) return false
  if (isProviderError(error)) {
    return (
      error.code === ProviderErrorCode.AUTH_REQUIRED ||
      error.code === ProviderErrorCode.AUTH_SESSION_EXPIRED
    )
  }
  return (
    "code" in error &&
    (error.code === ProviderErrorCode.AUTH_REQUIRED ||
      error.code === ProviderErrorCode.AUTH_SESSION_EXPIRED)
  )
}

export const EpayPage: SlotComponent<EpayPageProps> = (props) => {
  const { t, getRecordStatus } = props
  const session = props.useSession()
  const providerSnap = props.useProvider()
  const epayQuery = props.useEpay()

  const isReady = providerSnap.status === "ready"
  const canQuery = canQueryEpay(providerSnap, session)

  const records: readonly EpayRecord[] | null = canQuery ? (epayQuery.data?.records ?? null) : null
  const unpaid: readonly EpayRecord[] = canQuery ? (epayQuery.data?.unpaid ?? []) : []
  const updatedAt = canQuery && epayQuery.updatedAt !== null ? new Date(epayQuery.updatedAt) : null
  const loading = canQuery && (epayQuery.isLoading || epayQuery.isRefreshing)
  const queryError = canQuery ? epayQuery.error : null

  const noAuth =
    isAuthError(queryError) ||
    (session.hasHydrated &&
      Boolean(session.username) &&
      (!session.credential || !session.isAuthenticated))

  const errorMessage = queryError
    ? noAuth
      ? t("epay.ssoUnavailable")
      : t("epay.loadFailed", { message: t("epay.errorGeneric") })
    : null

  const handleRefresh = (): void => {
    if (canQuery) {
      void epayQuery.refresh()
    }
  }

  const paid = useMemo(
    () => (records ? records.filter((record) => getRecordStatus(record) === "paid") : []),
    [records, getRecordStatus]
  )

  const unpaidTotal =
    unpaid.reduce((sum, record) => sum + Math.round(record.amountN * 100), 0) / 100
  const unpaidCount = unpaid.length

  if (session.hasHydrated && !session.username) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wallet />
            </EmptyMedia>
            <EmptyTitle>{t("epay.noAccount")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  if (noAuth && !records) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wallet />
            </EmptyMedia>
            <EmptyTitle>{t("epay.ssoUnavailable")}</EmptyTitle>
          </EmptyHeader>
          <Button variant="outline" onClick={handleRefresh} disabled={!canQuery || loading}>
            {t("epay.retry")}
          </Button>
        </Empty>
      </div>
    )
  }

  if (!session.hasHydrated || !isReady || (!records && loading)) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }

  if (!records) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wallet />
            </EmptyMedia>
            <EmptyTitle>{errorMessage || t("epay.errorGeneric")}</EmptyTitle>
          </EmptyHeader>
          <Button variant="outline" onClick={handleRefresh} disabled={!canQuery || loading}>
            {t("epay.retry")}
          </Button>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-epay-page="">
      <div className="hidden items-center justify-end gap-3 sm:flex">
        {updatedAt ? (
          <span className="text-xs text-muted-foreground">
            {t("epay.updatedAt", {
              time: updatedAt.toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </span>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          className="hidden md:inline-flex"
          onClick={handleRefresh}
          disabled={loading}
          aria-label={t("epay.refresh")}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          {t("epay.refresh")}
        </Button>
      </div>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("epay.unpaidTitle")}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {t("epay.unpaidCount", { count: unpaidCount })}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {unpaidCount === 0 && records.length > 0 ? (
            <p className="text-sm text-muted-foreground">{t("epay.allPaid")}</p>
          ) : unpaidCount > 0 ? (
            <div className="flex flex-col gap-3">
              {unpaid.map((item, idx) => (
                <div key={`${item.id}-${idx}`} className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words">{item.payName}</p>
                    <p className="text-xs text-muted-foreground">{item.chargeYear}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 pt-0.5">
                    <Badge variant="destructive">{t("epay.statusUnpaid")}</Badge>
                    <span className="text-sm font-semibold text-destructive tabular-nums">
                      ¥{item.amountN}
                    </span>
                  </div>
                </div>
              ))}
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("epay.unpaidTotal")}</span>
                <span className="text-base font-bold text-destructive tabular-nums">
                  ¥{unpaidTotal.toFixed(2)}
                </span>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {paid.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("epay.paidTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              {paid.map((item, idx) => (
                <div key={`${item.id}-${idx}`} className="flex items-start justify-between gap-3">
                  <p className="text-sm break-words">{item.payName}</p>
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                    {t("epay.statusPaid")} · ¥{item.amountN}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {records.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wallet />
            </EmptyMedia>
            <EmptyTitle>{t("epay.empty")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  )
}
