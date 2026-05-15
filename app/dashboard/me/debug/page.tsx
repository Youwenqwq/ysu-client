"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuthStore } from "@/lib/auth-store";
import { useTranslation } from "@/lib/i18n/use-translation";
import { isCapacitor, isTauri, isWeb } from "@/lib/platform";
import { getJar as getCasJar, isAuthenticated as checkCASAuth } from "@/lib/cas";
import { getJar as getJwxtJar, ensureMobileAuthorized } from "@/lib/jwxt";
import { loadCASTGC, loadRememberedCredentials } from "@/lib/secure-storage";
import {
  getStudentInfo,
  getExperimentalSchedule,
  getCurrentWeek,
  getCurrentLesson,
} from "@/lib/api";
import { RefreshCw, Trash2, Bug } from "lucide-react";
import { toast } from "sonner";
import { clearAllCache } from "@/lib/cache";

interface DiagnosticResult {
  platform: {
    name: string;
    userAgent: string;
    screen: string;
    capacitorPlatform?: string;
  };
  authStore: {
    credentialExists: boolean;
    username: string | null;
    isAuthenticated: boolean;
    hasHydrated: boolean;
    jwxtSessionExists: boolean;
  };
  casJar: {
    cookieCount: number;
    cookies: { name: string; domain: string; path: string }[];
  };
  jwxtJar: {
    cookieCount: number;
    cookies: { name: string; domain: string; path: string }[];
  };
  secureStorage: {
    castgcExists: boolean;
    rememberMeExists: boolean;
  };
  apiTests: {
    casAuth: { ok: boolean | null; error?: string };
    studentInfo: { ok: boolean | null; error?: string };
    schedule: { ok: boolean | null; error?: string };
    currentWeek: { ok: boolean | null; error?: string };
    mobileAuth: { ok: boolean | null; error?: string };
  };
}

