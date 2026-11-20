import { CreditCard, RefreshCw } from "lucide-react"
import {
  hasSlice,
  isProviderError,
  ProviderErrorCode,
  type EcardSessionStatus,
  type ProviderRuntimeSnapshot,
  type QuerySnapshot,
  type SessionSnapshot,
} from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  cn,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
} from "@orahako/ui-primitives"
import type { EcardDictionary } from "./dictionary"

export interface EcardPageInject {
  readonly hooks: {
    readonly session: ObservableSource<SessionSnapshot>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly ecard: ObservableSource<QuerySnapshot<EcardSessionStatus>>
  }
}

export type EcardPageProps = DerivedComponentProps<
  Record<string, never>,
  EcardDictionary,
  undefined,
  undefined,
  EcardPageInject
>

export function isEcardAuthError(error: Error | null): boolean {
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

export const EcardPage: SlotComponent<EcardPageProps> = (props) => {
  const { t, locale } = props
  const session = props.useSession()
  const providerSnap = props.useProvider()
  const ecardQuery = props.useEcard()

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
  const balance = enabled ? (ecardQuery.data?.balance ?? null) : null
  const updatedAt = enabled ? ecardQuery.updatedAt : null
  const queryError = enabled ? ecardQuery.error : null

  const errorMessage = queryError
    ? noAuth
      ? t("ecard.noAuth")
      : t("ecard.loadFailed", { message: t("ecard.errorGeneric") })
    : null

  const handleRefresh = (): void => {
    if (enabled) {
      void ecardQuery.refresh()
    }
  }

  if (initializing) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (noAccount || !available) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CreditCard />
            </EmptyMedia>
            <EmptyTitle>
              {t(noAccount ? "ecard.noAccount" : "ecard.unsupportedProvider")}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  if (noAuth && !balance) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CreditCard />
            </EmptyMedia>
            <EmptyTitle>{t("ecard.noAuth")}</EmptyTitle>
          </EmptyHeader>
          <Button variant="outline" onClick={handleRefresh} disabled={!enabled || loading}>
            {t("ecard.retry")}
          </Button>
        </Empty>
      </div>
    )
  }

  if (!balance && loading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (!balance) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CreditCard />
            </EmptyMedia>
            <EmptyTitle>{errorMessage || t("ecard.notAvailable")}</EmptyTitle>
          </EmptyHeader>
          <Button variant="outline" onClick={handleRefresh} disabled={!enabled || loading}>
            {t("ecard.retry")}
          </Button>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-ecard-page="">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={loading}
          aria-label={t("ecard.refresh")}
        >
          <RefreshCw data-icon="inline-start" className={cn("size-4", loading && "animate-spin")} />
          {t("ecard.refresh")}
        </Button>
      </div>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary/15 to-primary/5 p-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CreditCard className="size-4" />
            <span>{t("ecard.balance")}</span>
          </div>
          <p className="mt-3 text-4xl font-bold tabular-nums">
            ¥{balance.balance.toFixed(2)}
            <span className="ml-2 text-base font-normal text-muted-foreground">
              {t("ecard.balanceUnit")}
            </span>
          </p>
        </div>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="flex items-center justify-between border-b border-border pb-2 text-sm">
            <span className="text-muted-foreground">{t("ecard.cardNo")}</span>
            <span className="font-mono">{balance.cardNum}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2 text-sm">
            <span className="text-muted-foreground">{t("ecard.validUntil")}</span>
            <span>{balance.availableDate}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("ecard.cardStatus")}</span>
            <span>{balance.cardStatusName}</span>
          </div>
          {updatedAt !== null && (
            <p className="text-xs text-muted-foreground">
              {t("ecard.updatedAt", {
                time: new Date(updatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US"),
              })}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
