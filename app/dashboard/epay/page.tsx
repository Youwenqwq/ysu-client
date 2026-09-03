"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, Wallet } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useAuthStore } from "@/lib/stores/auth"
import { useSettingsStore } from "@/lib/stores/settings"
import { useMobileHeaderRight } from "@/lib/stores/mobile-header"
import { useStudentInfo } from "@/providers/hooks/use-student-info"
import { EpayAccessError, fetchEpayPayments, type EpayRecord } from "@/providers/ysu/epay-access"
import { toRecordStatus } from "@/providers/ysu/protocol/epay"
import { EpayError, fetchEpayBills } from "@/lib/extras/epay/client"
import { cn } from "@/lib/utils"

export default function EpayPage() {
  const { t } = useTranslation()
  const hasHydrated = useAuthStore((s) => s.hasHydrated)
  const username = useAuthStore((s) => s.username)
  const epayAccount = useSettingsStore((s) =>
    username ? s.epayAccountSettings[username] : undefined
  )
  const epayName = epayAccount?.name ?? ""
  const setEpayName = useSettingsStore((s) => s.setEpayName)
  const student = useStudentInfo()

  const [records, setRecords] = useState<EpayRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [nameInput, setNameInput] = useState("")
  const [noAuth, setNoAuth] = useState(false)

  // 姓名的最终取值：用户手动保存的覆盖 > 教务学生信息（无密码 fallback 用）
  const effectiveName = (epayName.trim() || (student.data?.name ?? "").trim()).trim()

  const load = useCallback(async () => {
    if (!username) return
    setLoading(true)
    // 优先走 SSO：教务会话拉取全部付款记录（含已缴）
    try {
      const status = await fetchEpayPayments()
      setRecords(status.records)
      setError(null)
      setNoAuth(false)
      setUpdatedAt(new Date())
    } catch (e) {
      const isAuthErr = e instanceof EpayAccessError

      // SSO 不可用时，使用姓名+学号执行无密码待缴查询兜底。
      if (isAuthErr && effectiveName) {
        try {
          const bills = await fetchEpayBills(username, effectiveName)
          setRecords(
            bills.unpaid.map((b) => ({
              id: b.id,
              payName: b.payName,
              chargeYear: "",
              currencyTypeShow: "",
              amountN: b.amount,
              amount: String(b.amount),
              payAmount: "",
              refundAmount: "",
              status: "1",
              expired: "",
              startTime: "",
              overTime: "",
            }))
          )
          setError(null)
          setNoAuth(false)
          setUpdatedAt(new Date())
          return
        } catch {
          // 兜底查询失败时保留登录/姓名提示，允许用户再次重试。
        }
      }

      if (isAuthErr) {
        setNoAuth(true)
        setRecords([])
        setError(null)
      } else {
        setNoAuth(false)
        const message = e instanceof EpayError ? e.message : t("epay.errorGeneric")
        setError(t("epay.loadFailed", { message }))
      }
    } finally {
      setLoading(false)
    }
  }, [username, effectiveName, t])

  useEffect(() => {
    setRecords(null)
    setError(null)
    setUpdatedAt(null)
    setNoAuth(false)
    setNameInput("")
  }, [username])

  useEffect(() => {
    if (hasHydrated && username) void load()
  }, [hasHydrated, username, load])

  const saveNameAndReload = useCallback(() => {
    const v = nameInput.trim()
    if (!v || !username) return
    setEpayName(username, v)
    toast.success(t("epay.nameSaved"))
  }, [nameInput, username, setEpayName, t])

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
  const unpaid = useMemo(
    () => records?.filter((r) => toRecordStatus(r) === "unpaid") ?? [],
    [records]
  )
  const unpaidTotal = unpaid.reduce((s, r) => s + r.amountN, 0)
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

  // SSO 不可用（未登录教务）时提示并允许用姓名兜底
  if (noAuth) {
    return (
      <div className="p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wallet />
            </EmptyMedia>
            <EmptyTitle>{t("epay.ssoUnavailable")}</EmptyTitle>
          </EmptyHeader>
          {!effectiveName && (
            <div className="flex w-full max-w-sm flex-col gap-2">
              <Input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder={t("epay.namePlaceholder")}
              />
              <Button onClick={saveNameAndReload} disabled={!nameInput.trim()}>
                {t("epay.nameSave")}
              </Button>
            </div>
          )}
          {effectiveName && (
            <Button variant="outline" onClick={() => void load()}>
              {t("epay.retry")}
            </Button>
          )}
        </Empty>
      </div>
    )
  }

  if (!records && loading) {
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
          <Button variant="outline" onClick={() => void load()}>
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
          {unpaidCount === 0 ? (
            <p className="text-sm text-muted-foreground">{t("epay.allPaid")}</p>
          ) : (
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
          )}
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

      <p className="px-1 text-xs text-muted-foreground">
        {t("epay.sourceHint")}
        {updatedAt ? ` · ${t("epay.updatedAt", { time: updatedAt.toLocaleTimeString() })}` : ""}
      </p>
    </div>
  )
}
