import { useEffect, useRef, useState, type ReactNode } from "react"
import { toast } from "sonner"
import {
  CheckCircle2,
  Clock,
  Fingerprint,
  Hash,
  MapPin,
  QrCode,
  RotateCcw,
  Signpost,
  Timer,
  XCircle,
} from "lucide-react"
import type {
  Course,
  CurrentLesson,
  CurrentLessonQuery,
  LessonActivity,
  SigninActivityDetail,
  StudentSignInput,
  StudentSignResult,
  StudentSigninStatus,
} from "@orahako/academic-sdk"
import {
  loadNativeCapabilities,
  type PluginNativeService,
  type Translator,
} from "@orahako/sdk"
import {
  Badge,
  Button,
  cn,
  Input,
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  Separator,
  Skeleton,
  Spinner,
} from "@orahako/ui-primitives"
import type { ScheduleDictionary } from "./dictionary"

export const NATIVE_GEOLOCATION_CAPABILITY = "native.geolocation@1"

export interface GeolocationCoordinatesSnapshot {
  readonly latitude: number
  readonly longitude: number
  readonly accuracy: number
}

export interface MobileLessonBridge {
  hasMobileSupport(): boolean
  getCurrentLesson(query: CurrentLessonQuery): Promise<CurrentLesson>
  getSigninContext(
    activityId: string,
    title: string
  ): Promise<{
    readonly detail: SigninActivityDetail
    readonly status: StudentSigninStatus
  }>
  signIn(
    input: StudentSignInput & { readonly requireLocation?: boolean }
  ): Promise<StudentSignResult>
}

interface NativePositionResult {
  readonly coords?: {
    readonly latitude?: number
    readonly longitude?: number
    readonly accuracy?: number
  }
}

export async function resolveGeolocationCoordinates(
  native: PluginNativeService,
  options: {
    readonly required: boolean
    readonly loadCapabilities?: () => Promise<unknown>
  }
): Promise<GeolocationCoordinatesSnapshot> {
  const ensureLoaded = options.loadCapabilities ?? loadNativeCapabilities

  if (native.isNative) {
    try {
      await ensureLoaded().catch(() => {})
      if (native.capabilities.has(NATIVE_GEOLOCATION_CAPABILITY)) {
        const position = await native.capabilities.invoke<NativePositionResult>(
          NATIVE_GEOLOCATION_CAPABILITY,
          "getCurrentPosition",
          {
            enableHighAccuracy: true,
            timeout: 10_000,
            maximumAge: 0,
          }
        )
        const lat = position?.coords?.latitude
        const lng = position?.coords?.longitude
        const acc = position?.coords?.accuracy ?? 0
        if (typeof lat === "number" && Number.isFinite(lat) && typeof lng === "number" && Number.isFinite(lng)) {
          return { latitude: lat, longitude: lng, accuracy: Number.isFinite(acc) ? acc : 0 }
        }
      }
      if (options.required) {
        throw new Error("Location unavailable")
      }
    } catch (error) {
      if (options.required) throw error
    }
    return { latitude: 0, longitude: 0, accuracy: 0 }
  }

  if (typeof navigator !== "undefined" && "geolocation" in navigator && navigator.geolocation) {
    try {
      const browserPosition = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10_000,
          maximumAge: 0,
        })
      })
      return {
        latitude: browserPosition.coords.latitude,
        longitude: browserPosition.coords.longitude,
        accuracy: browserPosition.coords.accuracy ?? 0,
      }
    } catch (error) {
      if (options.required) throw error
    }
  } else if (options.required) {
    throw new Error("Location unavailable")
  }

  return { latitude: 0, longitude: 0, accuracy: 0 }
}

