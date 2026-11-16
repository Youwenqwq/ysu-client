"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  blurActiveElement,
} from "@orahako/plugin-ui/components"
import { useSettingsStore } from "@orahako/plugin-ui/stores"
import { officialSchoolChoices } from "@/plugins/official/app-config"
import { useProvider, useTranslation } from "@orahako/plugin-ui/hooks"
import { usePluginServices } from "@orahako/plugin-ui/plugin"
import type { AcademicPluginContext } from "@orahako/plugin-sdk"
import { isCapacitor } from "@orahako/plugin-ui/platform"
import { checkRateLimit, rateLimitMessage } from "@/plugins/official/runtime/login-rate-limit"
import { useMFAModalStore } from "@/plugins/official/shell/stores/mfa-modal"

export function LoginPage() {
  const router = useRouter()
  const services = usePluginServices<AcademicPluginContext>()
  const provider = useProvider()
  const setSchoolId = useSettingsStore((s) => s.setSchoolId)
  function redirectAfterLogin() {
    const preference = useSettingsStore.getState().defaultLandingPage
    return services.navigation.landing(preference || "overview")
  }
  const { t } = useTranslation()
  const schools = officialSchoolChoices
  const configuredSchool = useSettingsStore((state) => state.schoolId)
  const [selectedSchool, setSelectedSchool] = useState(
    services.session.getSnapshot().activeSchoolId ?? configuredSchool
  )
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(false)
  const [captcha, setCaptcha] = useState("")
  const [captchaUrl, setCaptchaUrl] = useState<string | null>(null)
  const [needsCaptcha, setNeedsCaptcha] = useState(false)
  const [loading, setLoading] = useState(false)
  const [countdown, setCountdown] = useState(0)

  // Web 端 secure-storage 退化为明文 localStorage，刻意不提供"记住密码"，
  // 避免账号密码明文落盘；会话 cookie 的持久化与教务系统本身的安全模型一致。
  const canRemember = isCapacitor()

  useEffect(() => {
    setSelectedSchool(configuredSchool)
  }, [configuredSchool])

  useEffect(() => {
    if (!isCapacitor()) return
    const rememberedUsername = services.session.getArtifact("remembered-username", selectedSchool)
    const rememberedPassword = services.session.getArtifact("remembered-password", selectedSchool)
    if (rememberedUsername && rememberedPassword) {
      setUsername(rememberedUsername)
      setPassword(rememberedPassword)
      setRemember(true)
    }
  }, [services.session, selectedSchool])

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

  function handleSchoolChange(schoolId: string) {
    setSelectedSchool(schoolId)
    setSchoolId(schoolId)
    try {
      services.provider.selectSchool(schoolId)
    } catch {
      // The provider plugin for this school is not installed yet; onboarding installs it.
    }
  }

  function showCaptcha() {
    setNeedsCaptcha(true)
    const captchaUrl = provider.getCaptchaUrl()
    setCaptchaUrl(
      captchaUrl?.startsWith("data:")
        ? captchaUrl
        : captchaUrl
          ? `${captchaUrl}?${Date.now()}`
          : null
    )
  }

  function syncRememberedLoginPreference() {
    if (!isCapacitor()) return
    services.session.setArtifact("remembered-username", remember ? username : null, selectedSchool)
    services.session.setArtifact("remembered-password", remember ? password : null, selectedSchool)
  }

  async function prepareFreshLoginSession() {
    await provider.resetLoginSession()
    await provider.prepareLogin()
  }

  async function handleCheckCaptcha() {
    if (!username) return
    try {
      await prepareFreshLoginSession()
      const captchaNeeded = await provider.checkCaptchaNeeded(username)
      if (captchaNeeded) {
        showCaptcha()
      } else {
        setNeedsCaptcha(false)
        setCaptcha("")
        setCaptchaUrl(null)
      }
    } catch {
      // ignore
    }
  }

  async function doLogin(skipRateLimitCheck: boolean) {
    setLoading(true)
    try {
      if (!needsCaptcha) {
        await prepareFreshLoginSession()
      }

      const res = await provider.loginStep1({
        username,
        password,
        captcha: needsCaptcha ? captcha : undefined,
        skipRateLimit: skipRateLimitCheck,
      })

      if (res.authenticated && res.credential) {
        services.session.setCredential({
          schoolId: selectedSchool,
          credential: res.credential,
          username,
        })
        syncRememberedLoginPreference()
        toast.success(t("login.loginSuccess"))
        router.replace(redirectAfterLogin())
        return
      }

      if (res.needsMfa) {
        toast.info(t("login.mfaRequired"))
        const store = useMFAModalStore.getState()
        try {
          const result = await store.showMFA({ username })
          if (result.type === "wechat") {
            syncRememberedLoginPreference()
            toast.success(t("login.loginSuccess"))
            router.replace(redirectAfterLogin())
            return
          }
          await provider.submitMfaCode({
            challenge: {
              method: result.method,
              methodCode: result.methodCode,
              mobileHint: "",
              username,
            },
            code: result.code,
          })
          syncRememberedLoginPreference()
          toast.success(t("login.loginSuccess"))
          router.replace(redirectAfterLogin())
        } catch (err) {
          if (err instanceof Error) {
            toast.error(err.message || t("login.errorMfaVerifyFailed"))
          }
          // 用户取消时 err 为 undefined，静默处理
        }
        return
      }

      toast.error(t("login.errorLoginFailed"))
    } catch (err) {
      const e = err as Error & { code?: string; status?: number }
      if (e.code === "NEED_CAPTCHA" || e.code === "AUTH_CAPTCHA_REQUIRED") {
        toast.error(t("login.errorCaptchaRequired"))
        await handleCheckCaptcha()
      } else {
        toast.error(e.message || t("login.errorLoginFailed"))
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!username || !password) {
      toast.error(t("login.errorMissingCredentials"))
      return
    }
    // 登录可能弹出 MFA 对话框；先移走焦点，避免 Chrome aria-hidden/focus 警告
    blurActiveElement()

    const limit = checkRateLimit()
    if (!limit.allowed) {
      toast.error(
        rateLimitMessage(limit, t, "login.errorRateLimitWindow", "login.errorRateLimitInterval"),
        {
          action: {
            label: t("login.skipRateLimit"),
            onClick: () => doLogin(true),
          },
        }
      )
      setCountdown(Math.ceil(limit.retryAfterMs / 1000))
      return
    }

    await doLogin(false)
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm animate-in duration-500 zoom-in-95 fade-in">
        <CardHeader>
          <CardTitle>{t("login.title")}</CardTitle>
          <CardDescription>{t("login.usernamePlaceholder")}</CardDescription>
          {schools.length > 1 && (
            <div className="pt-2">
              <Select value={selectedSchool} onValueChange={handleSchoolChange}>
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {schools.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="username">{t("login.usernameLabel")}</FieldLabel>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("login.usernamePlaceholder")}
                  autoComplete="username"
                  onBlur={handleCheckCaptcha}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">{t("login.passwordLabel")}</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("login.passwordPlaceholder")}
                  autoComplete="current-password"
                />
              </Field>
              {needsCaptcha && captchaUrl && (
                <Field>
                  <FieldLabel htmlFor="captcha">{t("login.captchaLabel")}</FieldLabel>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={captchaUrl}
                    alt="captcha"
                    className="cursor-pointer rounded-md border transition-opacity hover:opacity-80"
                    onClick={() => void handleCheckCaptcha()}
                  />
                  <Input
                    id="captcha"
                    value={captcha}
                    onChange={(e) => setCaptcha(e.target.value)}
                    placeholder={t("login.captchaPlaceholder")}
                  />
                </Field>
              )}
              {canRemember && (
                <Field orientation="horizontal">
                  <Checkbox
                    id="remember"
                    checked={remember}
                    onCheckedChange={(c) => setRemember(c === true)}
                  />
                  <FieldLabel htmlFor="remember" className="cursor-pointer text-sm font-normal">
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
