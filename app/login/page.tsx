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
import { useTranslation } from "@/lib/i18n/use-translation";
import {
  loadRememberedCredentials,
  saveRememberedCredentials,
  clearRememberedCredentials,
} from "@/lib/secure-storage";
import {
  checkCaptchaNeeded,
  loginStep1,
  prepareLogin,
  requestMFACode,
  submitMFACode,
} from "@/lib/api";
import { useMFAModalStore } from "@/lib/mfa-modal-store";

export default function LoginPage() {
  const router = useRouter();
  const setCredential = useAuthStore((s) => s.setCredential);
  const { t } = useTranslation();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [captchaUrl, setCaptchaUrl] = useState<string | null>(null);
  const [needsCaptcha, setNeedsCaptcha] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadRememberedCredentials().then((r) => {
      if (r) {
        setUsername(r.username);
        setPassword(r.password);
        setRemember(true);
      }
    });
  }, []);

  function showCaptcha() {
    setNeedsCaptcha(true);
    setCaptchaUrl(
      `https://cer.ysu.edu.cn/authserver/getCaptcha.htl?${Date.now()}`,
    );
  }

  async function handleCheckCaptcha() {
    if (!username) return;
    try {
      await prepareLogin();
      if (await checkCaptchaNeeded(username)) showCaptcha();
    } catch {
      // ignore
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) {
      toast.error(t("login.errorMissingCredentials"));
      return;
    }
    setLoading(true);
    try {
      const res = await loginStep1({
        username,
        password,
        captcha: needsCaptcha ? captcha : undefined,
      });

      if (res.authenticated && res.credential) {
        setCredential(res.credential, username);
        if (remember) {
          saveRememberedCredentials(username, password);
        } else {
          clearRememberedCredentials();
        }
        toast.success(t("login.loginSuccess"));
        router.replace("/dashboard");
        return;
      }

      if (res.needs_mfa) {
        toast.info(t("login.mfaRequired"));
        const mfaRes = await requestMFACode(
          { username, method: "cpdaily" },
          res.credential ?? undefined,
        );
        const store = useMFAModalStore.getState();
        try {
          const code = await store.showMFA({
            username,
            methodCode: mfaRes.method_code,
            mobileHint: mfaRes.mobile_hint,
          });
          await submitMFACode(
            {
              method: "cpdaily",
              method_code: mfaRes.method_code,
              username,
              code,
            },
            res.credential ?? undefined,
          );
          if (remember) {
            saveRememberedCredentials(username, password);
          } else {
            clearRememberedCredentials();
          }
          toast.success(t("login.loginSuccess"));
          router.replace("/dashboard");
        } catch {
          // user cancelled MFA modal
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

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm animate-in fade-in zoom-in-95 duration-500">
        <CardHeader>
          <CardTitle>{t("login.title")}</CardTitle>
          <CardDescription>{t("login.usernamePlaceholder")}</CardDescription>
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
                        `https://cer.ysu.edu.cn/authserver/getCaptcha.htl?${Date.now()}`,
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
              <Button type="submit" disabled={loading}>
                {loading && <Spinner data-icon="inline-start" />}
                {loading ? t("login.loggingIn") : t("login.submit")}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
