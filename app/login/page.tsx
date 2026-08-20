"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuthStore } from "@/lib/stores/auth";
import { blurActiveElement } from "@/lib/utils";
import { useSettingsStore } from "@/lib/stores/settings";
import { useTranslation } from "@/lib/i18n/use-translation";
import { getSchoolId, setSchoolConfig } from "@/lib/server-config";
import { getSelectableSchools } from "@/providers/supported-schools";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  loadRememberedCredentials,
  saveRememberedCredentials,
  clearRememberedCredentials,
} from "@/lib/storage/secure";
import { checkRateLimit, rateLimitMessage } from "@/lib/rate-limit";
import { useMFAModalStore } from "@/lib/stores/mfa-modal";
import { getActiveProvider, setActiveProviderSchool } from "@/providers/provider-service";

export default function LoginPage() {
  const router = useRouter();
  const setCredential = useAuthStore((s) => s.setCredential);
  const setSchoolId = useSettingsStore((s) => s.setSchoolId);
  const { t } = useTranslation();

  const schools = getSelectableSchools();
  const [selectedSchool, setSelectedSchool] = useState(getSchoolId());
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [captchaUrl, setCaptchaUrl] = useState<string | null>(null);
  const [needsCaptcha, setNeedsCaptcha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    loadRememberedCredentials().then((r) => {
      if (r) {
        setUsername(r.username);
        setPassword(r.password);
        setRemember(true);
      }
    });
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  function handleSchoolChange(schoolId: string) {
    setSelectedSchool(schoolId);
    setSchoolId(schoolId);
    setSchoolConfig(schoolId);
    setActiveProviderSchool(schoolId);
  }

  function showCaptcha() {
    setNeedsCaptcha(true);
    const captchaUrl = getActiveProvider().getCaptchaUrl();
    setCaptchaUrl(captchaUrl ? `${captchaUrl}?${Date.now()}` : null);
  }

  async function syncRememberedLoginPreference() {
    if (remember) {
      await saveRememberedCredentials(username, password);
    } else {
      await clearRememberedCredentials();
    }
  }

  async function prepareFreshLoginSession() {
    const provider = getActiveProvider();
    await provider.resetLoginSession();
    await provider.prepareLogin();
  }

  async function handleCheckCaptcha() {
    if (!username) return;
    try {
      await prepareFreshLoginSession();
      const captchaNeeded = await getActiveProvider().checkCaptchaNeeded(username);
      if (captchaNeeded) {
        showCaptcha();
      } else {
        setNeedsCaptcha(false);
        setCaptcha("");
        setCaptchaUrl(null);
      }
    } catch {
      // ignore
    }
  }

  async function doLogin(skipRateLimitCheck: boolean) {
    setLoading(true);
    try {
      if (!needsCaptcha) {
        await prepareFreshLoginSession();
      }

      const res = await getActiveProvider().loginStep1({
        username,
        password,
        captcha: needsCaptcha ? captcha : undefined,
        skipRateLimit: skipRateLimitCheck,
      });

      if (res.authenticated && res.credential) {
        setCredential(res.credential, username);
        await syncRememberedLoginPreference();
        toast.success(t("login.loginSuccess"));
        const landing = useSettingsStore.getState().defaultLandingPage;
        router.replace(landing === "schedule" ? "/dashboard/schedule/" : "/dashboard");
        return;
      }

      if (res.needsMfa) {
        toast.info(t("login.mfaRequired"));
        const store = useMFAModalStore.getState();
        try {
          const result = await store.showMFA({ username });
          if (result.type === "wechat") {
            await syncRememberedLoginPreference();
            toast.success(t("login.loginSuccess"));
            const landing = useSettingsStore.getState().defaultLandingPage;
            router.replace(landing === "schedule" ? "/dashboard/schedule/" : "/dashboard");
            return;
          }
          await getActiveProvider().submitMfaCode({
            challenge: {
              method: result.method,
              methodCode: result.methodCode,
              mobileHint: "",
              username,
            },
            code: result.code,
          });
          await syncRememberedLoginPreference();
          toast.success(t("login.loginSuccess"));
          const landing = useSettingsStore.getState().defaultLandingPage;
          router.replace(landing === "schedule" ? "/dashboard/schedule/" : "/dashboard");
        } catch (err) {
          if (err instanceof Error) {
            toast.error(err.message || t("login.errorMfaVerifyFailed"));
          }
          // 用户取消时 err 为 undefined，静默处理
        }
        return;
      }

      toast.error(t("login.errorLoginFailed"));
    } catch (err) {
      const e = err as Error & { code?: string; status?: number };
      if (e.code === "NEED_CAPTCHA" || e.status === 403) {
        toast.error(t("login.errorCaptchaRequired"));
        if (!needsCaptcha) {
          showCaptcha();
        }
      } else {
        toast.error(e.message || t("login.errorLoginFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) {
      toast.error(t("login.errorMissingCredentials"));
      return;
    }
    // 登录可能弹出 MFA 对话框；先移走焦点，避免 Chrome aria-hidden/focus 警告
    blurActiveElement();

    const limit = checkRateLimit();
    if (!limit.allowed) {
      toast.error(
        rateLimitMessage(
          limit,
          t,
          "login.errorRateLimitWindow",
          "login.errorRateLimitInterval",
        ),
        {
          action: {
            label: t("login.skipRateLimit"),
            onClick: () => doLogin(true),
          },
        },
      );
      setCountdown(Math.ceil(limit.retryAfterMs / 1000));
      return;
    }

    await doLogin(false);
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm animate-in fade-in zoom-in-95 duration-500">
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
                    className="rounded-md border cursor-pointer transition-opacity hover:opacity-80"
                    onClick={() =>
                      showCaptcha()
                    }
                  />
                  <Input
                    id="captcha"
                    value={captcha}
                    onChange={(e) => setCaptcha(e.target.value)}
                    placeholder={t("login.captchaPlaceholder")}
                  />
                </Field>
              )}
              <Field orientation="horizontal">
                <Checkbox
                  id="remember"
                  checked={remember}
                  onCheckedChange={(c) => setRemember(c === true)}
                />
                <FieldLabel htmlFor="remember" className="text-sm font-normal cursor-pointer">
                  {t("login.remember")}
                </FieldLabel>
              </Field>
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
  );
}
