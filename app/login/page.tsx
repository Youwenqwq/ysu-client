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
import { useAuthStore } from "@/lib/auth-store";
import { useSettingsStore } from "@/lib/settings-store";
import { useTranslation } from "@/lib/i18n/use-translation";
import { casUrls, getAvailableSchools, setSchoolConfig, getSchoolId } from "@/lib/server-config";
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
} from "@/lib/secure-storage";
import {
  checkCaptchaNeeded,
  loginStep1,
  prepareLogin,
  submitMFACode,
} from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { useMFAModalStore } from "@/lib/mfa-modal-store";
import { resetCAS } from "@/lib/cas";

export default function LoginPage() {
  const router = useRouter();
  const setCredential = useAuthStore((s) => s.setCredential);
  const setSchoolId = useSettingsStore((s) => s.setSchoolId);
  const { t } = useTranslation();

  const schools = getAvailableSchools();
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
  }

  function showCaptcha() {
    setNeedsCaptcha(true);
    setCaptchaUrl(
      `${casUrls.captcha}?${Date.now()}`,
    );
  }

  async function syncRememberedLoginPreference() {
    if (remember) {
      await saveRememberedCredentials(username, password);
    } else {
      await clearRememberedCredentials();
    }
  }

  async function prepareFreshLoginSession() {
    resetCAS();
    await prepareLogin();
  }

  async function handleCheckCaptcha() {
    if (!username) return;
    try {
      await prepareFreshLoginSession();
      const captchaNeeded = await checkCaptchaNeeded(username);
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

      const res = await loginStep1({
        username,
        password,
        captcha: needsCaptcha ? captcha : undefined,
        skip_rate_limit: skipRateLimitCheck,
      });

      if (res.authenticated && res.credential) {
        setCredential(res.credential, username);
        await syncRememberedLoginPreference();
        toast.success(t("login.loginSuccess"));
        const landing = useSettingsStore.getState().defaultLandingPage;
        router.replace(landing === "schedule" ? "/dashboard/schedule/" : "/dashboard");
        return;
      }

      if (res.needs_mfa) {
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
          await submitMFACode(
            {
              method: result.method,
              method_code: result.methodCode,
              username,
              code: result.code,
            },
            res.credential ?? undefined,
          );
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

    const limit = checkRateLimit();
    if (!limit.allowed) {
      const totalSeconds = Math.ceil(limit.retryAfterMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      const message =
        limit.reason === "window"
          ? t("login.errorRateLimitWindow")
              .replace("{minutes}", String(minutes))
              .replace("{seconds}", seconds.toString().padStart(2, "0"))
          : t("login.errorRateLimitInterval").replace("{seconds}", String(seconds));

      toast.error(message, {
        action: {
          label: t("login.skipRateLimit"),
          onClick: () => doLogin(true),
        },
      });
      setCountdown(totalSeconds);
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
                      setCaptchaUrl(
                        `${casUrls.captcha}?${Date.now()}`,
                      )
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
                    ? t("login.retryAfter").replace("{seconds}", String(countdown))
                    : t("login.submit")}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
