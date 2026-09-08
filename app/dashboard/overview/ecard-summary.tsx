"use client"

import Link from "next/link"
import { CreditCard, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useTranslation } from "@/lib/i18n/use-translation"
import { cn } from "@/lib/utils"
import { useEcardBalance } from "@/providers/hooks/use-ecard-balance"

export function EcardSummary({ compact }: { compact: boolean }) {
  const { t, locale } = useTranslation()
  const {
    data,
    balance,
    updatedAt,
    error,
    loading,
    initializing,
    noAccount,
    noAuth,
    available,
    enabled,
    isStale,
    refresh,
  } = useEcardBalance()
  const firstLoad = initializing || (!data && loading)
  const updated = updatedAt === undefined ? null : new Date(updatedAt)
  const message = noAccount
    ? t("ecard.noAccount")
    : !available
      ? t("ecard.unsupportedProvider")
      : noAuth
        ? t("ecard.noAuth")
        : error
          ? t("ecard.errorGeneric")
          : t("ecard.notAvailable")

  if (compact)
    return (
      <Link
        href="/dashboard/ecard"
        title={balance ? undefined : message}
        className="flex min-w-0 flex-col gap-1 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        aria-busy={loading || initializing}
      >
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <CreditCard className="size-3.5 shrink-0" />
          <span className="truncate">{t("ecard.title")}</span>
        </span>
        {firstLoad ? (
          <Skeleton className="h-6 w-14" aria-label={t("overviewData.loading")} />
        ) : balance ? (
          <span className="text-base font-semibold tabular-nums">
            ¥{balance.balance.toFixed(2)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground" aria-label={message}>
            {t("overviewData.unavailableShort")}
          </span>
        )}
        {isStale && (
          <span
            role="status"
            title={t("ecard.refreshFailed")}
            className="text-xs text-muted-foreground"
          >
            {t("overviewData.staleShort")}
          </span>
        )}
      </Link>
    )

  return (
    <>
      <CardHeader className="flex flex-row items-center gap-1">
        <CreditCard className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <CardTitle className="min-w-0 flex-1">
          <Link
            href="/dashboard/ecard"
            className="rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("ecard.title")}
          </Link>
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
            onClick={() => void refresh()}
          >
            <RefreshCw data-icon="inline-start" className={cn(loading && "animate-spin")} />
            {t("ecard.retry")}
          </Button>
        )}
      </CardContent>
    </>
  )
}
