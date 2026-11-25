import { useEffect, useState, type FormEvent } from "react"
import { toast } from "sonner"
import {
  getSlice,
  type CredentialInput,
  type MfaRequest,
  type MfaResult,
  type ProviderRuntimeSnapshot,
  type SchoolProvider,
  type SessionSnapshot,
} from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import {
  blurActiveElement,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldGroup,
  FieldLabel,
  Input,
  Spinner,
} from "@orahako/ui-primitives"
import type { AuthUiDictionary } from "./dictionary"
import {
  formatRateLimitMessage,
  type RateLimitResult,
  type RememberedCredentialEntry,
  type RememberedCredentialsStoreInstance,
} from "./stores"

export interface LoginPageInject {
  readonly hooks: {
    readonly session: ObservableSource<SessionSnapshot>
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
    readonly rememberHydrated: ObservableSource<boolean>
  }
  readonly canRemember: boolean
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
  readonly showMfa: (request: MfaRequest) => Promise<MfaResult> | undefined
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

export const LoginPage: SlotComponent<LoginPageProps> = (props) => {
  const { t, useStore } = props
  const session = props.useSession()
  const providerSnap = props.useProvider()
  const rememberHydrated = props.useRememberHydrated()

  const activeSchoolId = session.activeSchoolId ?? providerSnap.schoolId ?? ""

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(false)
  const [captcha, setCaptcha] = useState("")
  const [captchaUrl, setCaptchaUrl] = useState<string | null>(null)
  const [needsCaptcha, setNeedsCaptcha] = useState(false)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)

  const rememberedForSchool = useStore((state) =>
    activeSchoolId ? state.bySchool[activeSchoolId] : undefined
  )

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
        toast.success(t("login.loginSuccess"))
        props.redirectAfterLogin()
        return
      }

      if (res.needsMfa) {
        toast.info(t("login.mfaRequired"))
        const mfaPromise = props.showMfa({ username })
        if (!mfaPromise) {
          toast.error(t("login.errorMfaVerifyFailed"))
          return
        }
        try {
          const mfaResult = await mfaPromise
          if (mfaResult.type === "wechat") {
            props.rememberCredential(activeProvider.id, rememberedEntry(username, password))
            toast.success(t("login.loginSuccess"))
            props.redirectAfterLogin()
            return
          }
          if (!auth.submitMfaCode) {
            toast.error(t("login.errorMfaVerifyFailed"))
            return
          }
          const mfaCredential = await auth.submitMfaCode({
            challenge: {
              method: mfaResult.method,
              methodCode: mfaResult.methodCode,
              mobileHint: "",
              username,
            },
            code: mfaResult.code,
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
          toast.success(t("login.loginSuccess"))
          props.redirectAfterLogin()
        } catch (err) {
          if (err instanceof Error) {
            toast.error(err.message || t("login.errorMfaVerifyFailed"))
          }
        }
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

  return (
    <div data-auth-login-page="" className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm animate-in duration-500 zoom-in-95 fade-in">
        <CardHeader>
          <CardTitle>{t("login.title")}</CardTitle>
          <CardDescription>{t("login.usernamePlaceholder")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void handleSubmit(event)}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="orahako-login-username">{t("login.usernameLabel")}</FieldLabel>
                <Input
                  id="orahako-login-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder={t("login.usernamePlaceholder")}
                  autoComplete="username"
                  onBlur={() => void handleCheckCaptcha()}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="orahako-login-password">{t("login.passwordLabel")}</FieldLabel>
                <Input
                  id="orahako-login-password"
                  type="&#112;assword"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={t("login.passwordPlaceholder")}
                  autoComplete="current-&#112;assword"
                />
              </Field>
              {needsCaptcha && captchaUrl && (
                <Field>
                  <FieldLabel htmlFor="orahako-login-captcha">{t("login.captchaLabel")}</FieldLabel>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={captchaUrl}
                    alt={t("login.captchaRefreshHint")}
                    className="cursor-pointer rounded-md border transition-opacity hover:opacity-80"
                    onClick={() => void handleCheckCaptcha()}
                  />
                  <Input
                    id="orahako-login-captcha"
                    value={captcha}
                    onChange={(event) => setCaptcha(event.target.value)}
                    placeholder={t("login.captchaPlaceholder")}
                  />
                </Field>
              )}
              {props.canRemember && (
                <Field orientation="horizontal">
                  <Checkbox
                    id="orahako-login-remember"
                    checked={remember}
                    onCheckedChange={(checked) => setRemember(checked === true)}
                  />
                  <FieldLabel
                    htmlFor="orahako-login-remember"
                    className="cursor-pointer text-sm font-normal"
                  >
                    {t("login.remember")}
                  </FieldLabel>
                </Field>
              )}
              <Button type="submit" disabled={loading || countdown > 0}>
                {loading && <Spinner data-icon="inline-start" />}
                {loading
                  ? t("login.loggingIn")
                  : countdown > 0
                    ? t("login.retryAfter", { seconds: countdown })
                    : t("login.submit")}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
