import { useEffect, useRef, useState } from "react"
import {
  AlarmClock,
  ArrowRight,
  BarChart3,
  BatteryCharging,
  Bell,
  Check,
  Download,
  Globe,
  Info,
  Lock,
  Palette,
  Puzzle,
  Store,
} from "lucide-react"
import type { SessionSnapshot } from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import { Badge, Button, cn, Spinner, Switch } from "@orahako/ui-primitives"
import type { OnboardingDictionary, OnboardingStoreInstance } from "./store"

export const ONBOARDING_COMPLETING_EVENT = "orahako:onboarding-completing"
const EXIT_DURATION_MS = 420

const ONBOARDING_ANIMATION_STYLE = `
@keyframes orahako-ob-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes orahako-ob-rise {
  from {
    opacity: 0;
    transform: translate3d(0, 16px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-ob-step {
  from {
    opacity: 0;
    transform: translate3d(24px, 0, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-ob-item {
  from {
    opacity: 0;
    transform: translate3d(0, 10px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}
@keyframes orahako-ob-draw {
  from {
    stroke-dashoffset: 100;
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  to {
    stroke-dashoffset: 0;
    opacity: 1;
  }
}
@keyframes orahako-ob-spin-cw {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
@keyframes orahako-ob-spin-ccw {
  from {
    transform: rotate(45deg);
  }
  to {
    transform: rotate(-315deg);
  }
}
@keyframes orahako-ob-pulse-core {
  0%, 100% {
    transform: rotate(45deg) scale(1);
    opacity: 1;
  }
  50% {
    transform: rotate(45deg) scale(0.86);
    opacity: 0.72;
  }
}
@keyframes orahako-ob-orbit {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
@keyframes orahako-ob-exit-stage {
  from {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
  to {
    opacity: 0;
    transform: translate3d(0, -18px, 0) scale(0.975);
  }
}
@keyframes orahako-ob-exit-veil {
  0% {
    opacity: 1;
  }
  35% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}
[data-onboarding-wizard] {
  animation: orahako-ob-fade 280ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-onboarding-wizard][data-onboarding-exiting] {
  pointer-events: none;
  animation: orahako-ob-exit-veil ${EXIT_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
[data-onboarding-wizard][data-onboarding-exiting] [data-onboarding-main] {
  animation: orahako-ob-exit-stage 320ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
[data-onboarding-main] {
  animation: orahako-ob-rise 420ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-onboarding-step] {
  animation: orahako-ob-step 380ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-onboarding-item] {
  animation: orahako-ob-item 300ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
[data-onboarding-notice] {
  animation: orahako-ob-fade 220ms ease-out both;
}
[data-ob-draw] {
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: orahako-ob-draw 1100ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
[data-ob-ring-outer] {
  transform-origin: 120px 120px;
  animation: orahako-ob-spin-cw 42s linear infinite;
}
[data-ob-square-mid] {
  transform-origin: 120px 120px;
  animation: orahako-ob-spin-ccw 34s linear infinite;
}
[data-ob-orbit] {
  transform-origin: 120px 120px;
  animation: orahako-ob-orbit 18s linear infinite;
}
[data-ob-core] {
  transform-origin: 120px 120px;
  animation: orahako-ob-pulse-core 4.2s ease-in-out infinite;
}
[data-ob-stagger] {
  animation: orahako-ob-rise 480ms cubic-bezier(0.22, 1, 0.36, 1) both;
}
@media (prefers-reduced-motion: reduce) {
  [data-onboarding-wizard],
  [data-onboarding-wizard][data-onboarding-exiting],
  [data-onboarding-wizard][data-onboarding-exiting] [data-onboarding-main],
  [data-onboarding-main],
  [data-onboarding-step],
  [data-onboarding-item],
  [data-onboarding-notice],
  [data-ob-draw],
  [data-ob-ring-outer],
  [data-ob-square-mid],
  [data-ob-orbit],
  [data-ob-core],
  [data-ob-stagger] {
    animation: none;
    transition: none;
    stroke-dashoffset: 0;
    opacity: 1;
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

function dispatchOnboardingCompleting(): void {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function" ||
    typeof CustomEvent !== "function"
  ) {
    return
  }
  try {
    window.dispatchEvent(new CustomEvent(ONBOARDING_COMPLETING_EVENT))
  } catch {
    // Ignore environments with non-standard CustomEvent implementations.
  }
}

function GeometricEmblem() {
  return (
    <div
      data-onboarding-emblem=""
      className="relative mx-auto flex size-52 items-center justify-center sm:size-60"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 240 240"
        className="size-full text-foreground"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Crosshair construction axes */}
        <line
          x1="120"
          y1="14"
          x2="120"
          y2="226"
          pathLength={100}
          stroke="currentColor"
          strokeOpacity="0.14"
          strokeWidth="1"
          data-ob-draw=""
          style={{ animationDelay: "40ms" }}
        />
        <line
          x1="14"
          y1="120"
          x2="226"
          y2="120"
          pathLength={100}
          stroke="currentColor"
          strokeOpacity="0.14"
          strokeWidth="1"
          data-ob-draw=""
          style={{ animationDelay: "100ms" }}
        />
        <line
          x1="44"
          y1="44"
          x2="196"
          y2="196"
          pathLength={100}
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth="1"
          data-ob-draw=""
          style={{ animationDelay: "180ms" }}
        />
        <line
          x1="196"
          y1="44"
          x2="44"
          y2="196"
          pathLength={100}
          stroke="currentColor"
          strokeOpacity="0.1"
          strokeWidth="1"
          data-ob-draw=""
          style={{ animationDelay: "240ms" }}
        />

        {/* Outer rotating calibration ring */}
        <g data-ob-ring-outer="">
          <circle
            cx="120"
            cy="120"
            r="90"
            stroke="currentColor"
            strokeOpacity="0.32"
            strokeWidth="1"
            strokeDasharray="3 7"
          />
          <line x1="120" y1="24" x2="120" y2="34" stroke="currentColor" strokeWidth="1.25" />
          <line x1="120" y1="206" x2="120" y2="216" stroke="currentColor" strokeWidth="1.25" />
          <line x1="24" y1="120" x2="34" y2="120" stroke="currentColor" strokeWidth="1.25" />
          <line x1="206" y1="120" x2="216" y2="120" stroke="currentColor" strokeWidth="1.25" />
        </g>

        {/* Precision solid inner ring */}
        <circle
          cx="120"
          cy="120"
          r="66"
          pathLength={100}
          stroke="currentColor"
          strokeOpacity="0.65"
          strokeWidth="1"
          data-ob-draw=""
          style={{ animationDelay: "120ms" }}
        />

        {/* Counter-rotating architectural square frame */}
        <g data-ob-square-mid="">
          <rect
            x="68"
            y="68"
            width="104"
            height="104"
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeWidth="1"
          />
          <circle cx="68" cy="68" r="2.2" fill="currentColor" />
          <circle cx="172" cy="172" r="2.2" fill="currentColor" />
        </g>

        {/* Static orthogonal frame */}
        <rect
          x="78"
          y="78"
          width="84"
          height="84"
          pathLength={100}
          stroke="currentColor"
          strokeWidth="1.25"
          data-ob-draw=""
          style={{ animationDelay: "220ms" }}
        />

        {/* Orbiting geometric satellites */}
        <g data-ob-orbit="">
          <circle cx="120" cy="54" r="3.5" fill="currentColor" />
          <circle
            cx="120"
            cy="186"
            r="3.5"
            fill="var(--background)"
            stroke="currentColor"
            strokeWidth="1.25"
          />
        </g>

        {/* Central faceted diamond core */}
        <g data-ob-core="">
          <rect x="103" y="103" width="34" height="34" fill="currentColor" />
          <rect
            x="111"
            y="111"
            width="18"
            height="18"
            fill="var(--background)"
            stroke="var(--background)"
            strokeWidth="1"
          />
          <rect x="116.5" y="116.5" width="7" height="7" fill="currentColor" />
        </g>
      </svg>
    </div>
  )
}

function GeometricBrandMark({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-5 shrink-0 text-foreground", className)}
      fill="none"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.5" />
      <rect
        x="8.2"
        y="8.2"
        width="7.6"
        height="7.6"
        transform="rotate(45 12 12)"
        fill="currentColor"
      />
    </svg>
  )
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
  readonly hasAnalytics?: () => boolean
  readonly setAnalyticsConsent?: (enabled: boolean) => void
  readonly hasMarket?: () => boolean
  readonly getMarketEnabled?: () => boolean
  readonly setMarketEnabled?: (enabled: boolean) => void
  readonly isNative: () => boolean
  readonly hasProvider: (schoolId: string) => boolean
  readonly activateSchoolChoice: (school: OnboardingSchoolChoice) => Promise<void>
  readonly checkNotificationPermission?: () => Promise<boolean>
  readonly checkExactAlarmPermission?: () => Promise<boolean>
  readonly checkBatteryOptimization?: () => Promise<boolean>
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

  const [step, setStep] = useState<"welcome" | "agreement" | "market" | "school" | "permissions">(
    "welcome"
  )
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true)
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

  const {
    checkNotificationPermission,
    checkExactAlarmPermission,
    checkBatteryOptimization,
    isNative,
  } = props
  const hydrated = storeHydrated && session.hasHydrated
  const visible = hydrated && !completed
  const schoolLocked = storedSchoolId !== null
  const showMarketStep = props.hasMarket?.() ?? false
  const activeStep: "welcome" | "agreement" | "market" | "school" | "permissions" = schoolLocked
    ? "permissions"
    : step
  const onPermissionsStep = visible && activeStep === "permissions"
  const native = isNative()
  const showAnalyticsOption = props.hasAnalytics?.() ?? false

  useEffect(() => {
    if (!onPermissionsStep || !native) return
    let disposed = false
    let listener: { remove(): void | Promise<void> } | undefined

    const refreshPermissions = (): void => {
      const checks: Array<readonly [string, (() => Promise<boolean>) | undefined]> = [
        ["notifications", checkNotificationPermission],
        ["exactAlarm", checkExactAlarmPermission],
        ["battery", checkBatteryOptimization],
      ]
      for (const [key, check] of checks) {
        if (!check) continue
        void check()
          .then((granted) => {
            if (disposed || !granted) return
            setPermissionResults((current) =>
              current[key] === true ? current : { ...current, [key]: true }
            )
          })
          .catch(() => {})
      }
    }

    const onReturnToApp = (): void => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      refreshPermissions()
    }

    refreshPermissions()
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("focus", onReturnToApp)
    }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", onReturnToApp)
    }
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) refreshPermissions()
        })
      )
      .then((handle) => {
        if (disposed) {
          void handle.remove()
        } else {
          listener = handle
        }
      })
      .catch(() => {})

    return () => {
      disposed = true
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("focus", onReturnToApp)
      }
      if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", onReturnToApp)
      }
      void listener?.remove()
    }
  }, [
    checkBatteryOptimization,
    checkExactAlarmPermission,
    checkNotificationPermission,
    native,
    onPermissionsStep,
  ])

  if (!hydrated) {
    return (
      <div
        aria-hidden="true"
        data-onboarding-hydrating=""
        className="fixed inset-0 z-50 bg-background"
      />
    )
  }

  if (!visible) return null

  // A persisted school choice means the user already confirmed it; never unlock it again.
  const activeSchoolId = selectedSchoolId || schools[0]?.id || ""
  const totalSteps = showMarketStep ? 4 : 3
  const currentStepNumber =
    activeStep === "agreement"
      ? 1
      : activeStep === "market"
        ? 2
        : activeStep === "school"
          ? showMarketStep
            ? 3
            : 2
          : totalSteps
  const progressPercent = (currentStepNumber / totalSteps) * 100

  function acceptTermsAndContinue() {
    if (showAnalyticsOption) {
      props.setAnalyticsConsent?.(analyticsEnabled)
    }
    setStep(showMarketStep ? "market" : "school")
  }

  function chooseMarketAndContinue(enabled: boolean) {
    props.setMarketEnabled?.(enabled)
    setStep("school")
  }

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
    dispatchOnboardingCompleting()
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
      className="fixed inset-0 z-50 overflow-y-auto bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
    >
      <style data-onboarding-animations="">{ONBOARDING_ANIMATION_STYLE}</style>

      {/* Architectural hairline backdrop */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.045] dark:opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage: "radial-gradient(circle at 50% 45%, black 20%, transparent 78%)",
            WebkitMaskImage: "radial-gradient(circle at 50% 45%, black 20%, transparent 78%)",
          }}
        />
        <div className="absolute inset-y-0 left-6 hidden w-px bg-border/60 sm:block" />
        <div className="absolute inset-y-0 right-6 hidden w-px bg-border/60 sm:block" />
      </div>

      <main
        data-onboarding-main=""
        className="relative mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-6 py-10"
      >
        {activeStep === "welcome" ? (
          <section
            key="welcome"
            data-onboarding-step="welcome"
            className="flex flex-col items-center text-center"
          >
            <div data-ob-stagger="" style={{ animationDelay: "40ms" }} className="mb-10 w-full">
              <GeometricEmblem />
            </div>

            <h1
              data-ob-stagger=""
              style={{ animationDelay: "200ms" }}
              className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
            >
              {t("welcomeTitle")}
            </h1>

            <div data-ob-stagger="" style={{ animationDelay: "320ms" }} className="mt-10 w-full">
              <Button
                type="button"
                size="lg"
                onClick={() => setStep("agreement")}
                className="group h-12 w-full rounded-xl bg-foreground text-background transition-all duration-200 hover:bg-foreground/90 active:scale-[0.985]"
              >
                <span className="tracking-wide">{t("getStarted")}</span>
                <ArrowRight
                  data-icon="inline-end"
                  className="size-4 transition-transform duration-200 group-hover:translate-x-1"
                />
              </Button>
            </div>
          </section>
        ) : (
          <div className="relative py-4">
            <div className="mb-8 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <GeometricBrandMark />
                  <span className="text-sm font-semibold tracking-wide">{t("title")}</span>
                </div>
                <span className="font-mono text-xs tracking-wider text-muted-foreground tabular-nums">
                  0{currentStepNumber} / 0{totalSteps}
                </span>
              </div>
              <div
                className="h-0.5 w-full overflow-hidden rounded-full bg-border"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-foreground transition-[width] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {activeStep === "agreement" ? (
              <section key="agreement" data-onboarding-step="agreement">
                <h1 className="text-2xl font-semibold tracking-tight">{t("beforeStartTitle")}</h1>
                <p className="mt-1.5 mb-6 text-sm text-muted-foreground">{t("beforeStartDesc")}</p>

                <div className="divide-y divide-border border-y border-border">
                  {[
                    {
                      id: "unofficial",
                      icon: Info,
                      title: t("termUnofficialTitle"),
                      desc: t("termUnofficialDesc"),
                    },
                    {
                      id: "local",
                      icon: Lock,
                      title: t("termLocalTitle"),
                      desc: native ? t("termLocalDescNative") : t("termLocalDescWeb"),
                    },
                    {
                      id: "plugins",
                      icon: Puzzle,
                      title: t("termPluginsTitle"),
                      desc: t("termPluginsDesc"),
                    },
                  ].map((item, index) => {
                    const Icon = item.icon
                    return (
                      <div
                        key={item.id}
                        data-onboarding-item=""
                        style={{ animationDelay: `${index * 45}ms` }}
                        className="flex items-start gap-3 py-4"
                      >
                        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border">
                          <Icon className="size-4 text-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{item.title}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                            {item.desc}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {showAnalyticsOption && (
                  <div
                    data-onboarding-item=""
                    style={{ animationDelay: "150ms" }}
                    className="mt-5 flex items-start gap-3 rounded-xl border border-border p-4"
                  >
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border">
                      <BarChart3 className="size-4 text-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor="onboarding-analytics-switch"
                        className="block cursor-pointer text-sm font-medium"
                      >
                        {t("analyticsTitle")}
                      </label>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {t("analyticsDesc")}
                      </p>
                    </div>
                    <Switch
                      id="onboarding-analytics-switch"
                      checked={analyticsEnabled}
                      onCheckedChange={setAnalyticsEnabled}
                      className="mt-0.5 shrink-0"
                    />
                  </div>
                )}

                <Button
                  type="button"
                  onClick={acceptTermsAndContinue}
                  className="group mt-7 h-11 w-full rounded-xl bg-foreground text-background transition-all hover:bg-foreground/90 active:scale-[0.985]"
                >
                  <span>{t("agreeAndContinue")}</span>
                  <ArrowRight
                    data-icon="inline-end"
                    className="size-4 transition-transform duration-200 group-hover:translate-x-1"
                  />
                </Button>
              </section>
            ) : activeStep === "market" ? (
              <section key="market" data-onboarding-step="market">
                <h1 className="text-2xl font-semibold tracking-tight">{t("marketTitle")}</h1>
                <p className="mt-1.5 mb-6 text-sm text-muted-foreground">{t("marketDesc")}</p>

                <div className="divide-y divide-border border-y border-border">
                  {[
                    {
                      id: "themes",
                      icon: Palette,
                      title: t("marketBenefitThemesTitle"),
                      desc: t("marketBenefitThemesDesc"),
                    },
                    {
                      id: "extensions",
                      icon: Store,
                      title: t("marketBenefitExtensionsTitle"),
                      desc: t("marketBenefitExtensionsDesc"),
                    },
                  ].map((item, index) => {
                    const Icon = item.icon
                    return (
                      <div
                        key={item.id}
                        data-onboarding-item=""
                        style={{ animationDelay: `${index * 45}ms` }}
                        className="flex items-start gap-3 py-4"
                      >
                        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border">
                          <Icon className="size-4 text-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{item.title}</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                            {item.desc}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                  {t("marketNote")}
                </p>

                <div className="mt-6 flex flex-col gap-2.5">
                  <Button
                    type="button"
                    data-onboarding-market-enable=""
                    onClick={() => chooseMarketAndContinue(true)}
                    className="group h-11 w-full rounded-xl bg-foreground text-background transition-all hover:bg-foreground/90 active:scale-[0.985]"
                  >
                    <span>{t("enableMarket")}</span>
                    <ArrowRight
                      data-icon="inline-end"
                      className="size-4 transition-transform duration-200 group-hover:translate-x-1"
                    />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    data-onboarding-market-skip=""
                    onClick={() => chooseMarketAndContinue(false)}
                    className="h-11 w-full rounded-xl transition-all active:scale-[0.985]"
                  >
                    {t("skipMarket")}
                  </Button>
                </div>
              </section>
            ) : activeStep === "school" ? (
              <section key="school" data-onboarding-step="school">
                <h1 className="text-2xl font-semibold tracking-tight">{t("chooseSchool")}</h1>
                <p className="mt-1.5 mb-6 text-sm text-muted-foreground">{t("chooseSchoolDesc")}</p>

                <div className="space-y-2.5">
                  {schools.map((school, index) => {
                    const isSelected = activeSchoolId === school.id
                    const isOnlineMissing = !school.builtin && !props.hasProvider(school.id)
                    return (
                      <button
                        key={school.id}
                        type="button"
                        data-onboarding-item=""
                        style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
                        disabled={installing}
                        onClick={() => setSelectedSchoolId(school.id)}
                        className={cn(
                          "group relative flex h-14 w-full items-center justify-between rounded-xl border px-4 text-left transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.985] disabled:opacity-50",
                          isSelected
                            ? "border-foreground bg-foreground text-background"
                            : "border-border hover:border-foreground/40 hover:bg-muted/50"
                        )}
                        aria-pressed={isSelected}
                      >
                        <span className="flex items-center gap-3">
                          <span
                            className={cn(
                              "font-mono text-[11px] tabular-nums",
                              isSelected ? "text-background/70" : "text-muted-foreground"
                            )}
                          >
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="font-medium">
                            {locale === "en" && school.nameEn ? school.nameEn : school.name}
                          </span>
                        </span>
                        <span className="flex items-center gap-2">
                          {isOnlineMissing && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px]",
                                isSelected && "border-background/40 text-background"
                              )}
                            >
                              {t("online")}
                            </Badge>
                          )}
                          <Check
                            className={cn(
                              "size-4 transition-all duration-200",
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
                    className="mt-4 flex items-center gap-2 text-xs tracking-wide text-muted-foreground"
                  >
                    <Spinner data-icon="inline-start" />
                    {t("loadingSchools")}
                  </p>
                )}
                {schoolsError && (
                  <div
                    role="alert"
                    data-onboarding-notice=""
                    className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-destructive/40 px-3.5 py-2.5 text-xs text-destructive"
                  >
                    <span>{t("discoveryFailed")}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-lg"
                      onClick={() => retrySchoolDiscovery()}
                    >
                      {t("retry")}
                    </Button>
                  </div>
                )}
                {error && (
                  <p
                    role="alert"
                    data-onboarding-notice=""
                    className="mt-4 text-xs text-destructive"
                  >
                    {t("installFailed")}
                  </p>
                )}

                <Button
                  variant="outline"
                  className="mt-4 h-10 w-full rounded-xl border-dashed transition-transform active:scale-[0.99]"
                  disabled={installing || schoolsLoading}
                  onClick={() => retrySchoolDiscovery()}
                >
                  {schoolsLoading ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <Globe data-icon="inline-start" className="size-4" />
                  )}
                  {t("moreSchools")}
                </Button>

                <p className="mt-5 text-xs text-muted-foreground">{t("schoolLocked")}</p>

                <Button
                  className="mt-2.5 h-11 w-full rounded-xl bg-foreground text-background transition-all hover:bg-foreground/90 active:scale-[0.985]"
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
                <h1 className="text-2xl font-semibold tracking-tight">{t("permissions")}</h1>
                <p className="mt-1.5 mb-6 text-sm text-muted-foreground">{t("permissionsDesc")}</p>

                {permissions.length === 0 ? (
                  <div className="border-y border-border py-6 text-sm text-muted-foreground">
                    {t("noPermissions")}
                  </div>
                ) : (
                  <div className="divide-y divide-border border-y border-border">
                    {permissions.map((permission, index) => {
                      const result = permissionResults[permission.id]
                      const busy = permissionBusy === permission.id
                      const Icon = permission.icon
                      return (
                        <div
                          key={permission.id}
                          data-onboarding-item=""
                          style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}
                          className="flex h-16 items-center gap-3 px-1"
                        >
                          <div className="flex size-9 items-center justify-center rounded-lg border border-border">
                            <Icon className="size-4 text-foreground" />
                          </div>
                          <span className="flex-1 text-sm font-medium">{permission.title}</span>
                          <Button
                            variant={result ? "secondary" : "outline"}
                            size="sm"
                            className="rounded-lg transition-all duration-200 active:scale-[0.97]"
                            disabled={result === true || Boolean(permissionBusy) || exiting}
                            onClick={() =>
                              void requestPermission(permission.id, permission.request)
                            }
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

                <div className="mt-8 flex items-center gap-3">
                  <Button
                    variant="ghost"
                    className="h-11 rounded-xl px-4"
                    disabled={exiting}
                    onClick={finish}
                  >
                    {t("skip")}
                  </Button>
                  <Button
                    className="group h-11 flex-1 rounded-xl bg-foreground text-background transition-all hover:bg-foreground/90 active:scale-[0.985]"
                    disabled={exiting}
                    onClick={finish}
                  >
                    <span>{t("finish")}</span>
                    <ArrowRight
                      data-icon="inline-end"
                      className="size-4 transition-transform duration-200 group-hover:translate-x-1"
                    />
                  </Button>
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
