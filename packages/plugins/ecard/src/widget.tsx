import type { MouseEvent } from "react"
import { CreditCard, RefreshCw } from "lucide-react"
import {
  hasSlice,
  type EcardSessionStatus,
  type ProviderRuntimeSnapshot,
  type QuerySnapshot,
  type SessionSnapshot,
} from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Empty,
  EmptyDescription,
  EmptyHeader,
  Skeleton,
  useIsMobile,
} from "@orahako/ui-primitives"
import type { EcardDictionary } from "./dictionary"
import { isEcardAuthError } from "./page"

export const ECARD_BALANCE_WIDGET_ID = "ecard-balance"

export interface EcardSummaryWidgetInject {
  readonly hooks: {
    readonly session: ObservableSource<SessionSnapshot>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly ecard: ObservableSource<QuerySnapshot<EcardSessionStatus>>
  }
  readonly ecardHref: string
  readonly openEcard: () => void
}

export type EcardSummaryWidgetProps = DerivedComponentProps<
  Record<string, never>,
  EcardDictionary,
  undefined,
  undefined,
  EcardSummaryWidgetInject
>

function handleSpaClick(event: MouseEvent<HTMLAnchorElement>, navigate: () => void): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return
  }
  event.preventDefault()
  navigate()
}

export const EcardSummaryWidget: SlotComponent<EcardSummaryWidgetProps> = (props) => {
  const { t, locale, ecardHref, openEcard } = props
  const session = props.useSession()
  const providerSnap = props.useProvider()
  const ecardQuery = props.useEcard()
  const compact = useIsMobile()

  const available = hasSlice(providerSnap.provider, "ecard")
  const initializing =
    !session.hasHydrated ||
    (Boolean(session.username) &&
      providerSnap.status === "initializing" &&
      providerSnap.provider === null)
  const noAccount = session.hasHydrated && !session.username
  const noAuth =
    !session.isAuthenticated || !session.credential || isEcardAuthError(ecardQuery.error)
  const enabled =
    available &&
    providerSnap.status === "ready" &&
    session.hasHydrated &&
    Boolean(session.username) &&
    Boolean(session.credential) &&
    session.isAuthenticated

  const loading = enabled && (ecardQuery.isLoading || ecardQuery.isRefreshing)
  const data = enabled ? ecardQuery.data : undefined
  const balance = data?.balance ?? null
  const updatedAt = enabled ? ecardQuery.updatedAt : null
  const error = enabled ? ecardQuery.error : null
  const isStale = enabled && (ecardQuery.isStale || (Boolean(data) && Boolean(error)))
  const firstLoad = initializing || (!data && loading)
  const updated = updatedAt === null ? null : new Date(updatedAt)

  const message = noAccount
    ? t("ecard.noAccount")
    : !available
      ? t("ecard.unsupportedProvider")
      : noAuth
        ? t("ecard.noAuth")
        : error
          ? t("ecard.errorGeneric")
          : t("ecard.notAvailable")

  if (compact) {
    return (
      <a
        data-ecard-summary="compact"
        href={ecardHref}
        onClick={(event) => handleSpaClick(event, openEcard)}
        title={balance ? undefined : message}
        className="flex min-w-0 flex-col gap-1 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        aria-busy={loading || initializing}
      >
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <CreditCard className="size-3.5 shrink-0" />
          <span className="truncate">{t("ecard.title")}</span>
        </span>
        {firstLoad ? (
          <Skeleton className="h-6 w-14" aria-label={t("widget.loading")} />
        ) : balance ? (
          <span className="text-base font-semibold tabular-nums">
            ¥{balance.balance.toFixed(2)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground" aria-label={message}>
            {t("widget.unavailableShort")}
          </span>
        )}
        {isStale && (
          <span
            role="status"
            title={t("ecard.refreshFailed")}
            className="text-xs text-muted-foreground"
          >
            {t("widget.staleShort")}
          </span>
        )}
      </a>
    )
  }

  return (
    <Card size="sm" data-ecard-summary="card">
      <CardHeader className="flex flex-row items-center gap-1">
        <CreditCard className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <CardTitle className="min-w-0 flex-1">
          <a
            href={ecardHref}
            onClick={(event) => handleSpaClick(event, openEcard)}
            className="rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("ecard.title")}
          </a>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2" aria-busy={loading || initializing}>
        {firstLoad ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-36 max-w-full" />
          </div>
        ) : balance ? (
          <>
            <p className="text-2xl font-semibold tabular-nums">¥{balance.balance.toFixed(2)}</p>
            {isStale && (
              <p className="text-xs text-destructive" role="status">
                {t("ecard.refreshFailed")}
              </p>
            )}
            {isStale && noAuth && <p className="text-xs text-destructive">{t("ecard.noAuth")}</p>}
          </>
        ) : (
          <Empty className="items-start p-0 text-start">
            <EmptyHeader className="items-start">
              <EmptyDescription>{message}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {updated && !firstLoad && (
          <time dateTime={updated.toISOString()} className="text-xs text-muted-foreground">
            {t("ecard.updatedAt", {
              time: updated.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
                dateStyle: "short",
                timeStyle: "short",
              }),
            })}
          </time>
        )}
        {enabled && !firstLoad && (error || !balance) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            disabled={loading}
            onClick={() => void ecardQuery.refresh()}
          >
            <RefreshCw data-icon="inline-start" className={cn(loading && "animate-spin")} />
            {t("ecard.retry")}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
