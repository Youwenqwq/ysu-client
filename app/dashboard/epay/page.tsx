"use client"

import { useCallback, useMemo } from "react"
import useSWR from "swr"
import { RefreshCw, Wallet } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useAuthStore } from "@/lib/stores/auth"
import { useMobileHeaderRight } from "@/lib/stores/mobile-header"
import { fetchEpayPayments, type EpayRecord } from "@/providers/ysu/epay-access"
import { ProviderError, ProviderErrorCode } from "@/providers/errors"
import { toRecordStatus } from "@/providers/ysu/protocol/epay"
import { useProvider, useProviderReady } from "@/providers/use-provider"
import { providerQueryKey } from "@/providers/hooks/use-provider-query"
import { getSchoolConfigScope } from "@/lib/server-config"
import { cn } from "@/lib/utils"

export default function EpayPage() {
  const { t } = useTranslation()
  const provider = useProvider()
  const isReady = useProviderReady()
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const username = useAuthStore((s) => s.username)
  const credential = useAuthStore((s) => s.credential)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const schoolConfigScope = getSchoolConfigScope()
  const canQuery = isReady && hasHydrated && !!username && !!credential && isAuthenticated
  const { data, error: queryError, isLoading, isValidating, mutate } = useSWR(
    canQuery
      ? providerQueryKey(provider.id, schoolConfigScope, username, "epay", { credential })
      : null,
    async () => {
      const auth = useAuthStore.getState()
      if (
        auth.username !== username ||
        auth.credential !== credential ||
        getSchoolConfigScope() !== schoolConfigScope
      ) {
        throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "缴费账号已切换")
      }
      const status = await fetchEpayPayments()
      const currentAuth = useAuthStore.getState()
      if (
        currentAuth.username !== username ||
        currentAuth.credential !== credential ||
        getSchoolConfigScope() !== schoolConfigScope
      ) {
        throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "缴费账号已切换")
      }
      return { status, updatedAt: new Date() }
    },
    { revalidateOnFocus: false, shouldRetryOnError: false }
  )
  const records: EpayRecord[] | null = data?.status.records ?? null
  const unpaid = data?.status.unpaid ?? []
  const updatedAt = data?.updatedAt
  const loading = isLoading || isValidating
  const noAuth = (queryError instanceof ProviderError && (
    queryError.code === ProviderErrorCode.AUTH_REQUIRED ||
    queryError.code === ProviderErrorCode.AUTH_SESSION_EXPIRED
  )) || (hasHydrated && !!username && !credential)
  const error = queryError
    ? noAuth
      ? t("epay.ssoUnavailable")
      : t("epay.loadFailed", { message: t("epay.errorGeneric") })
    : null
  const load = useCallback(() => {
    if (canQuery) void mutate().catch(() => undefined)
  }, [canQuery, mutate])

  // 移动端刷新按钮入顶栏
  useMobileHeaderRight(
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => void load()}
      disabled={loading}
      aria-label={t("epay.refresh")}
    >
      <RefreshCw className={cn("size-4", loading && "animate-spin")} />
    </Button>,
    [loading, load, t]
  )

  const paid = useMemo(() => records?.filter((r) => toRecordStatus(r) === "paid") ?? [], [records])
  // 待缴：以 index(我的待付款) 官方口径为准（协议层已按 overTime/status/expired 过滤）
  const unpaidTotal = unpaid.reduce((sum, record) => sum + Math.round(record.amountN * 100), 0) / 100
  const unpaidCount = unpaid.length

  if (hasHydrated && !username) {
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

  // 仅支持教务 SSO，不使用学号和姓名回退查询。
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
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {t("epay.retry")}
          </Button>
        </Empty>
      </div>
    )
  }

  if (!hasHydrated || !isReady || (!records && loading)) {
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
            <EmptyTitle>{error || t("epay.retry")}</EmptyTitle>
          </EmptyHeader>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {t("epay.retry")}
          </Button>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
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
          onClick={() => void load()}
          disabled={loading}
          aria-label={t("epay.refresh")}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          {t("epay.refresh")}
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
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
              {unpaid.map((b, i) => (
                <div key={`${b.id}-${i}`} className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words">{b.payName}</p>
                    <p className="text-xs text-muted-foreground">{b.chargeYear}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 pt-0.5">
                    <Badge variant="destructive">{t("epay.statusUnpaid")}</Badge>
                    <span className="text-sm font-semibold text-destructive">¥{b.amountN}</span>
                  </div>
                </div>
              ))}
              <Separator />
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("epay.unpaidTotal")}</span>
                <span className="text-base font-bold text-destructive">
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
              {paid.map((b, i) => (
                <div key={`${b.id}-${i}`} className="flex items-start justify-between gap-3">
                  <p className="text-sm break-words">{b.payName}</p>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {t("epay.statusPaid")} · ¥{b.amountN}
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
