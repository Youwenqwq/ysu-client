"use client";

import { useState, useEffect, useRef } from "react";
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
  FieldSet,
  FieldLegend,
  FieldDescription,
} from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
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

type Step = "credentials" | "mfa";

export default function LoginPage() {
  const router = useRouter();
  const setCredential = useAuthStore((s) => s.setCredential);
  const { t } = useTranslation();

  const [step, setStep] = useState<Step>("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [captchaUrl, setCaptchaUrl] = useState<string | null>(null);
  const [needsCaptcha, setNeedsCaptcha] = useState(false);
  const [tempCredential, setTempCredential] = useState<string | null>(null);
  const [mfaMethod, setMfaMethod] = useState<"sms" | "cpdaily">("cpdaily");
  const [mfaCode, setMfaCode] = useState("");
  const [mobileHint, setMobileHint] = useState("");
  const [methodCode, setMethodCode] = useState("");
  const [loading, setLoading] = useState(false);
  const requestingMfaCodeRef = useRef(false);

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

  async function handleSubmitCredentials(e: React.FormEvent) {
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

      if (res.needs_mfa && res.credential) {
        setTempCredential(res.credential);
        setStep("mfa");
        toast.info(t("login.mfaRequired"));
        return;
      }

      toast.error(t("login.errorLoginFailed"));
    } catch (err) {
      const e = err as Error & { code?: string; status?: number };
      if (e.code === "NEED_CAPTCHA" || e.status === 403) {
        toast.error(t("login.errorCaptchaRequired"));
        if (!needsCaptcha) {
          // First time: show captcha UI. Don't refresh if already visible.
          showCaptcha();
        }
      } else if (e.code === "MFA_REQUIRED") {
        toast.info(t("login.mfaRequired"));
        setStep("mfa");
      } else {
        toast.error(e.message || t("login.errorLoginFailed"));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestMFACode() {
    if (!tempCredential || requestingMfaCodeRef.current) return;
    requestingMfaCodeRef.current = true;
    setLoading(true);
    try {
      const res = await requestMFACode(
        { username, method: mfaMethod },
        tempCredential,
      );
      setMobileHint(res.mobile_hint);
      setMethodCode(res.method_code);
    } catch (err) {
      toast.error((err as Error).message || t("login.errorMfaRequestFailed"));
    } finally {
      setLoading(false);
      requestingMfaCodeRef.current = false;
    }
  }

  async function handleSubmitMFA(e: React.FormEvent) {
    e.preventDefault();
    if (!tempCredential || !mfaCode) {
      toast.error(t("login.errorMfaCodeRequired"));
      return;
    }
    setLoading(true);
    try {
      const res = await submitMFACode(
        {
          username,
          method: mfaMethod,
          method_code: methodCode,
          code: mfaCode,
        },
        tempCredential,
      );
      setCredential(res.credential, username);
      if (remember) {
        saveRememberedCredentials(username, password);
      } else {
        clearRememberedCredentials();
      }
      toast.success(t("login.loginSuccess"));
      router.replace("/dashboard");
    } catch (err) {
      toast.error((err as Error).message || t("login.errorMfaVerifyFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm animate-in fade-in zoom-in-95 duration-500">
        <CardHeader>
          <CardTitle>{t("login.title")}</CardTitle>
          <CardDescription>
            {step === "credentials"
              ? t("login.usernamePlaceholder")
              : t("login.mfaTitle")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "credentials" ? (
            <form onSubmit={handleSubmitCredentials}>
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
          ) : (
            <form onSubmit={handleSubmitMFA}>
              <FieldGroup>
                <FieldSet>
                  <FieldLegend variant="label">{t("login.mfaMethod")}</FieldLegend>
                  <ToggleGroup
                    type="single"
                    value={mfaMethod}
                    onValueChange={(v) =>
                      v && setMfaMethod(v as "sms" | "cpdaily")
                    }
                    className="justify-start"
                  >
                    <ToggleGroupItem value="cpdaily">{t("login.mfaMethodCpdaily")}</ToggleGroupItem>
                    <ToggleGroupItem value="sms">{t("login.mfaMethodSms")}</ToggleGroupItem>
                  </ToggleGroup>
                </FieldSet>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRequestMFACode}
                  disabled={loading}
                >
                  {loading && <Spinner data-icon="inline-start" />}
                  {loading ? t("login.mfaRequesting") : t("login.mfaRequest")}
                </Button>
                {mobileHint && (
                  <FieldDescription>
                    {t("login.mfaSent")} {mobileHint}
                  </FieldDescription>
                )}
                <Field>
                  <FieldLabel htmlFor="mfaCode">{t("login.mfaCodeLabel")}</FieldLabel>
                  <Input
                    id="mfaCode"
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    placeholder={t("login.mfaCodePlaceholder")}
                  />
                </Field>
                <Button type="submit" disabled={loading}>
                  {loading && <Spinner data-icon="inline-start" />}
                  {loading ? t("login.mfaVerifying") : t("login.mfaVerify")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep("credentials")}
                >
                  {t("login.back")}
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
