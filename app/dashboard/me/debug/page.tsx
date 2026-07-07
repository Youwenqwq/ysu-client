"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthStore } from "@/lib/stores/auth";
import { useTranslation } from "@/lib/i18n/use-translation";
import { isCapacitor } from "@/lib/native/platform";
import { getSchoolConfig, getSchoolId, serverConfig } from "@/lib/server-config";
import { loadRememberedCredentials } from "@/lib/storage/secure";
import { useProvider } from "@/providers/use-provider";
import { useSettingsStore } from "@/lib/stores/settings";
import {
  getCustomUserAgent,
  normalizeCustomUserAgent,
  USER_AGENT_PRESETS,
} from "@/lib/custom-user-agent";
import { startNativePolling, stopNativePolling } from "@/lib/native/notify";
import { NotifyPlugin } from "@/lib/native/notify-plugin";
import { RefreshCw, Trash2, Bug, Bell, Play, Send, Smartphone, Shield, Power, Save, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { clearAllCache } from "@/lib/storage/cache";

interface DiagnosticResult {
  school: {
    id: string;
    name: string;
    nameEn: string;
    cerBaseUrl: string;
    jwxtBaseUrl: string;
    hasMobile: boolean;
    hasLabSchedule: boolean;
    hasMfa: boolean;
  };
  platform: {
    name: string;
    userAgent: string;
    requestUserAgent: string;
    screen: string;
    viewport: string;
    capacitorPlatform?: string;
  };
  authStore: {
    credentialExists: boolean;
    username: string | null;
    isAuthenticated: boolean;
    hasHydrated: boolean;
    academicSessionExists: boolean;
  };
  authCookies: {
    cookieCount: number;
    cookies: { name: string; domain: string; path: string }[];
  };
  academicCookies: {
    cookieCount: number;
    cookies: { name: string; domain: string; path: string }[];
  };
  secureStorage: {
    authTokenExists: boolean;
    rememberMeExists: boolean;
  };
  apiTests: {
    authSession: { ok: boolean | null; error?: string };
    studentInfo: { ok: boolean | null; error?: string };
    schedule: { ok: boolean | null; error?: string };
    currentWeek: { ok: boolean | null; error?: string };
    mobileAuth: { ok: boolean | null; error?: string };
  };
}

export default function DebugPage() {
  const { t } = useTranslation();
  const provider = useProvider();
  const credential = useAuthStore((s) => s.credential);
  const username = useAuthStore((s) => s.username);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const jwxtSession = useAuthStore((s) => s.jwxtSession);

  const [diag, setDiag] = useState<DiagnosticResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [nativeTestLog, setNativeTestLog] = useState<string[]>([]);
  const [nativePermGranted, setNativePermGranted] = useState<boolean | null>(null);
  const [cachedGradeCount, setCachedGradeCount] = useState<number | null>(null);
  const [cachedExamCount, setCachedExamCount] = useState<number | null>(null);

  const customUserAgent = useSettingsStore((s) => s.customUserAgent);
  const setCustomUserAgent = useSettingsStore((s) => s.setCustomUserAgent);
  const notifyEnabled = useSettingsStore((s) => s.notifyEnabled);
  const notifyCheckInterval = useSettingsStore((s) => s.notifyCheckInterval);
  const notifyGrades = useSettingsStore((s) => s.notifyGrades);
  const notifyExams = useSettingsStore((s) => s.notifyExams);
  const diagnosticLabels = provider.diagnostics?.labels ?? {
    authSystem: t("debug.authSystem"),
    academicSystem: t("debug.academicSystem"),
    authToken: t("debug.authToken"),
    authCookies: t("debug.authCookies"),
    academicCookies: t("debug.academicCookies"),
    authSession: t("debug.authSession"),
    academicSession: t("debug.academicSession"),
    mobileAuth: t("debug.mobileAuth"),
  };
  const [uaDraft, setUaDraft] = useState(customUserAgent);

  useEffect(() => {
    setUaDraft(customUserAgent);
  }, [customUserAgent]);

  function logNative(msg: string) {
    setNativeTestLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }

  useEffect(() => {
    if (!isCapacitor()) return;
    NotifyPlugin.getCachedGrades().then(({ gradesJson }) => {
      const parsed = gradesJson ? JSON.parse(gradesJson) : [];
      setCachedGradeCount(parsed.length);
    }).catch(() => {});
    NotifyPlugin.getCachedExams().then(({ examsJson }) => {
      const parsed = examsJson ? JSON.parse(examsJson) : [];
      setCachedExamCount(parsed.length);
    }).catch(() => {});
  }, []);

  async function runDiagnostics() {
    setLoading(true);
    try {
      const platformName = isCapacitor() ? "Capacitor" : "Web (dev)";
      const screenInfo = typeof window !== "undefined"
        ? `${Math.round(window.screen.width * window.devicePixelRatio)}x${Math.round(window.screen.height * window.devicePixelRatio)}`
        : "N/A";
      const viewportInfo = typeof window !== "undefined"
        ? `${window.screen.width}x${window.screen.height} (screen) / ${window.innerWidth}x${window.innerHeight} (viewport)`
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

      const diagnostics = provider.diagnostics;
      const authCookies = diagnostics ? await diagnostics.getAuthCookies() : [];
      const academicCookies = diagnostics ? await diagnostics.getAcademicCookies() : [];

      const authToken = await provider.nativeNotification?.getAuthToken();
      const rememberMe = await loadRememberedCredentials();

      const schoolConfig = getSchoolConfig();
      const result: DiagnosticResult = {
        school: {
          id: getSchoolId(),
          name: schoolConfig.name,
          nameEn: schoolConfig.nameEn,
          cerBaseUrl: serverConfig.cerBaseUrl,
          jwxtBaseUrl: serverConfig.jwxtBaseUrl,
          hasMobile: schoolConfig.features.hasMobile,
          hasLabSchedule: schoolConfig.features.hasLabSchedule,
          hasMfa: schoolConfig.features.hasMfa,
        },
        platform: {
          name: platformName,
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "N/A",
          requestUserAgent: getCustomUserAgent(),
          screen: screenInfo,
          viewport: viewportInfo,
          capacitorPlatform,
        },
        authStore: {
          credentialExists: !!credential,
          username: username || null,
          isAuthenticated,
          hasHydrated,
          academicSessionExists: !!jwxtSession,
        },
        authCookies: {
          cookieCount: authCookies.length,
          cookies: authCookies.map((c: { name: string; domain: string; path: string }) => ({
            name: c.name,
            domain: c.domain,
            path: c.path,
          })),
        },
        academicCookies: {
          cookieCount: academicCookies.length,
          cookies: academicCookies.map((c: { name: string; domain: string; path: string }) => ({
            name: c.name,
            domain: c.domain,
            path: c.path,
          })),
        },
        secureStorage: {
          authTokenExists: !!authToken,
          rememberMeExists: !!rememberMe,
        },
        apiTests: {
          authSession: { ok: null },
          studentInfo: { ok: null },
          schedule: { ok: null },
          currentWeek: { ok: null },
          mobileAuth: { ok: null },
        },
      };

      // API tests (sequential to avoid overwhelming the server)
      if (credential) {
        try {
          result.apiTests.authSession = diagnostics
            ? { ok: await diagnostics.checkAuth() }
            : { ok: null, error: "Provider diagnostics unavailable" };
        } catch (e) {
          result.apiTests.authSession = { ok: false, error: (e as Error).message };
        }

        try {
          await provider.getStudentInfo();
          result.apiTests.studentInfo = { ok: true };
        } catch (e) {
          result.apiTests.studentInfo = { ok: false, error: (e as Error).message };
        }

        try {
          await provider.getSchedule({ courseCategory: "all", includeLabSchedule: true });
          result.apiTests.schedule = { ok: true };
        } catch (e) {
          result.apiTests.schedule = { ok: false, error: (e as Error).message };
        }

        try {
          await provider.getCurrentWeek();
          result.apiTests.currentWeek = { ok: true };
        } catch (e) {
          result.apiTests.currentWeek = { ok: false, error: (e as Error).message };
        }

        // Mobile auth test: run the full mobile authorization flow
        try {
          if (diagnostics?.ensureMobileAuthorized) {
            await diagnostics.ensureMobileAuthorized();
            result.apiTests.mobileAuth = { ok: true };
          } else {
            result.apiTests.mobileAuth = { ok: null, error: "Provider mobile diagnostics unavailable" };
          }
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

  const runDiagnosticsRef = useRef(runDiagnostics);
  useEffect(() => {
    runDiagnosticsRef.current = runDiagnostics;
  });

  useEffect(() => {
    runDiagnosticsRef.current();
  }, []);

  function handleClearCache() {
    clearAllCache();
    toast.success(t("debug.cacheCleared"));
    runDiagnostics();
  }

  function handleClearAcademicSession() {
    provider.diagnostics?.resetAcademicSession();
    toast.success(t("debug.academicSessionCleared"));
    runDiagnostics();
  }

  // ─── Native Plugin Debug ─────────────────────────────────────────────── //

  async function handleNativeCheckPermission() {
    if (!isCapacitor()) {
      logNative("非 Capacitor 平台，跳过");
      return;
    }
    try {
      const result = await NotifyPlugin.checkPermissions();
      setNativePermGranted(result.granted);
      logNative(`checkPermissions: granted=${result.granted}`);
    } catch (e) {
      logNative(`checkPermissions 失败: ${(e as Error).message}`);
    }
  }

  async function handleNativeRequestPermission() {
    if (!isCapacitor()) {
      logNative("非 Capacitor 平台，跳过");
      return;
    }
    try {
      const result = await NotifyPlugin.requestPermissions();
      setNativePermGranted(result.granted);
      logNative(`requestPermissions: granted=${result.granted}`);
    } catch (e) {
      logNative(`requestPermissions 失败: ${(e as Error).message}`);
    }
  }

  async function handleNativeSetAuthToken() {
    if (!isCapacitor()) {
      logNative("非 Capacitor 平台，跳过");
      return;
    }
    try {
      // 诊断：从当前 provider 读取认证 token
      const providerToken = await provider.nativeNotification?.getAuthToken();
      logNative(`provider auth token (${diagnosticLabels.authToken}): ${providerToken ? "存在" : "无"}`);

      // 诊断：从 CapacitorCookies 读取
      const { CapacitorCookies } = await import("@capacitor/core");
      const authCookieUrl = provider.diagnostics?.getAuthCookieUrl?.();
      const cookies = authCookieUrl
        ? await CapacitorCookies.getCookies({ url: authCookieUrl })
        : {};
      logNative(`CapacitorCookies: ${JSON.stringify(cookies)}`);

      // 诊断：从 JS cookie jar 读取
      const authCookies = provider.diagnostics
        ? await provider.diagnostics.getAuthCookies()
        : [];
      const cookieToken = authCookies.find((c) => c.value)?.value;
      logNative(`JS auth cookie token: ${cookieToken ? `存在(len=${cookieToken.length})` : "无"}`);

      // 诊断：直接同步认证 token 到原生通知插件
      const authToken = providerToken ?? cookieToken;
      if (authToken) {
        logNative(`直接同步认证 token, len=${authToken.length}`);
        await NotifyPlugin.setCastgc({ castgc: authToken });
        logNative("认证 token 同步完成");
      } else {
        logNative("跳过认证 token 同步: token 为空");
      }
    } catch (e) {
      logNative(`sync auth token failed: ${(e as Error).message}`);
    }
  }

  async function handleNativeStartPolling() {
    if (!isCapacitor()) {
      logNative("非 Capacitor 平台，跳过");
      return;
    }
    try {
      await startNativePolling(provider.nativeNotification, provider.id);
      logNative(`startNativePolling: 已启动 (interval=${notifyCheckInterval}min, grades=${notifyGrades}, exams=${notifyExams})`);
    } catch (e) {
      logNative(`startNativePolling 失败: ${(e as Error).message}`);
    }
  }

  async function handleNativeStopPolling() {
    if (!isCapacitor()) {
      logNative("非 Capacitor 平台，跳过");
      return;
    }
    try {
      await stopNativePolling();
      logNative("stopNativePolling: 已停止");
    } catch (e) {
      logNative(`stopNativePolling 失败: ${(e as Error).message}`);
    }
  }

  async function handleNativeRunWorker() {
    if (!isCapacitor()) {
      logNative("非 Capacitor 平台，跳过");
      return;
    }
    try {
      logNative("正在直接触发 Worker...");
      await NotifyPlugin.executeOnce();
      logNative("Worker 已触发，稍后查看通知栏");
    } catch (e) {
      logNative(`触发 Worker 失败: ${(e as Error).message}`);
    }
  }

  function handleNativeClearLog() {
    setNativeTestLog([]);
  }

  function handlePresetUserAgent(value: string) {
    setUaDraft(value);
  }

  function handleSaveUserAgent() {
    setCustomUserAgent(normalizeCustomUserAgent(uaDraft));
    toast.success(t("debug.userAgentSaved"));
    runDiagnostics();
  }

  function handleResetUserAgent() {
    setCustomUserAgent("");
    setUaDraft("");
    toast.success(t("debug.userAgentReset"));
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
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.platformViewport")}</span>
                <span className="font-mono text-xs">{diag.platform.viewport}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-muted-foreground">{t("debug.platformUserAgent")}</span>
                <span className="break-all text-[10px] font-mono text-muted-foreground">{diag.platform.userAgent}</span>
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("debug.requestUserAgent")}</span>
                  {customUserAgent ? (
                    <Badge variant="secondary" className="text-[10px]">{t("debug.customUserAgent")}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">{t("debug.defaultUserAgent")}</Badge>
                  )}
                </div>
                <span className="break-all text-[10px] font-mono text-muted-foreground">
                  {diag.platform.requestUserAgent}
                </span>
                <Select onValueChange={handlePresetUserAgent}>
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue placeholder={t("debug.selectUserAgentPreset")} />
                  </SelectTrigger>
                  <SelectContent>
                    {USER_AGENT_PRESETS.map((preset) => (
                      <SelectItem key={preset.id} value={preset.value}>
                        {preset.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Textarea
                  value={uaDraft}
                  onChange={(event) => setUaDraft(event.target.value)}
                  placeholder={t("debug.emptyUserAgentPlaceholder")}
                  className="min-h-20 text-[11px] font-mono"
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" onClick={handleResetUserAgent}>
                    <RotateCcw className="size-3.5 mr-1" />
                    {t("debug.resetUserAgent")}
                  </Button>
                  <Button size="sm" onClick={handleSaveUserAgent}>
                    <Save className="size-3.5 mr-1" />
                    {t("debug.saveUserAgent")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("debug.schoolInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.schoolId")}</span>
                <span className="font-mono text-xs">{diag.school.id}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.schoolName")}</span>
                <span className="font-mono text-xs">{diag.school.name} ({diag.school.nameEn})</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{diagnosticLabels.authSystem} URL</span>
                <span className="font-mono text-xs break-all">{diag.school.cerBaseUrl}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{diagnosticLabels.academicSystem} URL</span>
                <span className="font-mono text-xs break-all">{diag.school.jwxtBaseUrl}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.schoolHasMobile")}</span>
                {statusBadge(diag.school.hasMobile)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.schoolHasLabSchedule")}</span>
                {statusBadge(diag.school.hasLabSchedule)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("debug.schoolHasMfa")}</span>
                {statusBadge(diag.school.hasMfa)}
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
                <span className="text-muted-foreground">{diagnosticLabels.academicSession}</span>
                {statusBadge(diag.authStore.academicSessionExists)}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("debug.secureStorage")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{diagnosticLabels.authToken}</span>
                {statusBadge(diag.secureStorage.authTokenExists)}
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
                { label: diagnosticLabels.authSession, test: diag.apiTests.authSession },
                { label: t("debug.studentInfo"), test: diag.apiTests.studentInfo },
                { label: t("debug.schedule"), test: diag.apiTests.schedule },
                { label: t("debug.currentWeek"), test: diag.apiTests.currentWeek },
                { label: diagnosticLabels.mobileAuth, test: diag.apiTests.mobileAuth },
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
              <CardTitle className="text-sm">{diagnosticLabels.authCookies} ({diag.authCookies.cookieCount})</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-32 rounded-md border bg-muted/30 p-2">
                {diag.authCookies.cookies.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t("debug.empty")}</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {diag.authCookies.cookies.map((c, i) => (
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
              <CardTitle className="text-sm">{diagnosticLabels.academicCookies} ({diag.academicCookies.cookieCount})</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-32 rounded-md border bg-muted/30 p-2">
                {diag.academicCookies.cookies.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t("debug.empty")}</span>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {diag.academicCookies.cookies.map((c, i) => (
                      <li key={i} className="text-xs font-mono">
                        {c.name} @ {c.domain}{c.path}
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* ── Notification Debug ─────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bell className="size-4" />
                通知模块状态
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">notifyEnabled</span>
                {statusBadge(notifyEnabled)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">notifyCheckInterval</span>
                <span className="font-mono text-xs">{notifyCheckInterval} 分钟</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">notifyGrades</span>
                {statusBadge(notifyGrades)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">notifyExams</span>
                {statusBadge(notifyExams)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">isCapacitor</span>
                {statusBadge(isCapacitor())}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">缓存成绩</span>
                <span className="font-mono text-xs">
                  {cachedGradeCount !== null ? `${cachedGradeCount} 条` : "无"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">缓存考试</span>
                <span className="font-mono text-xs">
                  {cachedExamCount !== null ? `${cachedExamCount} 条` : "无"}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* ── Native Plugin Debug ─────────────────────────────── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Smartphone className="size-4" />
                原生插件测试
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" onClick={handleNativeCheckPermission}>
                  <Shield className="size-3.5 mr-1" />
                  检查权限
                </Button>
                <Button variant="outline" size="sm" onClick={handleNativeRequestPermission}>
                  <Shield className="size-3.5 mr-1" />
                  请求权限
                </Button>
                <Button variant="outline" size="sm" onClick={handleNativeSetAuthToken}>
                  <Send className="size-3.5 mr-1" />
                  同步认证 token
                </Button>
                <Button variant="outline" size="sm" onClick={handleNativeStartPolling}>
                  <Power className="size-3.5 mr-1" />
                  启动轮询
                </Button>
                <Button variant="outline" size="sm" onClick={handleNativeStopPolling}>
                  <Power className="size-3.5 mr-1" />
                  停止轮询
                </Button>
                <Button variant="outline" size="sm" onClick={handleNativeRunWorker}>
                  <Play className="size-3.5 mr-1" />
                  立即执行
                </Button>
                <Button variant="outline" size="sm" onClick={handleNativeClearLog}>
                  <Trash2 className="size-3.5 mr-1" />
                  清空日志
                </Button>
              </div>

              {nativePermGranted !== null && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">通知权限:</span>
                  {nativePermGranted ? (
                    <span className="text-green-600">已授予</span>
                  ) : (
                    <span className="text-destructive">未授予</span>
                  )}
                </div>
              )}

              {nativeTestLog.length > 0 && (
                <ScrollArea className="h-48 rounded-md border bg-muted/30 p-2">
                  <pre className="text-[10px] font-mono whitespace-pre-wrap">
                    {nativeTestLog.join("\n")}
                  </pre>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-2">
            <Button variant="destructive" onClick={handleClearCache} className="w-full">
              <Trash2 className="size-4 mr-2" />
              {t("debug.clearCache")}
            </Button>
            <Button variant="outline" onClick={handleClearAcademicSession} className="w-full">
              <Trash2 className="size-4 mr-2" />
              {t("debug.clearAcademicSession")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
