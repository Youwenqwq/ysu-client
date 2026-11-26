import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { ArrowLeft, ArrowRight, Eye, EyeOff, RefreshCw, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import {
  getSlice,
  type CredentialInput,
  type MfaMethod,
  type ProviderRuntimeSnapshot,
  type SchoolProvider,
  type SessionSnapshot,
  type WechatQrPollResult,
} from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  SlotComponent,
  Translator,
} from "@orahako/sdk"
import { blurActiveElement, Button, Checkbox, cn, Input, Spinner } from "@orahako/ui-primitives"
import type { AuthUiDictionary } from "./dictionary"
import {
  formatRateLimitMessage,
  type RateLimitResult,
  type RememberedCredentialEntry,
  type RememberedCredentialsStoreInstance,
} from "./stores"

const ONBOARDING_COMPLETING_EVENT = "orahako:onboarding-completing"
const MFA_COUNTDOWN_SECONDS = 120
const MFA_WECHAT_MAX_FAILURES = 5
const MFA_WECHAT_DEFAULT_BACKOFF_MS = 2000
const LOGIN_SUCCESS_DURATION_MS = 850

type WechatPollUiStatus = "idle" | "initiating" | "waiting" | "scanned" | "confirmed" | "error"

const LOGIN_ANIMATION_STYLE = `
@keyframes orahako-login-frame {
  from {
    opacity: 0;
    transform: translate3d(0, 18px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-login-handoff {
  from {
    opacity: 0;
    transform: translate3d(0, 26px, 0) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}
@keyframes orahako-login-draw {
  from {
    stroke-dashoffset: 100;
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  to {
    stroke-dashoffset: 0;
    opacity: 1;
  }
}
@keyframes orahako-login-step-forward {
  from {
    opacity: 0;
    transform: translate3d(24px, 0, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-login-step-back {
  from {
    opacity: 0;
    transform: translate3d(-24px, 0, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-login-field {
  from {
    opacity: 0;
    transform: translate3d(0, 10px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-login-orbit-slow {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
@keyframes orahako-login-spin-cw {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
@keyframes orahako-login-spin-ccw {
  from {
    transform: rotate(45deg);
  }
  to {
    transform: rotate(-315deg);
  }
}
@keyframes orahako-login-pulse {
  0%, 100% {
    transform: rotate(45deg) scale(1);
    opacity: 1;
  }
  50% {
    transform: rotate(45deg) scale(0.76);
    opacity: 0.55;
  }
}
@keyframes orahako-login-loading-enter {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}
@keyframes orahako-login-success-circle {
  0% {
    transform: scale(0.72);
    opacity: 0;
  }
  65% {
    transform: scale(1.04);
    opacity: 1;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
@keyframes orahako-login-success-ripple {
  0% {
    transform: scale(0.84);
    opacity: 0.45;
  }
  100% {
    transform: scale(1.32);
    opacity: 0;
  }
}
@keyframes orahako-login-success-check {
  from {
    stroke-dashoffset: 100;
  }
  to {
    stroke-dashoffset: 0;
  }
}
@keyframes orahako-login-status-text {
  from {
    opacity: 0;
    transform: translate3d(0, 6px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
[data-login-frame] {
  animation: orahako-login-frame 460ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-login-frame][data-login-handoff="true"] {
  animation: orahako-login-handoff 560ms cubic-bezier(0.22, 1, 0.36, 1) 140ms both;
}
[data-login-draw] {
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: orahako-login-draw 1000ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
[data-login-orbit] {
  transform-origin: 160px 160px;
  animation: orahako-login-orbit-slow 64s linear infinite;
}
[data-login-step="credentials"][data-login-direction="back"] {
  animation: orahako-login-step-back 340ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-login-step="mfa"] {
  animation: orahako-login-step-forward 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-login-field] {
  animation: orahako-login-field 360ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-login-loading] {
  animation: orahako-login-loading-enter 260ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-login-loader-outer] {
  transform-origin: 48px 48px;
  animation: orahako-login-spin-cw 6.5s linear infinite;
}
[data-login-loader-inner] {
  transform-origin: 48px 48px;
  animation: orahako-login-spin-ccw 4.8s linear infinite;
}
[data-login-loader-core] {
  transform-origin: 48px 48px;
  animation: orahako-login-pulse 2s ease-in-out infinite;
}
[data-login-success-circle] {
  transform-origin: 48px 48px;
  animation: orahako-login-success-circle 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-login-success-ripple] {
  transform-origin: 48px 48px;
  animation: orahako-login-success-ripple 720ms cubic-bezier(0.22, 1, 0.36, 1) 80ms both;
}
[data-login-success-check] {
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: orahako-login-success-check 360ms cubic-bezier(0.22, 1, 0.36, 1) 180ms forwards;
}
[data-login-status-text] {
  animation: orahako-login-status-text 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@media (prefers-reduced-motion: reduce) {
  [data-login-frame],
  [data-login-frame][data-login-handoff="true"],
  [data-login-draw],
  [data-login-orbit],
  [data-login-step="credentials"][data-login-direction="back"],
  [data-login-step="mfa"],
  [data-login-field],
  [data-login-loading],
  [data-login-loader-outer],
  [data-login-loader-inner],
  [data-login-loader-core],
  [data-login-success-circle],
  [data-login-success-ripple],
  [data-login-success-check],
  [data-login-status-text] {
    animation: none;
    transition: none;
    stroke-dashoffset: 0;
    opacity: 1;
  }
}
`.trim()