export default function DebugPage() {
  const { t } = useTranslation();
  const credential = useAuthStore((s) => s.credential);
  const username = useAuthStore((s) => s.username);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const jwxtSession = useAuthStore((s) => s.jwxtSession);

  const [diag, setDiag] = useState<DiagnosticResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function runDiagnostics() {
    setLoading(true);
    try {
      const platformName = isCapacitor() ? "Capacitor" : isTauri() ? "Tauri" : "Web";
      const screenInfo = typeof window !== "undefined"
        ? `${window.screen.width}x${window.screen.height} (${window.innerWidth}x${window.innerHeight})`
        : "N/A";
      let capacitorPlatform: string | undefined;
      if (isCapacitor()) {
        try {
          const { Capacitor } = await import("@capacitor/core");
          capacitorPlatform = Capacitor.getPlatform();
        } catch {
          // ignore
        }
      }

      const casJar = getCasJar();
      const casCookies = await casJar.getAllCookies();
      const jwxtJar = getJwxtJar();
      const jwxtCookies = await jwxtJar.getAllCookies();

      const castgc = await loadCASTGC();
      const rememberMe = await loadRememberedCredentials();

      const result: DiagnosticResult = {
        platform: {
          name: platformName,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "N/A",
          screen: screenInfo,
          capacitorPlatform,
        },
        authStore: {
          credentialExists: !!credential,
          username: username || null,
          isAuthenticated,
          hasHydrated,
          jwxtSessionExists: !!jwxtSession,
        },
        casJar: {
          cookieCount: casCookies.length,
          cookies: casCookies.map((c: { name: string; domain: string; path: string }) => ({
            name: c.name,
            domain: c.domain,
            path: c.path,
          })),
        },
        jwxtJar: {
          cookieCount: jwxtCookies.length,
          cookies: jwxtCookies.map((c: { name: string; domain: string; path: string }) => ({
            name: c.name,
            domain: c.domain,
            path: c.path,
          })),
        },
        secureStorage: {
          castgcExists: !!castgc,
          rememberMeExists: !!rememberMe,
        },
        apiTests: {
          casAuth: { ok: null },
          studentInfo: { ok: null },
          schedule: { ok: null },
          currentWeek: { ok: null },
          mobileAuth: { ok: null },
        },
      };

      // API tests (sequential to avoid overwhelming the server)
      if (credential) {
        try {
          result.apiTests.casAuth = { ok: await checkCASAuth() };
        } catch (e) {
          result.apiTests.casAuth = { ok: false, error: (e as Error).message };
        }

        try {
          await getStudentInfo(credential);
          result.apiTests.studentInfo = { ok: true };
        } catch (e) {
          result.apiTests.studentInfo = { ok: false, error: (e as Error).message };
        }

        try {
          await getExperimentalSchedule(credential);
          result.apiTests.schedule = { ok: true };
        } catch (e) {
          result.apiTests.schedule = { ok: false, error: (e as Error).message };
        }

        try {
          await getCurrentWeek(credential);
          result.apiTests.currentWeek = { ok: true };
        } catch (e) {
          result.apiTests.currentWeek = { ok: false, error: (e as Error).message };
        }

        // Mobile auth test: run the full mobile authorization flow
        try {
          await ensureMobileAuthorized();
          result.apiTests.mobileAuth = { ok: true };
        } catch (e) {
          result.apiTests.mobileAuth = { ok: false, error: (e as Error).message };
        }
      }

      setDiag(result);
    } catch (err) {
      toast.error((err as Error).message || t("debug.diagnosticsFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    runDiagnostics();
  }, []);

  function handleClearCache() {
    clearAllCache();
    toast.success(t("debug.cacheCleared"));
    runDiagnostics();
  }

  function statusBadge(value: boolean | null | { ok: boolean | null; error?: string }) {
    if (typeof value === "boolean") {
      if (value === true) return <Badge variant="default" className="text-[10px]">OK</Badge>;
      if (value === false) return <Badge variant="destructive" className="text-[10px]">FAIL</Badge>;
    }
    if (typeof value === "object" && value !== null) {
      if (value.ok === true) return <Badge variant="default" className="text-[10px]">OK</Badge>;
      if (value.ok === false) return <Badge variant="destructive" className="text-[10px]">FAIL</Badge>;
    }
    return <Badge variant="secondary" className="text-[10px]">N/A</Badge>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Bug className="size-5" />
          Debug
        </h1>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={runDiagnostics} disabled={loading}>
          {loading ? <Spinner className="size-3.5" /> : <RefreshCw className="size-3.5" />}
          {t("debug.refresh")}
        </Button>
      </div>

      {!diag && loading && (
        <div className="flex items-center justify-center py-12">
          <Spinner className="size-8" />
        </div>
      )}

      {diag && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("debug.platform")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.platformType")}</span>
                <span className="font-mono text-xs">{diag.platform.name}</span>
              </div>
              {diag.platform.capacitorPlatform && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("debug.platformCapacitor")}</span>
                  <span className="font-mono text-xs">{diag.platform.capacitorPlatform}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.platformScreen")}</span>
                <span className="font-mono text-xs">{diag.platform.screen}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground">{t("debug.platformUserAgent")}</span>
                <span className="break-all text-[10px] font-mono text-muted-foreground">{diag.platform.userAgent}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("debug.authState")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.credential")}</span>
                {statusBadge(diag.authStore.credentialExists)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.username")}</span>
                <span className="font-mono text-xs">{diag.authStore.username || "-"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.authenticated")}</span>
                {statusBadge(diag.authStore.isAuthenticated)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.hydrated")}</span>
                {statusBadge(diag.authStore.hasHydrated)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.jwxtSession")}</span>
                {statusBadge(diag.authStore.jwxtSessionExists)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("debug.secureStorage")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.castgc")}</span>
                {statusBadge(diag.secureStorage.castgcExists)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.rememberMe")}</span>
                {statusBadge(diag.secureStorage.rememberMeExists)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("debug.apiTests")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              {[
                { label: t("debug.casAuth"), test: diag.apiTests.casAuth },
                { label: t("debug.studentInfo"), test: diag.apiTests.studentInfo },
                { label: t("debug.schedule"), test: diag.apiTests.schedule },
                { label: t("debug.currentWeek"), test: diag.apiTests.currentWeek },
                { label: t("debug.mobileAuth"), test: diag.apiTests.mobileAuth },
              ].map((item) => (
                <div key={item.label} className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{item.label}</span>
                    {statusBadge(item.test)}
                  </div>
                  {item.test.error && (
                    <span className="text-xs text-destructive break-all font-mono">
                      {item.test.error}
                    </span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("debug.casJar")} ({diag.casJar.cookieCount})</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-32 rounded-md border bg-muted/30 p-2">
                {diag.casJar.cookies.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t("debug.empty")}</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {diag.casJar.cookies.map((c, i) => (
                      <li key={i} className="text-xs font-mono">
                        {c.name} @ {c.domain}{c.path}
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("debug.jwxtJar")} ({diag.jwxtJar.cookieCount})</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-32 rounded-md border bg-muted/30 p-2">
                {diag.jwxtJar.cookies.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t("debug.empty")}</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {diag.jwxtJar.cookies.map((c, i) => (
                      <li key={i} className="text-xs font-mono">
                        {c.name} @ {c.domain}{c.path}
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          <Button variant="destructive" onClick={handleClearCache} className="w-full">
            <Trash2 className="size-4 mr-2" />
            {t("debug.clearCache")}
          </Button>
        </>
      )}
    </div>
  );
}
