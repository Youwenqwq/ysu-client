"use client"

import { useCallback } from "react"
import useSWR from "swr"
import { CreditCard, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useAuthStore } from "@/lib/stores/auth"
import { useMobileHeaderRight } from "@/lib/stores/mobile-header"
import { fetchEcardBalance, type EcardSessionStatus } from "@/providers/ysu/ecard-access"
import { ProviderError, ProviderErrorCode } from "@/providers/errors"
import { providerQueryKey } from "@/providers/hooks/use-provider-query"
import { useProvider, useProviderReady } from "@/providers/use-provider"
import { getSchoolConfigScope } from "@/lib/server-config"
import { cn } from "@/lib/utils"

export default function EcardPage() {
  const { t } = useTranslation()
  const provider = useProvider()
  const isReady = useProviderReady()
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const username = useAuthStore((s) => s.username)

  const credential = useAuthStore((s) => s.credential)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const schoolConfigScope = getSchoolConfigScope()
  const enabled = isReady && hasHydrated && !!username && !!credential && isAuthenticated
  const { data, error: queryError, isLoading, isValidating, mutate } = useSWR<
    EcardSessionStatus,
    ProviderError
  >(
    enabled
      ? providerQueryKey(provider.id, schoolConfigScope, username, "ecard", { credential })
      : null,
    async () => {
      const account = useAuthStore.getState()
      if (
        account.username !== username ||
        account.credential !== credential ||
        getSchoolConfigScope() !== schoolConfigScope
      ) {
        throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "一卡通查询账户已切换")
      }
      const status = await fetchEcardBalance()
      const current = useAuthStore.getState()
      if (
        current.username !== username ||
        current.credential !== credential ||
        getSchoolConfigScope() !== schoolConfigScope
      ) {
        throw new ProviderError(ProviderErrorCode.AUTH_REQUIRED, "一卡通查询账户已切换")
      }
      return status
    },
    { revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: false }
  )
  const balance = enabled ? data?.balance ?? null : null
  const loading = isLoading || isValidating
  const noAuth =
    !isAuthenticated ||
    !credential ||
    queryError?.code === ProviderErrorCode.AUTH_REQUIRED ||
    queryError?.code === ProviderErrorCode.AUTH_SESSION_EXPIRED
  const error = queryError
    ? noAuth ? t("ecard.noAuth") : t("ecard.loadFailed", { message: t("ecard.errorGeneric") })
    : null
  const load = useCallback(async () => {
    if (!enabled) return
    // SWR retains the error for rendering, including when stale data is still available.
    await mutate().catch(() => undefined)
  }, [enabled, mutate])

  useMobileHeaderRight(
    <Button variant="ghost" size="icon-sm" onClick={() => void load()} disabled={!enabled || loading} aria-label={t("ecard.refresh")}>
      <RefreshCw className={cn(loading && "animate-spin")} />
    </Button>,
    [enabled, loading, load, t]
  )

  if (!hasHydrated || (!!username && !isReady)) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (hasHydrated && !username) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CreditCard />
            </EmptyMedia>
            <EmptyTitle>{t("ecard.noAccount")}</EmptyTitle>
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
            <span className="ml-2 text-base font-normal text-muted-foreground">{t("ecard.balanceUnit")}</span>
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
        </CardContent>
      </Card>
    </div>
  )
}