export interface LoginPageInject {
  readonly hooks: {
    readonly session: ObservableSource<SessionSnapshot>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly rememberHydrated: ObservableSource<boolean>
  }
  readonly canRemember: boolean
  readonly isTablet?: () => boolean
  /** Resolve the already-selected school provider; login never changes schools. */
  readonly prepareProvider: () => Promise<SchoolProvider | null>
  readonly setCredential: (
    input: CredentialInput,
    remembered: RememberedCredentialEntry | null
  ) => void
  readonly rememberCredential: (
    schoolId: string,
    remembered: RememberedCredentialEntry | null
  ) => void
  readonly redirectAfterLogin: () => void
  readonly checkRateLimit: () => RateLimitResult
  readonly recordLoginAttempt: () => void
}

export type LoginPageProps = DerivedComponentProps<
  Record<string, never>,
  AuthUiDictionary,
  undefined,
  RememberedCredentialsStoreInstance,
  LoginPageInject
>

function isCaptchaError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  if ("code" in error && typeof error.code === "string") {
    return error.code === "NEED_CAPTCHA" || error.code === "AUTH_CAPTCHA_REQUIRED"
  }
  return false
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

function renderMfaMethodLabel(method: MfaMethod, t: Translator<AuthUiDictionary>): string {
  if (method === "weixin") return t("login.mfaMethodWechat")
  if (method === "cpdaily") return t("login.mfaMethodCpdaily")
  if (method === "sms") return t("login.mfaMethodSms")
  return method
}

function GeometricBrandMark({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-5 shrink-0 text-foreground", className)}
      fill="none"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.5" />
      <rect
        x="8.2"
        y="8.2"
        width="7.6"
        height="7.6"
        transform="rotate(45 12 12)"
        fill="currentColor"
      />
    </svg>
  )
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  try {
    return Boolean(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  } catch {
    return false
  }
}

function AuthenticatingStage({
  phase,
  label,
}: {
  readonly phase: "loading" | "success"
  readonly label: string
}) {
  return (
    <div
      data-login-loading={phase}
      role="status"
      aria-live="polite"
      className="flex min-h-72 flex-col items-center justify-center gap-6 py-10 text-center"
    >
      <svg viewBox="0 0 96 96" className="size-24 text-foreground" fill="none" aria-hidden="true">
        {phase === "loading" ? (
          <>
            <g data-login-loader-outer="">
              <circle
                cx="48"
                cy="48"
                r="38"
                stroke="currentColor"
                strokeOpacity="0.28"
                strokeWidth="1"
                strokeDasharray="4 6"
              />
              <circle cx="48" cy="10" r="2.2" fill="currentColor" />
            </g>
            <circle
              cx="48"
              cy="48"
              r="28"
              stroke="currentColor"
              strokeOpacity="0.45"
              strokeWidth="1"
            />
            <g data-login-loader-inner="">
              <rect
                x="29"
                y="29"
                width="38"
                height="38"
                rx="7"
                stroke="currentColor"
                strokeWidth="1.25"
              />
            </g>
            <g data-login-loader-core="">
              <rect x="42" y="42" width="12" height="12" rx="2" fill="currentColor" />
            </g>
          </>
        ) : (
          <>
            <circle
              cx="48"
              cy="48"
              r="34"
              stroke="currentColor"
              strokeWidth="1"
              data-login-success-ripple=""
            />
            <circle cx="48" cy="48" r="28" fill="currentColor" data-login-success-circle="" />
            <path
              d="M36 48.5 L44.5 57 L61 39.5"
              pathLength={100}
              stroke="var(--background)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              data-login-success-check=""
            />
          </>
        )}
      </svg>
      <p
        key={phase}
        data-login-status-text=""
        className={cn(
          "text-sm font-medium tracking-wide",
          phase === "success" ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
      </p>
    </div>
  )
}

function AmbientGeometry({ handoffKey }: { readonly handoffKey: number }) {
  return (
    <div
      key={handoffKey}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* Subtle monochrome architectural grid */}
      <div
        className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(circle at 50% 45%, black 12%, transparent 74%)",
          WebkitMaskImage: "radial-gradient(circle at 50% 45%, black 12%, transparent 74%)",
        }}
      />

      {/* Top-right geometric wireframe motif — positioned below header with clear breathing room */}
      <svg
        viewBox="0 0 320 320"
        className="absolute top-4 -right-14 size-64 text-foreground opacity-20 sm:top-6 sm:-right-8 sm:size-80"
        fill="none"
      >
        <g data-login-orbit="">
          <circle
            cx="160"
            cy="160"
            r="128"
            stroke="currentColor"
            strokeWidth="1"
            strokeDasharray="3 8"
          />
        </g>
        <circle
          cx="160"
          cy="160"
          r="92"
          pathLength={100}
          stroke="currentColor"
          strokeWidth="1"
          data-login-draw=""
          style={{ animationDelay: "120ms" }}
        />
        <rect
          x="96"
          y="96"
          width="128"
          height="128"
          rx="16"
          pathLength={100}
          transform="rotate(45 160 160)"
          stroke="currentColor"
          strokeWidth="1"
          data-login-draw=""
          style={{ animationDelay: "220ms" }}
        />
        <line
          x1="20"
          y1="160"
          x2="300"
          y2="160"
          pathLength={100}
          stroke="currentColor"
          strokeWidth="0.75"
          strokeOpacity="0.5"
          data-login-draw=""
          style={{ animationDelay: "80ms" }}
        />
        <line
          x1="160"
          y1="20"
          x2="160"
          y2="300"
          pathLength={100}
          stroke="currentColor"
          strokeWidth="0.75"
          strokeOpacity="0.5"
          data-login-draw=""
          style={{ animationDelay: "140ms" }}
        />
      </svg>

      {/* Bottom-left diagonal hairline accent */}
      <svg
        viewBox="0 0 240 240"
        className="absolute bottom-4 -left-14 hidden size-56 text-foreground opacity-15 sm:bottom-6 sm:-left-8 sm:block"
        fill="none"
      >
        <rect
          x="36"
          y="36"
          width="168"
          height="168"
          rx="20"
          pathLength={100}
          stroke="currentColor"
          strokeWidth="1"
          data-login-draw=""
          style={{ animationDelay: "180ms" }}
        />
        <line
          x1="0"
          y1="240"
          x2="240"
          y2="0"
          pathLength={100}
          stroke="currentColor"
          strokeWidth="1"
          data-login-draw=""
          style={{ animationDelay: "260ms" }}
        />
      </svg>
    </div>
  )
}

