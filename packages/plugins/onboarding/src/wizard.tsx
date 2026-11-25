import { useEffect, useRef, useState } from "react"
import { AlarmClock, BatteryCharging, Bell, Check, Download, GraduationCap } from "lucide-react"
import type { SessionSnapshot } from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import { Badge, Button, cn, Spinner } from "@orahako/ui-primitives"
import type { OnboardingDictionary, OnboardingStoreInstance } from "./store"

const EXIT_DURATION_MS = 200

const ONBOARDING_ANIMATION_STYLE = `
@keyframes orahako-onboarding-enter {
  from {
    opacity: 0;
    transform: translate3d(0, 12px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-onboarding-step {
  from {
    opacity: 0;
    transform: translate3d(18px, 0, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-onboarding-item {
  from {
    opacity: 0;
    transform: translate3d(0, 8px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-onboarding-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
[data-onboarding-wizard] {
  animation: orahako-onboarding-fade 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
  transition: opacity ${EXIT_DURATION_MS}ms ease-out;
}
[data-onboarding-wizard][data-onboarding-exiting] {
  opacity: 0;
  pointer-events: none;
}
[data-onboarding-main] {
  animation: orahako-onboarding-enter 340ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-onboarding-step] {
  animation: orahako-onboarding-step 320ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-onboarding-item] {
  animation: orahako-onboarding-item 280ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-onboarding-notice] {
  animation: orahako-onboarding-fade 200ms ease-out both;
}
@media (prefers-reduced-motion: reduce) {
  [data-onboarding-wizard],
  [data-onboarding-main],
  [data-onboarding-step],
  [data-onboarding-item],
  [data-onboarding-notice] {
    animation: none;
    transition: none;
  }
}
`.trim()

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  try {
    return Boolean(window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  } catch {
    return false
  }
}

export interface OnboardingSchoolChoice {
  readonly id: string
  readonly name: string
  readonly nameEn?: string
  readonly bundleId?: string
  readonly builtin?: boolean
}

export interface OnboardingWizardInject {
  readonly hooks: {
    readonly storeHydrated: ObservableSource<boolean>
    readonly session: ObservableSource<SessionSnapshot>
    readonly schools: ObservableSource<readonly OnboardingSchoolChoice[]>
    readonly schoolsLoading: ObservableSource<boolean>
    readonly schoolsError: ObservableSource<string | null>
  }
  readonly retrySchoolDiscovery: () => void
  readonly isNative: () => boolean
  readonly hasProvider: (schoolId: string) => boolean
  readonly activateSchoolChoice: (school: OnboardingSchoolChoice) => Promise<void>
  readonly requestNotificationPermission: () => Promise<boolean>
  readonly requestExactAlarmPermission: () => Promise<boolean>
  readonly requestBatteryOptimizationExemption: () => Promise<boolean>
}

export type OnboardingWizardProps = DerivedComponentProps<
  Record<string, never>,
  OnboardingDictionary,
  undefined,
  OnboardingStoreInstance,
  OnboardingWizardInject
>