function formatActivityDateTime(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function SigninStatusBadge({
  isEnd,
  t,
}: {
  readonly isEnd: boolean
  readonly t: Translator<ScheduleDictionary>
}): ReactNode {
  if (!isEnd) {
    return (
      <Badge variant="default" className="text-[10px]">
        {t("activity.statusActive")}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="text-[10px]">
      {t("activity.statusEnded")}
    </Badge>
  )
}

function ActivityItemRow({
  activity,
  t,
  onSignin,
}: {
  readonly activity: LessonActivity
  readonly t: Translator<ScheduleDictionary>
  readonly onSignin?: (activityId: string, signinType: number) => void
}): ReactNode {
  const isSignin = activity.signClazz === "1"
  const label = isSignin ? t("activity.signinItem") : t("activity.signoutItem")
  const canJoin = !activity.isEnd

  return (
    <button
      type="button"
      data-lesson-activity={activity.activityId}
      disabled={!canJoin}
      onClick={() => canJoin && onSignin?.(activity.activityId, Number(activity.signType) || 1)}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border p-3 text-left",
        canJoin
          ? "cursor-pointer bg-card transition-colors hover:bg-accent/50 active:bg-accent"
          : "cursor-default bg-muted/30 opacity-70"
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Signpost className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{label}</span>
        {activity.createTime && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {formatActivityDateTime(activity.createTime)}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SigninStatusBadge isEnd={activity.isEnd} t={t} />
      </div>
    </button>
  )
}

export function CourseActivityModal({
  course,
  week,
  open,
  mobileBridge,
  t,
  onOpenChange,
  onSigninActivity,
}: {
  readonly course: Course | null
  readonly week: number
  readonly open: boolean
  readonly mobileBridge: MobileLessonBridge
  readonly t: Translator<ScheduleDictionary>
  readonly onOpenChange: (open: boolean) => void
  readonly onSigninActivity?: (activityId: string, signinType: number) => void
}): ReactNode {
  const [loading, setLoading] = useState(false)
  const [lesson, setLesson] = useState<CurrentLesson | null>(null)
  const [missingCourseInfo, setMissingCourseInfo] = useState(false)
  const hasMobile = mobileBridge.hasMobileSupport()

  useEffect(() => {
    if (!open || !course) {
      setLesson(null)
      setMissingCourseInfo(false)
      setLoading(false)
      return
    }
    if (!mobileBridge.hasMobileSupport()) {
      setLesson(null)
      setMissingCourseInfo(false)
      setLoading(false)
      return
    }

    let cancelled = false
    const activeCourse = course
    const classType = activeCourse.classType || "1"
    const teachClassId = classType === "1" ? activeCourse.classId : activeCourse.syxzdm
    if (!teachClassId || !activeCourse.scheduleId) {
      setMissingCourseInfo(true)
      setLesson(null)
      return
    }

    setMissingCourseInfo(false)
    setLoading(true)
    void mobileBridge
      .getCurrentLesson({
        teachClassId,
        teachClassType: classType,
        scheduleId: activeCourse.scheduleId,
        week,
        weekDay: activeCourse.weekDay,
        startNode: activeCourse.startSection,
        endNode: activeCourse.endSection,
      })
      .then((result) => {
        if (!cancelled) setLesson(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : ""
          toast.error(message || t("activity.loadFailed"))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [course, mobileBridge, open, t, week])

  const signinActivities = lesson?.activityList.filter((item) => item.signClazz === "1") ?? []
  const signoutActivities = lesson?.activityList.filter((item) => item.signClazz === "2") ?? []

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="sm:max-w-md" aria-describedby={undefined}>
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{course?.name || t("activity.title")}</ResponsiveModalTitle>
          {course && (
            <div className="flex flex-wrap items-center justify-center gap-1 pt-1">
              {course.courseType && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {course.courseType}
                </Badge>
              )}
              {course.credit && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {t("schedule.credit")} {course.credit}
                </Badge>
              )}
              {course.code && (
                <Badge variant="outline" className="h-5 px-1.5 font-mono text-[10px]">
                  {course.code}
                </Badge>
              )}
            </div>
          )}
        </ResponsiveModalHeader>
        <ResponsiveModalBody className="flex flex-col gap-4">
          {course && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
              {course.teacher && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("schedule.teacher")}</span>
                  <span>{course.teacher}</span>
                </div>
              )}
              {course.classroom && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("schedule.classroom")}</span>
                  <span>{course.classroom}</span>
                </div>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("schedule.sections")}</span>
                <span>
                  {t("scheduleEditor.sectionRange", {
                    start: course.startSection,
                    end: course.endSection,
                  })}
                </span>
              </div>
              {course.weeks && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t("schedule.weeks")}</span>
                  <span>{course.weeks}</span>
                </div>
              )}
            </div>
          )}

          {hasMobile && loading && (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          )}

          {hasMobile && !loading && missingCourseInfo && (
            <div className="flex flex-col items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Signpost className="size-6 opacity-40" />
              <span>{t("activity.errorNoCourseInfo")}</span>
            </div>
          )}

          {hasMobile && !loading && !missingCourseInfo && lesson === null && (
            <div className="flex flex-col items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Signpost className="size-8 opacity-40" />
              <span>{t("activity.noData")}</span>
            </div>
          )}

          {hasMobile && !loading && lesson !== null && (
            <div className="flex flex-col gap-4">
              {signinActivities.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-semibold">{t("activity.signinSection")}</h4>
                  {signinActivities.map((activity) => (
                    <ActivityItemRow
                      key={activity.activityId}
                      activity={activity}
                      t={t}
                      onSignin={onSigninActivity}
                    />
                  ))}
                </div>
              )}

              {signoutActivities.length > 0 && (
                <div className="flex flex-col gap-2">
                  {signinActivities.length > 0 && <Separator />}
                  <h4 className="text-sm font-semibold">{t("activity.signoutSection")}</h4>
                  {signoutActivities.map((activity) => (
                    <ActivityItemRow
                      key={activity.activityId}
                      activity={activity}
                      t={t}
                      onSignin={onSigninActivity}
                    />
                  ))}
                </div>
              )}

              {lesson.activityList.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Signpost className="size-8 opacity-40" />
                  <span>{t("activity.noActivities")}</span>
                </div>
              )}
            </div>
          )}
        </ResponsiveModalBody>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}