export const LoginPage: SlotComponent<LoginPageProps> = (props) => {
  const { t, useStore } = props
  const session = props.useSession()
  const providerSnap = props.useProvider()
  const rememberHydrated = props.useRememberHydrated()

  const activeSchoolId = session.activeSchoolId ?? providerSnap.schoolId ?? ""
  const schoolDisplayName = providerSnap.provider?.name ?? ""

  // Step & transition state
  const [step, setStep] = useState<"credentials" | "mfa">("credentials")
  const [stepDirection, setStepDirection] = useState<"initial" | "forward" | "back">("initial")
  const [handoffTick, setHandoffTick] = useState(0)

  // Step 1: Credentials state
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(false)
  const [captcha, setCaptcha] = useState("")
  const [captchaUrl, setCaptchaUrl] = useState<string | null>(null)
  const [needsCaptcha, setNeedsCaptcha] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loginSucceeded, setLoginSucceeded] = useState(false)
  const [countdown, setCountdown] = useState(0)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Step 2: Inline MFA state
  const [mfaProvider, setMfaProvider] = useState<SchoolProvider | null>(null)
  const [mfaMethod, setMfaMethod] = useState<MfaMethod>("cpdaily")
  const [mfaCode, setMfaCode] = useState("")
  const [mfaMethodCode, setMfaMethodCode] = useState("")
  const [mfaHint, setMfaHint] = useState("")
  const [mfaRequesting, setMfaRequesting] = useState(false)
  const [mfaSubmitting, setMfaSubmitting] = useState(false)
  const [mfaCountdown, setMfaCountdown] = useState(0)
  const mfaRequestingRef = useRef(false)

  // Step 2: WeChat QR MFA state (tablet)
  const [wechatStatus, setWechatStatus] = useState<WechatPollUiStatus>("idle")
  const [wechatError, setWechatError] = useState("")
  const [qrImageUrl, setQrImageUrl] = useState("")
  const pollGenRef = useRef(0)
  const pollAbortRef = useRef<AbortController | null>(null)

  const rememberedForSchool = useStore((state) =>
    activeSchoolId ? state.bySchool[activeSchoolId] : undefined
  )

  function stopWechatPolling(): void {
    pollGenRef.current += 1
    pollAbortRef.current?.abort()
    pollAbortRef.current = null
  }

  useEffect(() => {
    return () => {
      stopWechatPolling()
      if (successTimerRef.current !== null) {
        clearTimeout(successTimerRef.current)
        successTimerRef.current = null
      }
    }
  }, [])

  function completeLoginWithTransition() {
    if (prefersReducedMotion()) {
      props.redirectAfterLogin()
      return
    }
    setLoginSucceeded(true)
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current)
    }
    successTimerRef.current = setTimeout(() => {
      successTimerRef.current = null
      props.redirectAfterLogin()
    }, LOGIN_SUCCESS_DURATION_MS)
  }

  // Synchronized entrance handoff when onboarding finishes
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return
    const onOnboardingCompleting = () => {
      setHandoffTick((tick) => tick + 1)
    }
    window.addEventListener(ONBOARDING_COMPLETING_EVENT, onOnboardingCompleting)
    return () => {
      window.removeEventListener(ONBOARDING_COMPLETING_EVENT, onOnboardingCompleting)
    }
  }, [])

  useEffect(() => {
    if (!props.canRemember || !rememberHydrated || !activeSchoolId) return
    if (rememberedForSchool) {
      setUsername(rememberedForSchool.username)
      setPassword(rememberedForSchool.password)
      setRemember(true)
    }
  }, [props.canRemember, rememberHydrated, rememberedForSchool, activeSchoolId])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setInterval(() => {
      setCountdown((current) => {
        if (current <= 1) {
          clearInterval(timer)
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [countdown])

  useEffect(() => {
    if (mfaCountdown <= 0) return
    const timer = setInterval(() => {
      setMfaCountdown((current) => {
        if (current <= 1) {
          clearInterval(timer)
          return 0
        }
        return current - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [mfaCountdown])

  useEffect(() => {
    if (step !== "mfa" || mfaMethod !== "weixin") {
      stopWechatPolling()
    }
  }, [step, mfaMethod])

  const activeMfaProvider = mfaProvider ?? providerSnap.provider
  const activeMfaAuth = getSlice(activeMfaProvider, "auth")
  const showWechatMfa = Boolean(props.isTablet?.() && activeMfaAuth?.wechatMfa !== undefined)

  const availableMfaMethods = useMemo<readonly MfaMethod[]>(
    () => (showWechatMfa ? ["weixin", "cpdaily", "sms"] : ["cpdaily", "sms"]),
    [showWechatMfa]
  )

  const isWechatMethod = mfaMethod === "weixin"

  async function resolveActiveProvider(): Promise<SchoolProvider | null> {
    if (providerSnap.provider) return providerSnap.provider
    return props.prepareProvider()
  }

  function rememberedEntry(user: string, pass: string): RememberedCredentialEntry | null {
    return props.canRemember && remember ? { username: user, password: pass } : null
  }

  function refreshCaptchaDisplay(activeProvider: SchoolProvider) {
    const auth = getSlice(activeProvider, "auth")
    const rawUrl = auth?.getCaptchaUrl?.() ?? null
    setNeedsCaptcha(true)
    setCaptchaUrl(rawUrl?.startsWith("data:") ? rawUrl : rawUrl ? `${rawUrl}?${Date.now()}` : null)
  }

  async function handleCheckCaptcha() {
    if (!username || !activeSchoolId) return
    const activeProvider = await resolveActiveProvider()
    const auth = getSlice(activeProvider, "auth")
    if (!activeProvider || !auth) return
    try {
      await auth.resetLoginSession()
      await auth.prepareLogin()
      const captchaNeeded = (await auth.checkCaptchaNeeded?.(username)) ?? false
      if (captchaNeeded) {
        refreshCaptchaDisplay(activeProvider)
      } else {
        setNeedsCaptcha(false)
        setCaptcha("")
        setCaptchaUrl(null)
      }
    } catch {
      // Ignore background captcha probe failures until explicit submit.
    }
  }

  function enterMfaStep(activeProvider: SchoolProvider) {
    const auth = getSlice(activeProvider, "auth")
    const canWechat = Boolean(props.isTablet?.() && auth?.wechatMfa !== undefined)
    stopWechatPolling()
    setMfaProvider(activeProvider)
    setMfaMethod(canWechat ? "weixin" : "cpdaily")
    setMfaCode("")
    setMfaMethodCode("")
    setMfaHint("")
    setMfaCountdown(0)
    setWechatStatus("idle")
    setWechatError("")
    setQrImageUrl("")
    setStepDirection("forward")
    setStep("mfa")
  }

  function handleBackToCredentials() {
    stopWechatPolling()
    setMfaCode("")
    setMfaMethodCode("")
    setMfaHint("")
    setMfaCountdown(0)
    setWechatStatus("idle")
    setWechatError("")
    setQrImageUrl("")
    setStepDirection("back")
    setStep("credentials")
  }

  async function doLogin(skipRateLimitCheck: boolean) {
    const activeProvider = activeSchoolId ? await resolveActiveProvider() : null
    const auth = getSlice(activeProvider, "auth")
    if (!activeProvider || !auth) {
      toast.error(t("login.errorProviderUnavailable"))
      return
    }

    setLoading(true)
    try {
      if (!skipRateLimitCheck) {
        props.recordLoginAttempt()
      }
      if (!needsCaptcha) {
        await auth.resetLoginSession()
        await auth.prepareLogin()
      }

      const res = await auth.loginStep1({
        username,
        password,
        ...(needsCaptcha ? { captcha } : {}),
        skipRateLimit: skipRateLimitCheck,
      })

      if (res.authenticated && res.credential) {
        props.setCredential(
          {
            schoolId: activeProvider.id,
            credential: res.credential,
            username,
          },
          rememberedEntry(username, password)
        )
        completeLoginWithTransition()
        return
      }

      if (res.needsMfa) {
        toast.info(t("login.mfaRequired"))
        enterMfaStep(activeProvider)
        return
      }

      toast.error(t("login.errorLoginFailed"))
    } catch (err) {
      if (isCaptchaError(err)) {
        toast.error(t("login.errorCaptchaRequired"))
        await handleCheckCaptcha()
      } else {
        const message = err instanceof Error ? err.message : ""
        toast.error(message || t("login.errorLoginFailed"))
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!username || !password) {
      toast.error(t("login.errorMissingCredentials"))
      return
    }
    blurActiveElement()

    const limit = props.checkRateLimit()
    if (!limit.allowed) {
      toast.error(
        formatRateLimitMessage(
          limit,
          t,
          "login.errorRateLimitWindow",
          "login.errorRateLimitInterval"
        ),
        {
          action: {
            label: t("login.skipRateLimit"),
            onClick: () => {
              void doLogin(true)
            },
          },
        }
      )
      setCountdown(Math.ceil(limit.retryAfterMs / 1000))
      return
    }

    await doLogin(false)
  }

  function handleMfaMethodChange(nextMethod: MfaMethod) {
    if (nextMethod === mfaMethod) return
    stopWechatPolling()
    setMfaMethod(nextMethod)
    setMfaMethodCode("")
    setMfaHint("")
    setMfaCountdown(0)
    setMfaCode("")
    setWechatStatus("idle")
    setWechatError("")
    setQrImageUrl("")
  }

  async function handleRequestMfaCode() {
    if (!username || mfaCountdown > 0 || mfaRequestingRef.current) return
    const activeProvider = activeMfaProvider ?? (await resolveActiveProvider())
    const auth = getSlice(activeProvider, "auth")
    if (!auth?.requestMfaCode) {
      toast.error(t("login.errorMfaRequestFailed"))
      return
    }

    mfaRequestingRef.current = true
    setMfaRequesting(true)
    try {
      const challenge = await auth.requestMfaCode({
        username,
        method: mfaMethod,
      })
      setMfaHint(challenge.mobileHint)
      setMfaMethodCode(challenge.methodCode)
      setMfaCountdown(MFA_COUNTDOWN_SECONDS)
    } catch (error) {
      const message = error instanceof Error ? error.message : ""
      toast.error(message || t("login.errorMfaRequestFailed"))
    } finally {
      setMfaRequesting(false)
      mfaRequestingRef.current = false
    }
  }

  async function handleMfaSubmit(event: FormEvent) {
    event.preventDefault()
    if (!mfaCode || !mfaMethodCode || isWechatMethod || mfaSubmitting) return
    const activeProvider = activeMfaProvider ?? (await resolveActiveProvider())
    const auth = getSlice(activeProvider, "auth")
    if (!activeProvider || !auth?.submitMfaCode) {
      toast.error(t("login.errorMfaVerifyFailed"))
      return
    }

    blurActiveElement()
    setMfaSubmitting(true)
    try {
      const mfaCredential = await auth.submitMfaCode({
        challenge: {
          method: mfaMethod,
          methodCode: mfaMethodCode,
          mobileHint: mfaHint,
          username,
        },
        code: mfaCode,
      })
      if (mfaCredential) {
        props.setCredential(
          {
            schoolId: activeProvider.id,
            credential: mfaCredential,
            username,
          },
          rememberedEntry(username, password)
        )
      } else {
        props.rememberCredential(activeProvider.id, rememberedEntry(username, password))
      }
      completeLoginWithTransition()
    } catch (err) {
      const message = err instanceof Error ? err.message : ""
      toast.error(message || t("login.errorMfaVerifyFailed"))
    } finally {
      setMfaSubmitting(false)
    }
  }

  async function handleWechatOpen() {
    if (!username) return
    const activeProvider = activeMfaProvider ?? (await resolveActiveProvider())
    const wechat = getSlice(activeProvider, "auth")?.wechatMfa
    if (!activeProvider || !wechat) {
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
      const ctx = await wechat.initiateWechatMfa()
      if (gen !== pollGenRef.current) return

      setQrImageUrl(ctx.qrImageUrl)
      setWechatStatus("waiting")

      let lastErrcode: number | undefined
      let consecutiveFailures = 0

      while (gen === pollGenRef.current) {
        let result: WechatQrPollResult
        try {
          result = await wechat.pollWechatMfaQr(ctx.uuid, lastErrcode, abort.signal)
        } catch {
          if (gen !== pollGenRef.current || abort.signal.aborted) return
          consecutiveFailures += 1
          if (consecutiveFailures >= MFA_WECHAT_MAX_FAILURES) {
            setWechatStatus("error")
            setWechatError(t("login.errorMfaWechatFailed"))
            return
          }
          await delayWithAbort(MFA_WECHAT_DEFAULT_BACKOFF_MS, abort.signal)
          continue
        }

        if (gen !== pollGenRef.current) return
        consecutiveFailures = 0

        if (result.status === "confirmed" && result.code) {
          setWechatStatus("confirmed")
          stopWechatPolling()

          try {
            const credential = await wechat.completeWechatMfa(result.code, ctx.state)
            props.setCredential(
              {
                schoolId: activeProvider.id,
                credential,
                username,
              },
              rememberedEntry(username, password)
            )
            completeLoginWithTransition()
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

  function handleWechatRetry() {
    stopWechatPolling()
    setWechatStatus("idle")
    setWechatError("")
    setQrImageUrl("")
  }

  const showStatusStage = loginSucceeded || loading || mfaSubmitting
  const statusPhase: "loading" | "success" = loginSucceeded ? "success" : "loading"
  const statusLabel = loginSucceeded
    ? t("login.loginSuccess")
    : mfaSubmitting
      ? t("login.mfaVerifying")
      : t("login.loggingIn")

  return (
    <div
      data-auth-login-page=""
      className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-x-hidden overflow-y-auto bg-background px-5 py-10 text-foreground sm:px-8"
    >
      <style data-login-animations="">{LOGIN_ANIMATION_STYLE}</style>
      <AmbientGeometry handoffKey={handoffTick} />

      <div
        key={handoffTick}
        data-login-frame=""
        data-login-handoff={handoffTick > 0 ? "true" : undefined}
        className="relative z-10 w-full max-w-md"
      >
        {showStatusStage ? (
          <AuthenticatingStage phase={statusPhase} label={statusLabel} />
        ) : (
          <>
            {/* Top bar: brand mark + clean hairline divider */}
            <div className="mb-8 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <GeometricBrandMark />
                  <span className="truncate text-sm font-semibold tracking-wide">
                    {t("login.title")}
                  </span>
                </div>
              </div>
              <div className="h-px w-full bg-border" aria-hidden="true">
                {step === "mfa" && (
                  <div className="h-full w-full bg-foreground transition-all duration-300" />
                )}
              </div>
            </div>

            {/* Main stage */}
            <div>
              {step === "credentials" ? (
                <section
                  key="credentials"
                  data-login-step="credentials"
                  data-login-direction={stepDirection}
                >
                  <div className="mb-7">
                    {schoolDisplayName && (
                      <p className="mb-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
                        <span
                          className="inline-block size-1.5 rounded-full bg-foreground"
                          aria-hidden="true"
                        />
                        <span>{schoolDisplayName}</span>
                      </p>
                    )}
                    <h1 className="text-2xl font-semibold tracking-tight">{t("login.heading")}</h1>
                    <p className="mt-1.5 text-sm text-muted-foreground">{t("login.subtitle")}</p>
                  </div>

                  <form onSubmit={(event) => void handleSubmit(event)} className="space-y-6">
                    {/* Username */}
                    <div
                      data-login-field=""
                      style={{ animationDelay: "60ms" }}
                      className="group relative"
                    >
                      <label
                        htmlFor="orahako-login-username"
                        className="mb-1.5 block text-xs font-medium text-muted-foreground transition-colors group-focus-within:text-foreground"
                      >
                        {t("login.usernameLabel")}
                      </label>
                      <div className="relative border-b border-border">
                        <Input
                          id="orahako-login-username"
                          value={username}
                          onChange={(event) => setUsername(event.target.value)}
                          placeholder={t("login.usernamePlaceholder")}
                          autoComplete="username"
                          onBlur={() => void handleCheckCaptcha()}
                          className="h-10 rounded-none border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
                        />
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute right-0 -bottom-px left-0 h-[1.5px] origin-left scale-x-0 bg-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-focus-within:scale-x-100"
                        />
                      </div>
                    </div>

                    {/* Password */}
                    <div
                      data-login-field=""
                      style={{ animationDelay: "120ms" }}
                      className="group relative"
                    >
                      <label
                        htmlFor="orahako-login-password"
                        className="mb-1.5 block text-xs font-medium text-muted-foreground transition-colors group-focus-within:text-foreground"
                      >
                        {t("login.passwordLabel")}
                      </label>
                      <div className="relative flex items-center border-b border-border">
                        <Input
                          id="orahako-login-password"
                          type={showPassword ? "text" : "password"}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          placeholder={t("login.passwordPlaceholder")}
                          autoComplete="current-&#112;assword"
                          className="h-10 flex-1 rounded-none border-0 bg-transparent px-0 pr-9 text-base shadow-none focus-visible:ring-0"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((prev) => !prev)}
                          aria-label={
                            showPassword ? t("login.hidePassword") : t("login.showPassword")
                          }
                          className="absolute right-0 flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {showPassword ? (
                            <EyeOff className="size-4" />
                          ) : (
                            <Eye className="size-4" />
                          )}
                        </button>
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute right-0 -bottom-px left-0 h-[1.5px] origin-left scale-x-0 bg-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-focus-within:scale-x-100"
                        />
                      </div>
                    </div>

                    {/* Captcha (conditional) */}
                    {needsCaptcha && captchaUrl && (
                      <div
                        data-login-field=""
                        style={{ animationDelay: "160ms" }}
                        className="group relative"
                      >
                        <label
                          htmlFor="orahako-login-captcha"
                          className="mb-2 block text-xs font-medium text-muted-foreground transition-colors group-focus-within:text-foreground"
                        >
                          {t("login.captchaLabel")}
                        </label>
                        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border p-2.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={captchaUrl}
                            alt={t("login.captchaRefreshHint")}
                            className="h-10 cursor-pointer rounded-md object-contain transition-opacity hover:opacity-80"
                            onClick={() => void handleCheckCaptcha()}
                          />
                          <button
                            type="button"
                            onClick={() => void handleCheckCaptcha()}
                            aria-label={t("login.captchaRefreshHint")}
                            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
                          >
                            <RefreshCw className="size-4" />
                          </button>
                        </div>
                        <div className="relative border-b border-border">
                          <Input
                            id="orahako-login-captcha"
                            value={captcha}
                            onChange={(event) => setCaptcha(event.target.value)}
                            placeholder={t("login.captchaPlaceholder")}
                            className="h-10 rounded-none border-0 bg-transparent px-0 text-base shadow-none focus-visible:ring-0"
                          />
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute right-0 -bottom-px left-0 h-[1.5px] origin-left scale-x-0 bg-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-focus-within:scale-x-100"
                          />
                        </div>
                      </div>
                    )}

                    {/* Remember password */}
                    {props.canRemember && (
                      <div
                        data-login-field=""
                        style={{ animationDelay: "180ms" }}
                        className="flex items-center gap-2.5 pt-1"
                      >
                        <Checkbox
                          id="orahako-login-remember"
                          checked={remember}
                          onCheckedChange={(checked) => setRemember(checked === true)}
                        />
                        <label
                          htmlFor="orahako-login-remember"
                          className="cursor-pointer text-sm text-muted-foreground select-none hover:text-foreground"
                        >
                          {t("login.remember")}
                        </label>
                      </div>
                    )}

                    {/* Submit button */}
                    <div data-login-field="" style={{ animationDelay: "220ms" }} className="pt-2">
                      <Button
                        type="submit"
                        disabled={loading || countdown > 0}
                        className="group h-12 w-full rounded-xl bg-foreground text-background transition-all hover:bg-foreground/90 active:scale-[0.985]"
                      >
                        {loading && <Spinner data-icon="inline-start" />}
                        <span>
                          {loading
                            ? t("login.loggingIn")
                            : countdown > 0
                              ? t("login.retryAfter", { seconds: countdown })
                              : t("login.submit")}
                        </span>
                        {!loading && countdown <= 0 && (
                          <ArrowRight
                            data-icon="inline-end"
                            className="size-4 transition-transform duration-200 group-hover:translate-x-1"
                          />
                        )}
                      </Button>
                    </div>
                  </form>
                </section>
              ) : (
                <section key="mfa" data-login-step="mfa">
                  {/* Back + active account hairline bar */}
                  <div className="mb-6 flex items-center justify-between gap-2 border-b border-border pb-3">
                    <button
                      type="button"
                      onClick={handleBackToCredentials}
                      disabled={mfaSubmitting}
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      <ArrowLeft className="size-3.5" />
                      <span>{t("login.mfaBack")}</span>
                    </button>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {username}
                    </span>
                  </div>

                  <div className="mb-6">
                    <div className="mb-1.5 flex items-center gap-2">
                      <ShieldCheck className="size-5 text-foreground" />
                      <h1 className="text-2xl font-semibold tracking-tight">
                        {t("login.mfaHeading")}
                      </h1>
                    </div>
                    <p className="text-sm text-muted-foreground">{t("login.mfaDescription")}</p>
                  </div>

                  {/* Monochrome rounded segmented MFA method selector */}
                  <div className="mb-6">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      {t("login.mfaMethod")}
                    </p>
                    <div
                      role="radiogroup"
                      aria-label={t("login.mfaMethod")}
                      className="grid gap-1 rounded-xl border border-border p-1"
                      style={{
                        gridTemplateColumns: `repeat(${availableMfaMethods.length}, minmax(0, 1fr))`,
                      }}
                    >
                      {availableMfaMethods.map((methodItem) => {
                        const active = mfaMethod === methodItem
                        return (
                          <button
                            key={methodItem}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => handleMfaMethodChange(methodItem)}
                            className={cn(
                              "h-9 rounded-lg text-xs font-medium transition-colors",
                              active
                                ? "bg-foreground text-background"
                                : "bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            )}
                          >
                            {renderMfaMethodLabel(methodItem, t)}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {isWechatMethod ? (
                    <div className="space-y-4">
                      {wechatStatus === "idle" && (
                        <Button
                          type="button"
                          onClick={() => void handleWechatOpen()}
                          className="h-11 w-full rounded-xl bg-foreground text-background hover:bg-foreground/90"
                        >
                          {t("login.mfaWechatOpen")}
                        </Button>
                      )}

                      {wechatStatus === "initiating" && (
                        <Button type="button" disabled className="h-11 w-full rounded-xl">
                          <Spinner data-icon="inline-start" />
                          {t("login.mfaWechatOpening")}
                        </Button>
                      )}

                      {(wechatStatus === "waiting" || wechatStatus === "scanned") && (
                        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border p-5">
                          {qrImageUrl && (
                            <div className="rounded-xl border border-border bg-white p-2.5">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={qrImageUrl}
                                alt="WeChat QR"
                                className="size-40 rounded-md"
                              />
                            </div>
                          )}
                          <p className="text-center text-xs text-muted-foreground">
                            {wechatStatus === "scanned"
                              ? t("login.mfaWechatScanned")
                              : t("login.mfaWechatWaiting")}
                          </p>
                        </div>
                      )}

                      {wechatStatus === "confirmed" && (
                        <p className="rounded-xl border border-border px-3 py-2.5 text-center text-xs text-foreground">
                          {t("login.mfaWechatConfirmed")}
                        </p>
                      )}

                      {wechatStatus === "error" && (
                        <div className="space-y-3">
                          <p className="rounded-xl border border-destructive/40 px-3 py-2 text-xs text-destructive">
                            {wechatError || t("login.mfaWechatFailed")}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={handleWechatRetry}
                            className="h-10 w-full rounded-xl"
                          >
                            {t("login.mfaWechatRetry")}
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <form onSubmit={(event) => void handleMfaSubmit(event)} className="space-y-5">
                      <div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleRequestMfaCode()}
                          disabled={mfaRequesting || mfaCountdown > 0}
                          className="h-10 w-full rounded-xl"
                        >
                          {mfaRequesting && <Spinner data-icon="inline-start" />}
                          {mfaCountdown > 0
                            ? t("login.mfaResend", { seconds: mfaCountdown })
                            : mfaRequesting
                              ? t("login.mfaRequesting")
                              : t("login.mfaRequest")}
                        </Button>
                        {mfaMethodCode && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {t("login.mfaSent")} {mfaHint || t("login.mfaSentCpdailyApp")}
                          </p>
                        )}
                      </div>

                      <div className="group relative">
                        <label
                          htmlFor="orahako-login-mfa-code"
                          className="mb-1.5 block text-xs font-medium text-muted-foreground transition-colors group-focus-within:text-foreground"
                        >
                          {t("login.mfaCodeLabel")}
                        </label>
                        <div className="relative border-b border-border">
                          <Input
                            id="orahako-login-mfa-code"
                            value={mfaCode}
                            onChange={(event) => setMfaCode(event.target.value)}
                            placeholder={t("login.mfaCodePlaceholder")}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            autoFocus
                            className="h-11 rounded-none border-0 bg-transparent px-0 font-mono text-lg tracking-[0.25em] shadow-none focus-visible:ring-0"
                          />
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute right-0 -bottom-px left-0 h-[1.5px] origin-left scale-x-0 bg-foreground transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-focus-within:scale-x-100"
                          />
                        </div>
                      </div>

                      <Button
                        type="submit"
                        disabled={!mfaCode || !mfaMethodCode || mfaSubmitting}
                        className="group h-12 w-full rounded-xl bg-foreground text-background transition-all hover:bg-foreground/90 active:scale-[0.985]"
                      >
                        {mfaSubmitting && <Spinner data-icon="inline-start" />}
                        <span>
                          {mfaSubmitting ? t("login.mfaVerifying") : t("login.mfaVerify")}
                        </span>
                        {!mfaSubmitting && (
                          <ArrowRight
                            data-icon="inline-end"
                            className="size-4 transition-transform duration-200 group-hover:translate-x-1"
                          />
                        )}
                      </Button>
                    </form>
                  )}
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
