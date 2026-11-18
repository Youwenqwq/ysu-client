import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import type {
  DerivedComponentProps,
  ObservableSource,
  SlotComponentOwner,
  Translator,
} from "@orahako/sdk"
import type {
  MfaChallenge,
  MfaMethod,
  MfaRequestInput,
  ProviderRuntimeSnapshot,
  WechatMfaContext,
  WechatQrPollResult,
} from "@orahako/academic-sdk"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  Input,
  Spinner,
  ToggleGroup,
  ToggleGroupItem,
} from "@orahako/ui-primitives"
import { toast } from "sonner"
import type { MfaDictionary } from "./dictionary"
import type { MfaModalStore } from "./store"

declare module "@orahako/sdk" {
  interface SlotMap {
    "shell.overlay": { kind: "list"; owner: Record<string, never> }
  }
}

export const MFA_COUNTDOWN_SECONDS = 120
export const MFA_WECHAT_MAX_FAILURES = 5
export const MFA_WECHAT_DEFAULT_BACKOFF_MS = 2000

export type WechatPollUiStatus =
  | "idle"
  | "initiating"
  | "waiting"
  | "scanned"
  | "confirmed"
  | "error"

export interface MfaModalWechatAdapter {
  isAvailable(): boolean
  initiateWechatMfa(): Promise<WechatMfaContext>
  pollWechatMfaQr(
    uuid: string,
    lastErrcode?: number,
    signal?: AbortSignal
  ): Promise<WechatQrPollResult>
  completeWechatMfa(code: string, state: string, username: string): Promise<string>
}

export interface MfaModalInject {
  readonly isTablet: () => boolean
  readonly canRequestMfaCode: () => boolean
  readonly requestMfaCode: (input: MfaRequestInput) => Promise<MfaChallenge>
  readonly wechatMfa: MfaModalWechatAdapter
  readonly wechatRetryDelayMs?: number
  readonly hooks: {
    readonly providerState: ObservableSource<ProviderRuntimeSnapshot>
  }
}

export type MFAModalProps = DerivedComponentProps<
  SlotComponentOwner<"shell.overlay">,
  MfaDictionary,
  undefined,
  MfaModalStore,
  MfaModalInject
>

function resolveAvailableMethods(
  requestedMethods: readonly MfaMethod[] | undefined,
  showWechat: boolean
): readonly MfaMethod[] {
  if (requestedMethods && requestedMethods.length > 0) {
    const filtered = requestedMethods.filter((item) => item !== "weixin" || showWechat)
    if (filtered.length > 0) return filtered
  }
  return showWechat ? ["weixin", "cpdaily", "sms"] : ["cpdaily", "sms"]
}

function resolveInitialMethod(
  availableMethods: readonly MfaMethod[],
  requestedMethod: MfaMethod | undefined,
  challengeMethod: MfaMethod | undefined,
  showWechat: boolean
): MfaMethod {
  const candidates = [challengeMethod, requestedMethod]
  for (const candidate of candidates) {
    if (!candidate) continue
    if (candidate === "weixin" && !showWechat) continue
    if (availableMethods.includes(candidate)) return candidate
    return candidate
  }
  if (showWechat && availableMethods.includes("weixin")) {
    return "weixin"
  }
  return availableMethods[0] ?? "sms"
}

function renderMethodLabel(method: MfaMethod, t: Translator<MfaDictionary>): string {
  if (method === "weixin") return t("login.mfaMethodWechat")
  if (method === "cpdaily") return t("login.mfaMethodCpdaily")
  if (method === "sms") return t("login.mfaMethodSms")
  return method
}

function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

