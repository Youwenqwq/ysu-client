"use client"

import { CreditCard, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useMobileHeaderRight } from "@/lib/stores/mobile-header"
import { useEcardBalance } from "@/providers/hooks/use-ecard-balance"
import { cn } from "@/lib/utils"

export default function EcardPage() {
  const { t, locale } = useTranslation()
  const {
    data,
    balance,
    updatedAt,
    error: queryError,
    loading,
    initializing,
    noAccount,
    noAuth,
    available,
    enabled,
    refresh: load,
  } = useEcardBalance()
  const error = queryError
    ? noAuth
      ? t("ecard.noAuth")
      : t("ecard.loadFailed", { message: t("ecard.errorGeneric") })
    : null

  useMobileHeaderRight(
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => void load()}
      disabled={!enabled || loading}
      aria-label={t("ecard.refresh")}
    >
      <RefreshCw className={cn(loading && "animate-spin")} />
    </Button>,
    [enabled, loading, load, t]
  )

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
          <Button variant="outline" onClick={() => void load()} disabled={!enabled || loading}>
            {t("ecard.retry")}
          </Button>
        </Empty>
      </div>
    )
  }

  if (!balance && loading) {
    return (
      <div className="flex flex-col gap-4">
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
            <EmptyTitle>{error || t("ecard.notAvailable")}</EmptyTitle>
          </EmptyHeader>
          <Button variant="outline" onClick={() => void load()} disabled={!enabled || loading}>
            {t("ecard.retry")}
          </Button>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="hidden justify-end md:flex">
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw data-icon="inline-start" className={cn(loading && "animate-spin")} />
          {t("ecard.refresh")}
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary/15 to-primary/5 p-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CreditCard className="size-4" />
            <span>{t("ecard.balance")}</span>
          </div>
          <p className="mt-3 text-4xl font-bold">
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
          {updatedAt !== undefined && (
            <p className="text-xs text-muted-foreground">
              {t("ecard.updatedAt", {
                time: new Date(updatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US"),
              })}
            </p>
          )}
        </CardContent>
      </Card>
      {process.env.NEXT_PUBLIC_ECARD_DIAGNOSTICS === "1" && data?.diagnostics && (
        <Card aria-busy={loading}>
          <CardHeader>
            <CardTitle>{t("ecard.diagnosticTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">ECARD-DIAG-20261021-1</p>
            <p className="text-sm text-muted-foreground">{t("ecard.diagnosticHint")}</p>
            {loading && <p role="status">{t("ecard.diagnosticLoading")}</p>}
            {error && (
              <p className="text-destructive" role="status">
                {t("ecard.diagnosticStale")}
              </p>
            )}
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-sm">
              {(
                [
                  ["remining", data.diagnostics.remining],
                  ["datas.KNYE", data.diagnostics.knye],
                ] as const
              ).map(([field, result]) => (
                <div key={field} className="contents">
                  <dt className="font-mono break-all">{field}</dt>
                  <dd className="text-right tabular-nums">
                    {!result.present
                      ? t("ecard.diagnosticMissing")
                      : result.value === null
                        ? t("ecard.diagnosticInvalid")
                        : `¥${result.value.toFixed(2)}`}
                  </dd>
                </div>
              ))}
              <dt>{t("ecard.diagnosticSelected")}</dt>
              <dd className="text-right font-mono">{data.diagnostics.selectedField}</dd>
              <dt>{t("ecard.diagnosticDisplayed")}</dt>
              <dd className="text-right tabular-nums">¥{balance.balance.toFixed(2)}</dd>
            </dl>
            {updatedAt !== undefined && (
              <p className="text-xs text-muted-foreground">
                {t("ecard.diagnosticQueriedAt", {
                  time: new Date(updatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en-US"),
                })}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
