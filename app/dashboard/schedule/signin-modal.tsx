"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/responsive-modal"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useProvider } from "@/providers/use-provider"
import type { SigninActivityDetail, StudentSigninStatus } from "@/providers/types"
import { CheckCircle2, XCircle, Timer, Fingerprint, Hash, QrCode, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  activityId: string | null
  signinType: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SigninModal({ activityId, signinType, open, onOpenChange }: Props) {
  const { t } = useTranslation()
  const provider = useProvider()
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<SigninActivityDetail | null>(null)
  const [status, setStatus] = useState<StudentSigninStatus | null>(null)
  const [signing, setSigning] = useState(false)
  const [result, setResult] = useState<{
    success: boolean
    rank?: number
    attendanceStatus?: number
  } | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [code, setCode] = useState("")
  const codeInputRef = useRef<HTMLInputElement>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const requestVersion = useRef(0)
  const submissionPending = useRef(false)

  useEffect(() => {
    let cancelled = false
    const version = ++requestVersion.current
    submissionPending.current = false
    setDetail(null)
    setStatus(null)
    setResult(null)
    setCountdown(0)
    setCode("")
    setLoadError(null)
    setSigning(false)
    setLoading(false)
    if (!open || !activityId || !provider.mobile) {
      return
    }

    async function load() {
      if (!activityId || !provider.mobile) return
      setLoading(true)
      try {
        const [d, s] = await Promise.all([
          provider.mobile.getSigninDetail({
            activityId,
            title: t("activity.signin"),
          }),
          provider.mobile.getStudentSigninStatus({
            activityId,
            title: t("activity.signin"),
          }),
        ])
        if (cancelled) return
        setDetail(d)
        setStatus(s)
        setCountdown(Math.max(0, d.leftSeconds))
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message || t("activity.loadFailed"))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
      requestVersion.current = version + 1
    }
  }, [open, activityId, provider.mobile, t, retry])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer)
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [countdown])

  async function handleSign(codeValue?: string) {
    if (
      !open ||
      !activityId ||
      !provider.mobile ||
      !detail ||
      !status ||
      loadError ||
      result ||
      countdown <= 0 ||
      alreadySigned ||
      submissionPending.current
    )
      return
    const submittedCode = codeValue?.trim()
    if (activeSigninType === 2 && !/^\d{4}$/.test(submittedCode ?? "")) return
    if (activeSigninType === 3 && !submittedCode) return
    if (![1, 2, 3].includes(activeSigninType)) return
    const version = requestVersion.current
    submissionPending.current = true
    setSigning(true)
    try {
      const res = await provider.mobile.doStudentSign({
        activityId,
        accuracy: 0,
        latitude: 0,
        longitude: 0,
        code: submittedCode,
      })
      if (requestVersion.current !== version) return
      if (res.signOrder > 0 || res.signStatus !== 0) {
        setResult({
          success: true,
          rank: res.signOrder,
          attendanceStatus: res.attendanceStatus,
        })
      } else {
        setResult({
          success: false,
          attendanceStatus: res.attendanceStatus,
        })
      }
    } catch (err) {
      if (requestVersion.current === version) {
        toast.error((err as Error).message || t("activity.signinFailed"))
        setCode("")
      }
    } finally {
      if (requestVersion.current === version) {
        submissionPending.current = false
        setSigning(false)
      }
    }
  }

  function handleCodeChange(value: string) {
    if (submissionPending.current) return
    const digits = value.replace(/\D/g, "").slice(0, 4)
    setCode(digits)
    if (digits.length === 4) {
      void handleSign(digits)
    }
  }

  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, "0")}`
  }

  const activeSigninType = detail?.signinType || signinType
  const alreadySigned = status && (status.signStatus !== 0 || status.signOrder > 0)
  const expired = detail && countdown <= 0 && !alreadySigned

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="sm:max-w-sm">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t("activity.signinTitle")}</ResponsiveModalTitle>
          <ResponsiveModalDescription>{t("activity.signinDesc")}</ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <ResponsiveModalBody>
          {loading && (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          )}

          {!loading && result && (
            <SigninResult
              result={result}
              onRetry={() => {
                setRetry((value) => value + 1)
              }}
            />
          )}

          {!loading && loadError && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="text-sm text-muted-foreground">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>
                {t("activity.retry")}
              </Button>
            </div>
          )}

          {!loading && !loadError && !result && (
            <div className="flex flex-col gap-4">
              {alreadySigned && status && (
                <div className="flex flex-col items-center gap-3 py-4">
                  <CheckCircle2 className="size-12 text-green-500" />
                  <div className="text-center">
                    <p className="text-lg font-semibold">{t("activity.alreadySigned")}</p>
                    {status.signOrder > 0 && status.signOrder !== 999999 && (
                      <p className="text-sm text-muted-foreground">
                        {t("activity.signRank", { rank: status.signOrder })}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {expired && (
                <div className="flex flex-col items-center gap-3 py-4">
                  <XCircle className="size-12 text-destructive" />
                  <p className="text-lg font-semibold">{t("activity.signinExpired")}</p>
                </div>
              )}

              {!alreadySigned && !expired && detail && (
                <>
                  {countdown > 0 && (
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Timer className="size-4" />
                      <span>
                        {t("activity.countdown", {
                          time: formatTime(countdown),
                        })}
                      </span>
                    </div>
                  )}

                  {activeSigninType === 1 && (
                    <Button
                      size="lg"
                      className="w-full gap-2"
                      onClick={() => handleSign()}
                      disabled={signing || countdown <= 0}
                    >
                      {signing ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <Fingerprint className="size-4" />
                      )}
                      {t("activity.signinButton")}
                    </Button>
                  )}

                  {activeSigninType === 2 && (
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex gap-2">
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className={cn(
                              "flex size-12 items-center justify-center rounded-lg border-2 text-xl font-bold transition-colors",
                              code.length > i
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-muted bg-muted/30 text-muted-foreground"
                            )}
                          >
                            {code[i] ?? ""}
                          </div>
                        ))}
                      </div>
                      <Input
                        ref={codeInputRef}
                        name="signin-code"
                        type="tel"
                        inputMode="numeric"
                        maxLength={4}
                        value={code}
                        disabled={signing || countdown <= 0}
                        onChange={(e) => handleCodeChange(e.target.value)}
                        className="absolute opacity-0"
                        style={{ pointerEvents: "auto" }}
                        autoFocus
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("activity.enter4DigitCode")}
                      </p>
                    </div>
                  )}

                  {activeSigninType === 3 && (
                    <div className="flex flex-col items-center gap-3">
                      <QrCode className="size-12 text-muted-foreground" />
                      <p className="text-center text-sm text-muted-foreground">
                        {t("activity.scanCodeDesc")}
                      </p>
                      <Input
                        name="signin-code"
                        placeholder={t("activity.codeInputPlaceholder")}
                        value={code}
                        disabled={signing || countdown <= 0}
                        onChange={(e) => setCode(e.target.value)}
                        className="text-center"
                      />
                      <Button
                        className="w-full"
                        onClick={() => handleSign(code)}
                        disabled={signing || !code.trim() || countdown <= 0}
                      >
                        {signing ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Hash className="size-4" />
                        )}
                        {t("activity.signinButton")}
                      </Button>
                    </div>
                  )}
                  {![1, 2, 3].includes(activeSigninType) && (
                    <p className="text-center text-sm text-muted-foreground">
                      {t("activity.unsupportedSignin")}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </ResponsiveModalBody>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}

function SigninResult({
  result,
  onRetry,
}: {
  result: { success: boolean; rank?: number; attendanceStatus?: number }
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      {result.success ? (
        <>
          <CheckCircle2 className="size-14 text-green-500" />
          <div className="text-center">
            <p className="text-lg font-semibold">{t("activity.signinSuccess")}</p>
            {result.rank && result.rank !== 999999 && (
              <p className="text-sm text-muted-foreground">
                {t("activity.signRank", { rank: result.rank })}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <XCircle className="size-14 text-destructive" />
          <div className="text-center">
            <p className="text-lg font-semibold">{t("activity.signinFailed")}</p>
          </div>
        </>
      )}
      <Button variant="outline" size="sm" className="gap-1" onClick={onRetry}>
        <RotateCcw className="size-3.5" />
        {t("activity.retry")}
      </Button>
    </div>
  )
}