export const OnboardingWizard: SlotComponent<OnboardingWizardProps> = (props) => {
  const { t, locale, useStore, actions } = props
  const storeHydrated = props.useStoreHydrated()
  const session = props.useSession()
  const schools = props.useSchools()
  const schoolsLoading = props.useSchoolsLoading()
  const schoolsError = props.useSchoolsError()
  const retrySchoolDiscovery = props.retrySchoolDiscovery

  const completed = useStore((state) => state.completed)
  const storedSchoolId = useStore((state) => state.selectedSchoolId)

  const [step, setStep] = useState<"school" | "permissions">("school")
  const [selectedSchoolId, setSelectedSchoolId] = useState(
    () => storedSchoolId ?? schools[0]?.id ?? ""
  )
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [permissionBusy, setPermissionBusy] = useState("")
  const [permissionResults, setPermissionResults] = useState<Record<string, boolean>>({})
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current)
        exitTimerRef.current = null
      }
    }
  }, [])

  if (!storeHydrated || !session.hasHydrated || completed) return null

  // A persisted school choice means the user already confirmed it; never unlock it again.
  const schoolLocked = storedSchoolId !== null
  const showSchoolStep = !schoolLocked && step === "school"
  const activeSchoolId = selectedSchoolId || schools[0]?.id || ""
  const native = props.isNative()
  const totalSteps = 2
  const currentStepNumber = showSchoolStep ? 1 : 2
  const progressPercent = (currentStepNumber / totalSteps) * 100

  async function selectSchoolAndContinue() {
    const school = schools.find((item) => item.id === activeSchoolId) ?? schools[0]
    if (!school) return
    setInstalling(true)
    setError(false)
    try {
      await props.activateSchoolChoice(school)
      actions.selectSchool(school.id)
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
    ...(native || typeof Notification !== "undefined"
      ? [
          {
            id: "notifications",
            title: t("notifications"),
            icon: Bell,
            request: () => props.requestNotificationPermission(),
          },
        ]
      : []),
    ...(native
      ? [
          {
            id: "exactAlarm",
            title: t("exactAlarm"),
            icon: AlarmClock,
            request: () => props.requestExactAlarmPermission(),
          },
          {
            id: "battery",
            title: t("battery"),
            icon: BatteryCharging,
            request: () => props.requestBatteryOptimizationExemption(),
          },
        ]
      : []),
  ]

  function finish() {
    if (exiting) return
    if (prefersReducedMotion()) {
      actions.complete()
      return
    }
    setExiting(true)
    exitTimerRef.current = setTimeout(() => {
      exitTimerRef.current = null
      actions.complete()
    }, EXIT_DURATION_MS)
  }

  return (
    <div
      data-onboarding-wizard=""
      data-onboarding-exiting={exiting ? "" : undefined}
      className="fixed inset-0 z-50 overflow-y-auto bg-background"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
    >
      <style data-onboarding-animations="">{ONBOARDING_ANIMATION_STYLE}</style>
      <main
        data-onboarding-main=""
        className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-6 py-10"
      >
        <div className="mb-8 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <GraduationCap className="size-6" />
              <span className="font-semibold">{t("title")}</span>
            </div>
            <span className="text-sm text-muted-foreground tabular-nums">
              {currentStepNumber} / {totalSteps}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {showSchoolStep ? (
          <section key="school" data-onboarding-step="school">
            <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("chooseSchool")}</h1>
            <div className="space-y-3">
              {schools.map((school, index) => {
                const isSelected = activeSchoolId === school.id
                const isOnlineMissing = !school.builtin && !props.hasProvider(school.id)
                return (
                  <button
                    key={school.id}
                    type="button"
                    data-onboarding-item=""
                    style={{ animationDelay: `${Math.min(index, 6) * 40}ms` }}
                    disabled={installing}
                    onClick={() => setSelectedSchoolId(school.id)}
                    className="flex h-14 w-full items-center justify-between rounded-xl border px-4 text-left transition-all duration-200 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.985] disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-primary/5"
                    aria-pressed={isSelected}
                  >
                    <span className="font-medium">
                      {locale === "en" && school.nameEn ? school.nameEn : school.name}
                    </span>
                    <span className="flex items-center gap-2">
                      {isOnlineMissing && <Badge variant="secondary">{t("online")}</Badge>}
                      <Check
                        className={cn(
                          "size-4 text-primary transition-all duration-200",
                          isSelected ? "scale-100 opacity-100" : "scale-75 opacity-0"
                        )}
                        aria-hidden={!isSelected}
                      />
                    </span>
                  </button>
                )
              })}
            </div>
            {schoolsLoading && (
              <p
                role="status"
                data-onboarding-notice=""
                className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Spinner data-icon="inline-start" />
                {t("loadingSchools")}
              </p>
            )}
            {schoolsError && (
              <div
                role="alert"
                data-onboarding-notice=""
                className="mt-4 flex items-center justify-between gap-3 text-sm text-destructive"
              >
                <span>{t("discoveryFailed")}</span>
                <Button variant="outline" size="sm" onClick={() => retrySchoolDiscovery()}>
                  {t("retry")}
                </Button>
              </div>
            )}
            {error && (
              <p role="alert" data-onboarding-notice="" className="mt-4 text-sm text-destructive">
                {t("installFailed")}
              </p>
            )}
            <Button
              variant="outline"
              className="mt-4 w-full transition-transform active:scale-[0.985]"
              disabled={installing || schoolsLoading}
              onClick={() => retrySchoolDiscovery()}
            >
              {schoolsLoading ? <Spinner data-icon="inline-start" /> : null}
              {t("moreSchools")}
            </Button>
            <p className="mt-4 text-sm text-muted-foreground">{t("schoolLocked")}</p>
            <Button
              className="mt-2 w-full transition-transform active:scale-[0.985]"
              disabled={installing || !activeSchoolId}
              onClick={() => void selectSchoolAndContinue()}
            >
              {installing ? <Spinner data-icon="inline-start" /> : null}
              {!installing && activeSchoolId && !props.hasProvider(activeSchoolId) ? (
                <Download data-icon="inline-start" />
              ) : null}
              {installing ? t("installing") : t("confirm")}
            </Button>
          </section>
        ) : (
          <section key="permissions" data-onboarding-step="permissions">
            <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("permissions")}</h1>
            {permissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noPermissions")}</p>
            ) : (
              <div className="divide-y rounded-xl border px-4">
                {permissions.map((permission, index) => {
                  const result = permissionResults[permission.id]
                  const busy = permissionBusy === permission.id
                  const Icon = permission.icon
                  return (
                    <div
                      key={permission.id}
                      data-onboarding-item=""
                      style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                      className="flex h-16 items-center gap-3"
                    >
                      <Icon className="size-5 text-muted-foreground" />
                      <span className="flex-1 text-sm font-medium">{permission.title}</span>
                      <Button
                        variant={result ? "secondary" : "outline"}
                        size="sm"
                        className="transition-all duration-200 active:scale-[0.97]"
                        disabled={result === true || Boolean(permissionBusy) || exiting}
                        onClick={() => void requestPermission(permission.id, permission.request)}
                      >
                        {busy ? <Spinner data-icon="inline-start" /> : null}
                        {result === true ? <Check data-icon="inline-start" /> : null}
                        {result === true
                          ? t("enabled")
                          : result === false
                            ? t("retry")
                            : t("allow")}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="mt-6 flex gap-3">
              <Button variant="ghost" disabled={exiting} onClick={finish}>
                {t("skip")}
              </Button>
              <Button
                className="flex-1 transition-transform active:scale-[0.985]"
                disabled={exiting}
                onClick={finish}
              >
                {t("finish")}
              </Button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
