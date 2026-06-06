"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
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
import { initiateWechatMFA, pollWechatQR, completeWechatMFA } from "@/lib/cas";
import { useAuthStore } from "@/lib/auth-store";
import { isTablet } from "@/lib/platform";
import { toast } from "sonner";

const COUNTDOWN_SECONDS = 120;

type WechatStatus = 'idle' | 'initiating' | 'waiting' | 'scanned' | 'confirmed' | 'error';

export function MFAModal() {
  const { t } = useTranslation();
  const { open, username, cancelMFA, submitMFA, completeWechatMFA: storeComplete } =
    useMFAModalStore();
  const showWechat = isTablet();
  const defaultMethod = showWechat ? "weixin" : "sms";
  const [mfaMethod, setMfaMethod] = useState<"sms" | "cpdaily" | "weixin">(defaultMethod);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [localHint, setLocalHint] = useState("");
  const [localMethodCode, setLocalMethodCode] = useState("");
  const [countdown, setCountdown] = useState(0);
  const requestingRef = useRef(false);

  // WeChat state
  const [wechatStatus, setWechatStatus] = useState<WechatStatus>('idle');
  const [wechatError, setWechatError] = useState('');
  const [qrImageUrl, setQrImageUrl] = useState('');
  const wechatCtxRef = useRef<{ uuid: string; state: string } | null>(null);
  const pollingRef = useRef(false);

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
    setMfaMethod(showWechat ? "weixin" : "sms");
    setLocalHint("");
    setLocalMethodCode("");
    setCountdown(0);
    setWechatStatus('idle');
    setWechatError('');
    wechatCtxRef.current = null;
    pollingRef.current = false;
  }, [open, showWechat]);

  // Stop polling when modal closes or method changes away from weixin.
  useEffect(() => {
    if (!open || mfaMethod !== 'weixin') {
      pollingRef.current = false;
    }
  }, [open, mfaMethod]);

  async function handleRequestCode() {
    if (!username || countdown > 0 || requestingRef.current) return;
    requestingRef.current = true;
    setLoading(true);
    try {
      const method = mfaMethod as "sms" | "cpdaily";
      const res = await requestMFACode(
        { username, method },
        undefined,
      );
      setLocalHint(res.mobile_hint);
      setLocalMethodCode(res.method_code);
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
    if (!code || !localMethodCode || isWechat) return;
    submitMFA({
      method: mfaMethod as "sms" | "cpdaily",
      methodCode: localMethodCode,
      code,
    });
    setCode("");
  }

  function handleCancel() {
    pollingRef.current = false;
    cancelMFA();
    setCode("");
  }

  // ── WeChat flow ────────────────────────────────────────────────────

  async function handleWechatOpen() {
    if (!username) return;
    setWechatStatus('initiating');
    setWechatError('');

    try {
      const ctx = await initiateWechatMFA();
      wechatCtxRef.current = { uuid: ctx.uuid, state: ctx.state };

      // CAS's WeChat app only supports qrconnect (PC QR-scan login).
      // Show the QR code image — user scans with another device.
      setQrImageUrl(ctx.qrImageUrl);

      // Start polling.
      pollingRef.current = true;
      let lastErrcode: number | undefined;

      while (pollingRef.current) {
        let result: { status: 'waiting' | 'scanned' | 'confirmed'; code?: string };
        try {
          result = await pollWechatQR(ctx.uuid, lastErrcode);
        } catch {
          // Poll request itself failed (network, timeout) — retry.
          continue;
        }

        if (result.status === 'confirmed' && result.code) {
          setWechatStatus('confirmed');
          pollingRef.current = false;

          try {
            const credential = await completeWechatMFA(result.code, ctx.state);
            const json = credential.toJSON();
            useAuthStore.getState().setCredential(json, username);
            storeComplete();
          } catch (err) {
            setWechatStatus('error');
            setWechatError((err as Error).message || t("login.errorMfaWechatFailed"));
          }
          return;
        }

        if (result.status === 'scanned') {
          setWechatStatus('scanned');
          lastErrcode = 404;
        } else {
          setWechatStatus('waiting');
        }
      }
    } catch (err) {
      setWechatStatus('error');
      setWechatError((err as Error).message || t("login.errorMfaWechatFailed"));
    }
  }

  function handleWechatRetry() {
    setWechatStatus('idle');
    setWechatError('');
    wechatCtxRef.current = null;
  }

  function handleMethodChange(v: string) {
    if (!v) return;
    pollingRef.current = false;
    setMfaMethod(v as "sms" | "cpdaily" | "weixin");
    setLocalMethodCode('');
    setLocalHint('');
    setCountdown(0);
    setWechatStatus('idle');
    setWechatError('');
  }

  const isWechat = mfaMethod === 'weixin';

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
                  <ToggleGroupItem value="weixin">
                    {t("login.mfaMethodWechat")}
                  </ToggleGroupItem>
                )}
                <ToggleGroupItem value="cpdaily">
                  {t("login.mfaMethodCpdaily")}
                </ToggleGroupItem>
                <ToggleGroupItem value="sms">
                  {t("login.mfaMethodSms")}
                </ToggleGroupItem>
              </ToggleGroup>
            </FieldSet>

            {isWechat ? (
              <FieldGroup>
                {wechatStatus === 'idle' && (
                  <Button type="button" onClick={handleWechatOpen}>
                    {t("login.mfaWechatOpen")}
                  </Button>
                )}
                {wechatStatus === 'initiating' && (
                  <Button type="button" disabled>
                    <Spinner data-icon="inline-start" />
                    {t("login.mfaWechatOpening")}
                  </Button>
                )}
                {(wechatStatus === 'waiting' || wechatStatus === 'scanned') && (
                  <FieldGroup>
                    {qrImageUrl && (
                      <div className="flex justify-center">
                        <Image src={qrImageUrl} alt="WeChat QR" width={160} height={160} className="size-40" unoptimized />
                      </div>
                    )}
                    <FieldDescription>
                      {wechatStatus === 'scanned'
                        ? t("login.mfaWechatScanned")
                        : t("login.mfaWechatWaiting")}
                    </FieldDescription>
                  </FieldGroup>
                )}
                {wechatStatus === 'confirmed' && (
                  <FieldDescription>{t("login.mfaWechatConfirmed")}</FieldDescription>
                )}
                {wechatStatus === 'error' && (
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
                    {t("login.mfaSent")}{" "}
                    {localHint || t("login.mfaSentCpdailyApp")}
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
              </>
            )}

            <Button type="button" variant="ghost" onClick={handleCancel}>
              {t("login.back")}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