function SigninResultView({
  result,
  t,
  onRetry,
}: {
  readonly result: {
    readonly success: boolean
    readonly rank?: number
    readonly attendanceStatus?: number
  }
  readonly t: Translator<ScheduleDictionary>
  readonly onRetry: () => void
}): ReactNode {
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      {result.success ? (
        <>
          <CheckCircle2 className="size-14 text-green-500" />
          <div className="text-center">
            <p className="text-lg font-semibold">{t("activity.signinSuccess")}</p>
            {result.rank !== undefined && result.rank > 0 && result.rank !== 999999 && (
              <p className="text-sm text-muted-foreground">
                {t("activity.signRank", { rank: result.rank })}
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <XCircle className="size-14 text-destructive" />
          <div className="text-center">
            <p className="text-lg font-semibold">{t("activity.signinFailed")}</p>
          </div>
        </>
      )}
      <Button type="button" variant="outline" size="sm" className="gap-1" onClick={onRetry}>
        <RotateCcw className="size-3.5" />
        {t("activity.retry")}
      </Button>
    </div>
  )
}

export function CourseSigninModal({
  activityId,
  signinType,
  open,
  mobileBridge,
  t,
  onOpenChange,
}: {
  readonly activityId: string | null
  readonly signinType: number
  readonly open: boolean
  readonly mobileBridge: MobileLessonBridge
  readonly t: Translator<ScheduleDictionary>
  readonly onOpenChange: (open: boolean) => void
}): ReactNode {
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<SigninActivityDetail | null>(null)
  const [status, setStatus] = useState<StudentSigninStatus | null>(null)
  const [signing, setSigning] = useState(false)
  const [result, setResult] = useState<{
    readonly success: boolean
    readonly rank?: number
    readonly attendanceStatus?: number
  } | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [code, setCode] = useState("")
  const codeInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !activityId || !mobileBridge.hasMobileSupport()) {
      setDetail(null)
      setStatus(null)
      setResult(null)
      setCountdown(0)
      setCode("")
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    void mobileBridge
      .getSigninContext(activityId, t("activity.signin"))
      .then(({ detail: nextDetail, status: nextStatus }) => {
        if (cancelled) return
        setDetail(nextDetail)
        setStatus(nextStatus)
        setCountdown(nextDetail.leftSeconds > 0 ? nextDetail.leftSeconds : 0)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : ""
          toast.error(message || t("activity.loadFailed"))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activityId, mobileBridge, open, t])

  useEffect(() => {
    if (countdown <= 0) return
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [countdown])

  const effectiveType = detail?.signinType && detail.signinType > 0 ? detail.signinType : signinType

  const handleSign = async (codeValue?: string): Promise<void> => {
    if (!activityId || !mobileBridge.hasMobileSupport()) return
    setSigning(true)
    try {
      const signResult = await mobileBridge.signIn({
        activityId,
        ...(codeValue ? { code: codeValue } : {}),
        requireLocation: effectiveType === 4,
      })
      if (signResult.signOrder > 0 || signResult.signStatus !== 0) {
        setResult({
          success: true,
          rank: signResult.signOrder,
          attendanceStatus: signResult.attendanceStatus,
        })
      } else {
        setResult({
          success: false,
          attendanceStatus: signResult.attendanceStatus,
        })
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error && err.message === "Location unavailable"
          ? t("activity.locationFailed")
          : err instanceof Error
            ? err.message
            : ""
      toast.error(message || t("activity.signinFailed"))
    } finally {
      setSigning(false)
    }
  }

  const handleCodeChange = (value: string): void => {
    const digits = value.replace(/\D/g, "").slice(0, 4)
    setCode(digits)
    if (digits.length === 4) {
      void handleSign(digits)
    }
  }

  const formatSeconds = (seconds: number): string => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${String(s).padStart(2, "0")}`
  }

  const alreadySigned = Boolean(status && status.signStatus !== 0)
  const expired = Boolean(detail && detail.leftSeconds <= 0 && !alreadySigned)

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="sm:max-w-sm">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{t("activity.signinTitle")}</ResponsiveModalTitle>
          <ResponsiveModalDescription>{t("activity.signinDesc")}</ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <ResponsiveModalBody>
          {loading && (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          )}

          {!loading && result && (
            <SigninResultView
              result={result}
              t={t}
              onRetry={() => {
                setResult(null)
                setCode("")
              }}
            />
          )}

          {!loading && !result && (
            <div className="flex flex-col gap-4">
              {alreadySigned && status && (
                <div className="flex flex-col items-center gap-3 py-4">
                  <CheckCircle2 className="size-12 text-green-500" />
                  <div className="text-center">
                    <p className="text-lg font-semibold">{t("activity.alreadySigned")}</p>
                    {status.signOrder > 0 && status.signOrder !== 999999 && (
                      <p className="text-sm text-muted-foreground">
                        {t("activity.signRank", { rank: status.signOrder })}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {expired && (
                <div className="flex flex-col items-center gap-3 py-4">
                  <XCircle className="size-12 text-destructive" />
                  <p className="text-lg font-semibold">{t("activity.signinExpired")}</p>
                </div>
              )}

              {!alreadySigned && !expired && detail && (
                <>
                  {countdown > 0 && (
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                      <Timer className="size-4" />
                      <span>
                        {t("activity.countdown", {
                          time: formatSeconds(countdown),
                        })}
                      </span>
                    </div>
                  )}

                  {effectiveType === 1 && (
                    <Button
                      type="button"
                      size="lg"
                      className="w-full gap-2"
                      onClick={() => void handleSign()}
                      disabled={signing || countdown <= 0}
                    >
                      {signing ? (
                        <Spinner data-icon="inline-start" />
                      ) : (
                        <Fingerprint className="size-4" />
                      )}
                      {t("activity.signinButton")}
                    </Button>
                  )}

                  {effectiveType === 2 && (
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex gap-2">
                        {[0, 1, 2, 3].map((idx) => (
                          <div
                            key={idx}
                            className={cn(
                              "flex size-12 items-center justify-center rounded-lg border-2 text-xl font-bold transition-colors",
                              code.length > idx
                                ? "border-primary bg-primary/5 text-primary"
                                : "border-muted bg-muted/30 text-muted-foreground"
                            )}
                          >
                            {code[idx] ?? ""}
                          </div>
                        ))}
                      </div>
                      <Input
                        ref={codeInputRef}
                        name="signin-code"
                        type="tel"
                        inputMode="numeric"
                        maxLength={4}
                        value={code}
                        onChange={(event) => handleCodeChange(event.target.value)}
                        className="absolute opacity-0"
                        style={{ pointerEvents: "auto" }}
                        autoFocus
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("activity.enter4DigitCode")}
                      </p>
                    </div>
                  )}

                  {effectiveType === 3 && (
                    <div className="flex flex-col items-center gap-3">
                      <QrCode className="size-12 text-muted-foreground" />
                      <p className="text-center text-sm text-muted-foreground">
                        {t("activity.scanCodeDesc")}
                      </p>
                      <Input
                        name="signin-code"
                        placeholder={t("activity.codeInputPlaceholder")}
                        value={code}
                        onChange={(event) => setCode(event.target.value)}
                        className="text-center"
                      />
                      <Button
                        type="button"
                        className="w-full"
                        onClick={() => void handleSign(code)}
                        disabled={signing || !code}
                      >
                        {signing ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <Hash className="size-4" />
                        )}
                        {t("activity.signinButton")}
                      </Button>
                    </div>
                  )}

                  {effectiveType === 4 && (
                    <div className="flex flex-col items-center gap-3">
                      <MapPin className="size-12 text-primary" />
                      <p className="text-center text-sm text-muted-foreground">
                        {t("activity.locationSigninDesc")}
                      </p>
                      <Button
                        type="button"
                        size="lg"
                        className="w-full gap-2"
                        onClick={() => void handleSign()}
                        disabled={signing || countdown <= 0}
                      >
                        {signing ? (
                          <Spinner data-icon="inline-start" />
                        ) : (
                          <MapPin className="size-4" />
                        )}
                        {t("activity.locationSigninButton")}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </ResponsiveModalBody>
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
