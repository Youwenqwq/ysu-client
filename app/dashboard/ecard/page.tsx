"use client"

import { useCallback, useEffect, useState } from "react"
import { CreditCard, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useAuthStore } from "@/lib/stores/auth"
import { useMobileHeaderRight } from "@/lib/stores/mobile-header"
import { fetchEcardBalance, type EcardBalance } from "@/providers/ysu/ecard-access"
import { cn } from "@/lib/utils"

export default function EcardPage() {
  const { t } = useTranslation()
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const username = useAuthStore((s) => s.username)

  const [balance, setBalance] = useState<EcardBalance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [noAuth, setNoAuth] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const status = await fetchEcardBalance()
      setBalance(status.balance)
      setError(null)
      setNoAuth(false)
    } catch (e) {
      const isAuthErr = e instanceof Error && e.name === "EcardAccessError"
      if (isAuthErr) {
        setNoAuth(true)
        setError(null)
        setBalance(null)
      } else {
        // 只展示友好文案，原始错误（含内部 URL/细节）仅记日志，避免泄露
        console.error("ecard query failed:", e)
        setError(t("ecard.loadFailed", { message: t("ecard.errorGeneric") }))
      }
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (hasHydrated && username) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 学号就绪时首拉一次
  }, [hasHydrated, username])

  useMobileHeaderRight(
    <Button variant="ghost" size="icon-sm" onClick={() => void load()} disabled={loading} aria-label={t("ecard.refresh")}>
      <RefreshCw className={cn("size-4", loading && "animate-spin")} />
    </Button>,
    [loading, load, t]
  )

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

  if (noAuth) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CreditCard />
            </EmptyMedia>
            <EmptyTitle>{t("ecard.noAuth")}</EmptyTitle>
          </EmptyHeader>
          <Button variant="outline" onClick={() => void load()}>
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
          <Button variant="outline" onClick={() => void load()}>
            {t("ecard.retry")}
          </Button>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
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
            <span className="text-primary">{balance.cardStatusName}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}