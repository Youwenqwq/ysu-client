"use client"

import { useState } from "react"
import {
  AlarmClock,
  BatteryCharging,
  Bell,
  Check,
  ChevronLeft,
  Download,
  GraduationCap,
} from "lucide-react"
import type {
  PluginInstallerService,
  PluginNativeService,
  PluginProviderService,
} from "@orahako/plugin-sdk"
import { setSchoolConfig } from "@orahako/plugin-sdk/host"
import { Badge, Button, Spinner } from "@orahako/plugin-ui/components"
import { useTranslation } from "@orahako/plugin-ui/hooks"
import { setActiveProviderSchool, useAuthStore, useSettingsStore } from "@orahako/plugin-ui/stores"

const SCHOOLS = [
  { id: "ysu", name: "燕山大学", providerId: "ysu.provider", online: false },
  { id: "zmu", name: "遵义医科大学", providerId: "zmu.provider", online: true },
] as const

interface OnboardingWizardProps {
  installFromMarket: PluginInstallerService["installFromMarket"]
  hasProvider: PluginProviderService["hasProvider"]
  native: PluginNativeService
}

export function OnboardingWizard({
  installFromMarket,
  hasProvider,
  native,
}: OnboardingWizardProps) {
  const { t } = useTranslation()
  const settingsHydrated = useSettingsStore((state) => state.hasHydrated)
  const authHydrated = useAuthStore((state) => state.hasHydrated)
  const completed = useSettingsStore((state) => state.onboardingCompleted)
  const [step, setStep] = useState<"school" | "permissions">("school")
  const [schoolId, setSchoolId] = useState("ysu")
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState(false)
  const [permissionBusy, setPermissionBusy] = useState("")
  const [permissionResults, setPermissionResults] = useState<Record<string, boolean>>({})

  if (!settingsHydrated || !authHydrated || completed) return null

  async function selectSchool() {
    const school = SCHOOLS.find((item) => item.id === schoolId) ?? SCHOOLS[0]
    setInstalling(true)
    setError(false)
    try {
      if (!hasProvider(school.id)) {
        await installFromMarket(school.providerId)
      }
      if (!hasProvider(school.id)) throw new Error("Provider registration missing")
      useSettingsStore.getState().setSchoolId(school.id)
      setSchoolConfig(school.id)
      setActiveProviderSchool(school.id)
      setStep("permissions")
    } catch {
      setError(true)
    } finally {
      setInstalling(false)
    }
  }

  async function requestPermission(key: string, request: () => Promise<boolean>) {
    setPermissionBusy(key)
    try {
      const granted = await request()
      setPermissionResults((current) => ({ ...current, [key]: granted }))
    } catch {
      setPermissionResults((current) => ({ ...current, [key]: false }))
    } finally {
      setPermissionBusy("")
    }
  }

  const permissions = [
    ...(native.isNative || typeof Notification !== "undefined"
      ? [
          {
            id: "notifications",
            title: t("onboarding.notifications"),
            icon: Bell,
            request: () => native.requestNotificationPermission(),
          },
        ]
      : []),
    ...(native.isNative
      ? [
          {
            id: "exactAlarm",
            title: t("onboarding.exactAlarm"),
            icon: AlarmClock,
            request: () => native.requestExactAlarmPermission(),
          },
          {
            id: "battery",
            title: t("onboarding.battery"),
            icon: BatteryCharging,
            request: () => native.requestBatteryOptimizationExemption(),
          },
        ]
      : []),
  ]

  function finish() {
    useSettingsStore.getState().setOnboardingCompleted(true)
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-background"
      role="dialog"
      aria-modal="true"
      aria-label={t("onboarding.title")}
    >
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-6 py-10">
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GraduationCap className="size-6" />
            <span className="font-semibold">{t("onboarding.title")}</span>
          </div>
          <span className="text-sm text-muted-foreground">{step === "school" ? 1 : 2} / 2</span>
        </div>

        {step === "school" ? (
          <section>
            <h1 className="mb-6 text-2xl font-semibold tracking-tight">
              {t("onboarding.chooseSchool")}
            </h1>
            <div className="space-y-3">
              {SCHOOLS.map((school) => (
                <button
                  key={school.id}
                  type="button"
                  disabled={installing}
                  onClick={() => setSchoolId(school.id)}
                  className="flex h-14 w-full items-center justify-between rounded-xl border px-4 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-primary/5"
                  aria-pressed={schoolId === school.id}
                >
                  <span className="font-medium">{school.name}</span>
                  <span className="flex items-center gap-2">
                    {school.online && !hasProvider(school.id) && (
                      <Badge variant="secondary">{t("onboarding.online")}</Badge>
                    )}
                    {schoolId === school.id && <Check className="size-4 text-primary" />}
                  </span>
                </button>
              ))}
            </div>
            {error && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {t("onboarding.installFailed")}
              </p>
            )}
            <Button
              className="mt-6 w-full"
              disabled={installing}
              onClick={() => void selectSchool()}
            >
              {installing ? <Spinner data-icon="inline-start" /> : null}
              {!installing && !hasProvider(schoolId) ? <Download data-icon="inline-start" /> : null}
              {installing ? t("onboarding.installing") : t("onboarding.continue")}
            </Button>
          </section>
        ) : (
          <section>
            <h1 className="mb-6 text-2xl font-semibold tracking-tight">
              {t("onboarding.permissions")}
            </h1>
            {permissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("onboarding.noPermissions")}</p>
            ) : (
              <div className="divide-y rounded-xl border px-4">
                {permissions.map((permission) => {
                  const result = permissionResults[permission.id]
                  const busy = permissionBusy === permission.id
                  const Icon = permission.icon
                  return (
                    <div key={permission.id} className="flex h-16 items-center gap-3">
                      <Icon className="size-5 text-muted-foreground" />
                      <span className="flex-1 text-sm font-medium">{permission.title}</span>
                      <Button
                        variant={result ? "secondary" : "outline"}
                        size="sm"
                        disabled={result === true || !!permissionBusy}
                        onClick={() => void requestPermission(permission.id, permission.request)}
                      >
                        {busy ? <Spinner data-icon="inline-start" /> : null}
                        {result === true ? <Check data-icon="inline-start" /> : null}
                        {result === true
                          ? t("onboarding.enabled")
                          : result === false
                            ? t("onboarding.retry")
                            : t("onboarding.allow")}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="mt-6 flex gap-3">
              <Button variant="ghost" onClick={() => setStep("school")}>
                <ChevronLeft data-icon="inline-start" />
                {t("onboarding.back")}
              </Button>
              <Button variant="ghost" onClick={finish}>
                {t("onboarding.skip")}
              </Button>
              <Button className="flex-1" onClick={finish}>
                {t("onboarding.finish")}
              </Button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
