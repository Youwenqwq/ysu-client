"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { useMFAModalStore } from "@/lib/mfa-modal-store";
import { useTranslation } from "@/lib/i18n/use-translation";
import { requestMFACode } from "@/lib/api";
import { toast } from "sonner";

const COUNTDOWN_SECONDS = 120;

export function MFAModal() {
  const { t } = useTranslation();
  const { open, username, mobileHint, cancelMFA, submitMFA } =
    useMFAModalStore();
  const [mfaMethod, setMfaMethod] = useState<"sms" | "cpdaily">("cpdaily");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [localHint, setLocalHint] = useState(mobileHint);
  const [countdown, setCountdown] = useState(0);
  const requestingRef = useRef(false);

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

  useEffect(() => {
    if (!open) return;
    setCode("");
    setMfaMethod("cpdaily");
    setLocalHint(mobileHint);
    setCountdown(mobileHint ? COUNTDOWN_SECONDS : 0);
  }, [open, mobileHint]);

  async function handleRequestCode() {
    if (!username || countdown > 0 || requestingRef.current) return;
    requestingRef.current = true;
    setLoading(true);
    try {
      const res = await requestMFACode(
        { username, method: mfaMethod },
        undefined,
      );
      setLocalHint(res.mobile_hint);
      setCountdown(COUNTDOWN_SECONDS);
    } catch (err) {
      toast.error((err as Error).message || t("login.errorMfaRequestFailed"));
    } finally {
      setLoading(false);
      requestingRef.current = false;
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!code) return;
    submitMFA(code);
    setCode("");
  }

  function handleCancel() {
    cancelMFA();
    setCode("");
  }

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
                onValueChange={(v) => v && setMfaMethod(v as "sms" | "cpdaily")}
                className="justify-start"
              >
                <ToggleGroupItem value="cpdaily">
                  {t("login.mfaMethodCpdaily")}
                </ToggleGroupItem>
                <ToggleGroupItem value="sms">
                  {t("login.mfaMethodSms")}
                </ToggleGroupItem>
              </ToggleGroup>
            </FieldSet>
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
            {localHint && (
              <FieldDescription>
                {t("login.mfaSent")} {localHint}
              </FieldDescription>
            )}
            <Field>
              <FieldLabel htmlFor="mfa-modal-code">
                {t("login.mfaCodeLabel")}
              </FieldLabel>
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
            <Button type="button" variant="ghost" onClick={handleCancel}>
              {t("login.back")}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
