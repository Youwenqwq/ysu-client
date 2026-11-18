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
import type { SessionSnapshot } from "@orahako/academic-sdk"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import { Badge, Button, Spinner } from "@orahako/ui-primitives"
import type { OnboardingDictionary, OnboardingStoreInstance } from "./store"

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
    readonly providersRevision: ObservableSource<number>
  }
  readonly schools: readonly OnboardingSchoolChoice[]
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
  const { t, locale, useStore, actions, schools } = props
  const storeHydrated = props.useStoreHydrated()
  const session = props.useSession()
  const providersRevision = props.useProvidersRevision()
  void providersRevision

  const completed = useStore((state) => state.completed)
  const storedSchoolId = useStore((state) => state.selectedSchoolId)

  const [step, setStep] = useState<"school" | "permissions">(() =>
    schools.length > 0 ? "school" : "permissions"
  )
  const [selectedSchoolId, setSelectedSchoolId] = useState(
    () => storedSchoolId ?? schools[0]?.id ?? ""
  )
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState(false)
  const [permissionBusy, setPermissionBusy] = useState("")
  const [permissionResults, setPermissionResults] = useState<Record<string, boolean>>({})

  if (!storeHydrated || !session.hasHydrated || completed) return null

  const activeSchoolId = selectedSchoolId || schools[0]?.id || ""
  const native = props.isNative()
  const totalSteps = schools.length > 0 ? 2 : 1
  const currentStepNumber = schools.length > 0 ? (step === "school" ? 1 : 2) : 1

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
    actions.complete()
  }

  return (
    <div
      data-onboarding-wizard=""
      className="fixed inset-0 z-50 overflow-y-auto bg-background"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
    >
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-6 py-10">
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <GraduationCap className="size-6" />
            <span className="font-semibold">{t("title")}</span>
          </div>
          <span className="text-sm text-muted-foreground">
            {currentStepNumber} / {totalSteps}
          </span>
        </div>

        {step === "school" && schools.length > 0 ? (
          <section>
            <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("chooseSchool")}</h1>
            <div className="space-y-3">
              {schools.map((school) => {
                const isSelected = activeSchoolId === school.id
                const isOnlineMissing = !school.builtin && !props.hasProvider(school.id)
                return (
                  <button
                    key={school.id}
                    type="button"
                    disabled={installing}
                    onClick={() => setSelectedSchoolId(school.id)}
                    className="flex h-14 w-full items-center justify-between rounded-xl border px-4 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-pressed:border-primary aria-pressed:bg-primary/5"
                    aria-pressed={isSelected}
                  >
                    <span className="font-medium">
                      {locale === "en" && school.nameEn ? school.nameEn : school.name}
                    </span>
                    <span className="flex items-center gap-2">
                      {isOnlineMissing && <Badge variant="secondary">{t("online")}</Badge>}
                      {isSelected && <Check className="size-4 text-primary" />}
                    </span>
                  </button>
                )
              })}
            </div>
            {error && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {t("installFailed")}
              </p>
            )}
            <Button
              className="mt-6 w-full"
              disabled={installing || !activeSchoolId}
              onClick={() => void selectSchoolAndContinue()}
            >
              {installing ? <Spinner data-icon="inline-start" /> : null}
              {!installing && activeSchoolId && !props.hasProvider(activeSchoolId) ? (
                <Download data-icon="inline-start" />
              ) : null}
              {installing ? t("installing") : t("continue")}
            </Button>
          </section>
        ) : (
          <section>
            <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("permissions")}</h1>
            {permissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noPermissions")}</p>
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
                        disabled={result === true || Boolean(permissionBusy)}
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
              {schools.length > 0 && (
                <Button variant="ghost" onClick={() => setStep("school")}>
                  <ChevronLeft data-icon="inline-start" />
                  {t("back")}
                </Button>
              )}
              <Button variant="ghost" onClick={finish}>
                {t("skip")}
              </Button>
              <Button className="flex-1" onClick={finish}>
                {t("finish")}
              </Button>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