export function MFAModal(props: MFAModalProps): ReactNode {
  const {
    t,
    useStore,
    actions,
    isTablet,
    canRequestMfaCode,
    requestMfaCode,
    wechatMfa,
    wechatRetryDelayMs = MFA_WECHAT_DEFAULT_BACKOFF_MS,
    useProviderState,
  } = props

  const open = useStore((state) => state.open)
  const requestId = useStore((state) => state.requestId)
  const username = useStore((state) => state.username)
  const requestedMethod = useStore((state) => state.method)
  const requestedMethods = useStore((state) => state.methods)
  const preChallenge = useStore((state) => state.challenge)

  const providerWechatAvailable = useProviderState(
    (snapshot) => snapshot.provider?.slices.auth?.wechatMfa !== undefined
  )
  const providerCanRequestCode = useProviderState(
    (snapshot) => typeof snapshot.provider?.slices.auth?.requestMfaCode === "function"
  )

  const showWechat = isTablet() && (providerWechatAvailable || wechatMfa.isAvailable())
  const availableMethods = useMemo(
    () => resolveAvailableMethods(requestedMethods, showWechat),
    [requestedMethods, showWechat]
  )

  const [mfaMethod, setMfaMethod] = useState<MfaMethod>(() =>
    resolveInitialMethod(availableMethods, requestedMethod, preChallenge?.method, showWechat)
  )
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [localHint, setLocalHint] = useState(() => preChallenge?.mobileHint ?? "")
  const [localMethodCode, setLocalMethodCode] = useState(() => preChallenge?.methodCode ?? "")
  const [countdown, setCountdown] = useState(() =>
    preChallenge?.methodCode ? MFA_COUNTDOWN_SECONDS : 0
  )
  const requestingRef = useRef(false)

  const [wechatStatus, setWechatStatus] = useState<WechatPollUiStatus>("idle")
  const [wechatError, setWechatError] = useState("")
  const [qrImageUrl, setQrImageUrl] = useState("")
  const wechatCtxRef = useRef<{ uuid: string; state: string } | null>(null)
  const pollGenRef = useRef(0)
  const pollAbortRef = useRef<AbortController | null>(null)

  function stopWechatPolling(): void {
    pollGenRef.current += 1
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
  }

  useEffect(() => {
    return () => {
      stopWechatPolling()
    }
  }, [])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [countdown])

  useEffect(() => {
    if (!open) {
      stopWechatPolling()
      return
    }
    const nextMethod = resolveInitialMethod(
      availableMethods,
      requestedMethod,
      preChallenge?.method,
      showWechat
    )
    const preMethodCode = preChallenge?.methodCode ?? ""
    const preHint = preChallenge?.mobileHint ?? ""
    setCode("")
    setMfaMethod(nextMethod)
    setLocalMethodCode(preMethodCode)
    setLocalHint(preHint)
    setCountdown(preMethodCode ? MFA_COUNTDOWN_SECONDS : 0)
    setWechatStatus("idle")
    setWechatError("")
    setQrImageUrl("")
    wechatCtxRef.current = null
    stopWechatPolling()
  }, [open, requestId, availableMethods, requestedMethod, preChallenge, showWechat])

  useEffect(() => {
    if (!open || mfaMethod !== "weixin") {
      stopWechatPolling()
    }
  }, [open, mfaMethod])

  const isWechat = mfaMethod === "weixin"

  async function handleRequestCode(): Promise<void> {
    if (!username || countdown > 0 || requestingRef.current) return
    if (!providerCanRequestCode && !canRequestMfaCode()) {
      toast.error(t("login.errorMfaRequestFailed"))
      return
    }
    requestingRef.current = true
    setLoading(true)
    try {
      const challenge = await requestMfaCode({
        username,
        method: mfaMethod,
      })
      setLocalHint(challenge.mobileHint)
      setLocalMethodCode(challenge.methodCode)
      setCountdown(MFA_COUNTDOWN_SECONDS)
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      toast.error(message || t("login.errorMfaRequestFailed"))
    } finally {
      setLoading(false)
      requestingRef.current = false
    }
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    if (!code || !localMethodCode || isWechat) return
    actions.submitCode({
      method: mfaMethod,
      methodCode: localMethodCode,
      code,
    })
    setCode("")
  }

  function handleCancel(): void {
    stopWechatPolling()
    actions.cancel("cancelled")
    setCode("")
  }

  async function handleWechatOpen(): Promise<void> {
    if (!username) return
    if (!providerWechatAvailable && !wechatMfa.isAvailable()) {
      setWechatStatus("idle")
      setMfaMethod("sms")
      return
    }

    setWechatStatus("initiating")
    setWechatError("")

    const gen = ++pollGenRef.current
    const abort = new AbortController()
    pollAbortRef.current = abort

    try {
      const ctx = await wechatMfa.initiateWechatMfa()
      if (gen !== pollGenRef.current) return
      wechatCtxRef.current = { uuid: ctx.uuid, state: ctx.state }

      setQrImageUrl(ctx.qrImageUrl)
      setWechatStatus("waiting")

      let lastErrcode: number | undefined
      let consecutiveFailures = 0

      while (gen === pollGenRef.current) {
        let result: WechatQrPollResult
        try {
          result = await wechatMfa.pollWechatMfaQr(ctx.uuid, lastErrcode, abort.signal)
        } catch {
          if (gen !== pollGenRef.current || abort.signal.aborted) return
          consecutiveFailures += 1
          if (consecutiveFailures >= MFA_WECHAT_MAX_FAILURES) {
            setWechatStatus("error")
            setWechatError(t("login.errorMfaWechatFailed"))
            return
          }
          await delayWithAbort(wechatRetryDelayMs, abort.signal)
          continue
        }

        if (gen !== pollGenRef.current) return
        consecutiveFailures = 0

        if (result.status === "confirmed" && result.code) {
          setWechatStatus("confirmed")
          stopWechatPolling()

          try {
            await wechatMfa.completeWechatMfa(result.code, ctx.state, username)
            actions.completeWechat()
          } catch (error) {
            const message = error instanceof Error ? error.message : ""
            setWechatStatus("error")
            setWechatError(message || t("login.errorMfaWechatFailed"))
          }
          return
        }

        if (result.status === "expired") {
          setWechatStatus("error")
          setWechatError(t("login.mfaWechatExpired"))
          stopWechatPolling()
          return
        }

        if (result.status === "scanned") {
          setWechatStatus("scanned")
          lastErrcode = result.errcode ?? 404
        } else {
          setWechatStatus("waiting")
          if (result.errcode === 403) {
            lastErrcode = 403
          }
        }
      }
    } catch (error) {
      if (gen !== pollGenRef.current) return
      const message = error instanceof Error ? error.message : ""
      setWechatStatus("error")
      setWechatError(message || t("login.errorMfaWechatFailed"))
    }
  }

  function handleWechatRetry(): void {
    stopWechatPolling()
    setWechatStatus("idle")
    setWechatError("")
    setQrImageUrl("")
    wechatCtxRef.current = null
  }

  function handleMethodChange(nextValue: string): void {
    if (!nextValue) return
    stopWechatPolling()
    setMfaMethod(nextValue)
    setLocalMethodCode("")
    setLocalHint("")
    setCountdown(0)
    setWechatStatus("idle")
    setWechatError("")
    setQrImageUrl("")
    wechatCtxRef.current = null
  }

  const displayMethods = useMemo(() => {
    if (availableMethods.includes(mfaMethod)) return availableMethods
    return [mfaMethod, ...availableMethods]
  }, [availableMethods, mfaMethod])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleCancel()}>
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
                {displayMethods.map((methodItem) => (
                  <ToggleGroupItem key={methodItem} value={methodItem}>
                    {renderMethodLabel(methodItem, t)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </FieldSet>

            {isWechat ? (
              <FieldGroup>
                {wechatStatus === "idle" && (
                  <Button type="button" onClick={() => void handleWechatOpen()}>
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
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={qrImageUrl} alt="WeChat QR" className="size-40" />
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
                  onClick={() => void handleRequestCode()}
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
                    onChange={(event) => setCode(event.target.value)}
                    placeholder={t("login.mfaCodePlaceholder")}
                    autoFocus
                  />
                </Field>
                <Button type="submit" disabled={!code || !localMethodCode}>
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
