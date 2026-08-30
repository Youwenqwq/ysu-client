"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
  FieldDescription,
} from "@/components/ui/field"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useMFAModalStore } from "@/lib/stores/mfa-modal"
import { useTranslation } from "@/lib/i18n/use-translation"
import { getActiveProvider } from "@/providers/provider-service"
import type { WechatQrPollResult } from "@/providers/types"
import type { YSUMfaMethod } from "@/providers/ysu"
import { useAuthStore } from "@/lib/stores/auth"
import { isTablet } from "@/lib/native/platform"
import { toast } from "sonner"

const COUNTDOWN_SECONDS = 120

type WechatStatus = "idle" | "initiating" | "waiting" | "scanned" | "confirmed" | "error"

export function MFAModal() {
  const { t } = useTranslation()
  const {
    open,
    username,
    cancelMFA,
    submitMFA,
    completeWechatMFA: storeComplete,
  } = useMFAModalStore()
  const showWechat = isTablet()
  const defaultMethod = showWechat ? "weixin" : "sms"
  const [mfaMethod, setMfaMethod] = useState<YSUMfaMethod>(defaultMethod)
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [localHint, setLocalHint] = useState("")
  const [localMethodCode, setLocalMethodCode] = useState("")
  const [countdown, setCountdown] = useState(0)
  const requestingRef = useRef(false)

  // WeChat state
  const [wechatStatus, setWechatStatus] = useState<WechatStatus>("idle")
  const [wechatError, setWechatError] = useState("")
  const [qrImageUrl, setQrImageUrl] = useState("")
  const wechatCtxRef = useRef<{ uuid: string; state: string } | null>(null)
  // 轮询代数令牌：每次启动/停止自增。旧循环的 in-flight 长轮询返回后
  // 比对代数即退出，避免切换 MFA 方式后旧 uuid 的轮询被新流程复活。
  const pollGenRef = useRef(0)
  const pollAbortRef = useRef<AbortController | null>(null)

  function stopWechatPolling() {
    pollGenRef.current++
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
  }

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

  useEffect(() => {
    if (!open) return
    setCode("")
    setMfaMethod(showWechat ? "weixin" : "sms")
    setLocalHint("")
    setLocalMethodCode("")
    setCountdown(0)
    setWechatStatus("idle")
    setWechatError("")
    setQrImageUrl("")
    wechatCtxRef.current = null
    stopWechatPolling()
  }, [open, showWechat])

  // Stop polling when modal closes or method changes away from weixin.
  useEffect(() => {
    if (!open || mfaMethod !== "weixin") {
      stopWechatPolling()
    }
  }, [open, mfaMethod])

  async function handleRequestCode() {
    if (!username || countdown > 0 || requestingRef.current) return
    requestingRef.current = true
    setLoading(true)
    try {
      const res = await getActiveProvider().requestMfaCode({
        username,
        method: mfaMethod,
      })
      setLocalHint(res.mobileHint)
      setLocalMethodCode(res.methodCode)
      setCountdown(COUNTDOWN_SECONDS)
    } catch (err) {
      toast.error((err as Error).message || t("login.errorMfaRequestFailed"))
    } finally {
      setLoading(false)
      requestingRef.current = false
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!code || !localMethodCode || isWechat) return
    submitMFA({
      method: mfaMethod,
      methodCode: localMethodCode,
      code,
    })
    setCode("")
  }

  function handleCancel() {
    stopWechatPolling()
    cancelMFA()
    setCode("")
  }

  // ── WeChat flow ────────────────────────────────────────────────────

  async function handleWechatOpen() {
    if (!username) return
    setWechatStatus("initiating")
    setWechatError("")

    const gen = ++pollGenRef.current
    const abort = new AbortController()
    pollAbortRef.current = abort

    try {
      const provider = getActiveProvider()
      const ctx = await provider.initiateWechatMfa()
      if (gen !== pollGenRef.current) return // 等待期间流程已被取消/取代
      wechatCtxRef.current = { uuid: ctx.uuid, state: ctx.state }

      // CAS's WeChat app only supports qrconnect (PC QR-scan login).
      // 二维码立即渲染，长轮询后台并行（与官方网页行为一致）——
      // lp.open.weixin.qq.com 无状态变化时会挂起约 25s 才返回，
      // 若等首次 poll 再渲染，用户会白等 15~20s。
      setQrImageUrl(ctx.qrImageUrl)
      setWechatStatus("waiting")

      // Start polling.
      let lastErrcode: number | undefined
      let consecutiveFailures = 0

      while (gen === pollGenRef.current) {
        let result: WechatQrPollResult
        try {
          result = await provider.pollWechatMfaQr(ctx.uuid, lastErrcode, abort.signal)
        } catch {
          // Poll request itself failed (network, timeout, abort) — 退避后重试，
          // 连续失败超上限则报错退出，避免代理瞬断造成高频重试风暴。
          if (gen !== pollGenRef.current || abort.signal.aborted) return
          consecutiveFailures++
          if (consecutiveFailures >= 5) {
            setWechatStatus("error")
            setWechatError(t("login.errorMfaWechatFailed"))
            return
          }
          const { promise: backoff, resolve: backoffDone } = Promise.withResolvers<void>()
          setTimeout(backoffDone, 2000)
          await backoff
          continue
        }
        if (gen !== pollGenRef.current) return // 长轮询挂起期间流程已切换
        consecutiveFailures = 0

        if (result.status === "confirmed" && result.code) {
          setWechatStatus("confirmed")
          stopWechatPolling()

          try {
            const credential = await provider.completeWechatMfa(result.code, ctx.state)
            useAuthStore.getState().setCredential(credential, username)
            storeComplete()
          } catch (err) {
            setWechatStatus("error")
            setWechatError((err as Error).message || t("login.errorMfaWechatFailed"))
          }
          return
        }

        if (result.status === "expired") {
          // 终态（402 过期 / 空响应体 / 666 等未知码）：官方页面同样停止轮询。
          setWechatStatus("error")
          setWechatError(t("login.mfaWechatExpired"))
          stopWechatPolling()
          return
        }

        if (result.status === "scanned") {
          setWechatStatus("scanned")
          lastErrcode = result.errcode ?? 404
        } else {
          // waiting：408 等待扫码；403 用户在微信中取消（官方行为：带 last 继续轮询）
          setWechatStatus("waiting")
          if (result.errcode === 403) lastErrcode = 403
        }
      }
    } catch (err) {
      if (gen !== pollGenRef.current) return // 错误归属已被新流程取代
      setWechatStatus("error")
      setWechatError((err as Error).message || t("login.errorMfaWechatFailed"))
    }
  }

  function handleWechatRetry() {
    stopWechatPolling()
    setWechatStatus("idle")
    setWechatError("")
    setQrImageUrl("")
    wechatCtxRef.current = null
  }

  function handleMethodChange(v: string) {
    if (!v) return
    stopWechatPolling()
    setMfaMethod(v as YSUMfaMethod)
    setLocalMethodCode("")
    setLocalHint("")
    setCountdown(0)
    setWechatStatus("idle")
    setWechatError("")
    setQrImageUrl("")
    wechatCtxRef.current = null
  }

  const isWechat = mfaMethod === "weixin"

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("login.mfaTitle")}</DialogTitle>
          <DialogDescription>{t("autoLogin.mfaDescription")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <FieldSet>
              <FieldLegend variant="label">{t("login.mfaMethod")}</FieldLegend>
              <ToggleGroup
                type="single"
                value={mfaMethod}
                onValueChange={handleMethodChange}
                className="justify-start"
              >
                {showWechat && (
                  <ToggleGroupItem value="weixin">{t("login.mfaMethodWechat")}</ToggleGroupItem>
                )}
                <ToggleGroupItem value="cpdaily">{t("login.mfaMethodCpdaily")}</ToggleGroupItem>
                <ToggleGroupItem value="sms">{t("login.mfaMethodSms")}</ToggleGroupItem>
              </ToggleGroup>
            </FieldSet>

            {isWechat ? (
              <FieldGroup>
                {wechatStatus === "idle" && (
                  <Button type="button" onClick={handleWechatOpen}>
                    {t("login.mfaWechatOpen")}
                  </Button>
                )}
                {wechatStatus === "initiating" && (
                  <Button type="button" disabled>
                    <Spinner data-icon="inline-start" />
                    {t("login.mfaWechatOpening")}
                  </Button>
                )}
                {(wechatStatus === "waiting" || wechatStatus === "scanned") && (
                  <FieldGroup>
                    {qrImageUrl && (
                      <div className="flex justify-center">
                        <Image
                          src={qrImageUrl}
                          alt="WeChat QR"
                          width={160}
                          height={160}
                          className="size-40"
                          unoptimized
                        />
                      </div>
                    )}
                    <FieldDescription>
                      {wechatStatus === "scanned"
                        ? t("login.mfaWechatScanned")
                        : t("login.mfaWechatWaiting")}
                    </FieldDescription>
                  </FieldGroup>
                )}
                {wechatStatus === "confirmed" && (
                  <FieldDescription>{t("login.mfaWechatConfirmed")}</FieldDescription>
                )}
                {wechatStatus === "error" && (
                  <FieldGroup>
                    <FieldDescription className="text-destructive">
                      {wechatError || t("login.mfaWechatFailed")}
                    </FieldDescription>
                    <Button type="button" variant="outline" onClick={handleWechatRetry}>
                      {t("login.mfaWechatRetry")}
                    </Button>
                  </FieldGroup>
                )}
              </FieldGroup>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRequestCode}
                  disabled={loading || countdown > 0}
                >
                  {loading && <Spinner data-icon="inline-start" />}
                  {countdown > 0
                    ? t("login.mfaResend", { seconds: countdown })
                    : loading
                      ? t("login.mfaRequesting")
                      : t("login.mfaRequest")}
                </Button>
                {localMethodCode && (
                  <FieldDescription>
                    {t("login.mfaSent")} {localHint || t("login.mfaSentCpdailyApp")}
                  </FieldDescription>
                )}
                <Field>
                  <FieldLabel htmlFor="mfa-modal-code">{t("login.mfaCodeLabel")}</FieldLabel>
                  <Input
                    id="mfa-modal-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={t("login.mfaCodePlaceholder")}
                    autoFocus
                  />
                </Field>
                <Button type="submit" disabled={!code}>
                  {t("login.mfaVerify")}
                </Button>
              </>
            )}

            <Button type="button" variant="ghost" onClick={handleCancel}>
              {t("login.back")}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
