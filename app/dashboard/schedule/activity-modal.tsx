"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/responsive-modal"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useProvider } from "@/providers/use-provider"
import type { Course, CurrentLesson, LessonActivity } from "@/providers/types"
import { Signpost, Clock } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  course: Course | null
  week: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onSigninActivity?: (activityId: string, signinType: number) => void
}

function SigninStatusBadge({ isEnd }: { isEnd: boolean }) {
  const { t } = useTranslation()
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

function formatDateTime(iso: string | null): string {
  if (!iso) return ""
  try {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  } catch {
    return iso
  }
}

export function ActivityModal({ course, week, open, onOpenChange, onSigninActivity }: Props) {
  const { t } = useTranslation()
  const provider = useProvider()
  const [loading, setLoading] = useState(false)
  const [lesson, setLesson] = useState<CurrentLesson | null>(null)

  useEffect(() => {
    if (!open || !course) {
      setLesson(null)
      return
    }

    const c = course
    async function load() {
      const classType = c.classType || "1"
      const teachClassId = classType === "1" ? c.classId : c.syxzdm
      if (!teachClassId || !c?.scheduleId || !provider.mobile) {
        toast.error(t("activity.errorNoCourseInfo"))
        return
      }
      setLoading(true)
      try {
        const result = await provider.mobile.getCurrentLesson({
          teachClassId,
          teachClassType: classType,
          scheduleId: c.scheduleId,
          week,
          weekDay: c.weekDay,
          startNode: c.startSection,
          endNode: c.endSection,
        })
        setLesson(result)
      } catch (err) {
        toast.error((err as Error).message || t("activity.loadFailed"))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [open, course, week, provider.mobile, t])

  const signinActivities = lesson?.activityList.filter((a) => a.signClazz === "1") ?? []
  const signoutActivities = lesson?.activityList.filter((a) => a.signClazz === "2") ?? []

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="sm:max-w-md">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>{course?.name || t("activity.title")}</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            {course
              ? [course.teacher, course.classroom, course.weeks || null].filter(Boolean).join(" · ")
              : ""}
          </ResponsiveModalDescription>
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
        <ResponsiveModalBody>
          {loading && (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          )}

          {!loading && lesson === null && (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Signpost className="size-8 opacity-40" />
              <span>{t("activity.noData")}</span>
            </div>
          )}

          {!loading && lesson !== null && (
            <div className="flex flex-col gap-4">
              {signinActivities.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-semibold">{t("activity.signinSection")}</h4>
                  {signinActivities.map((activity) => (
                    <ActivityItem
                      key={activity.activityId}
                      activity={activity}
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
                    <ActivityItem
                      key={activity.activityId}
                      activity={activity}
                      onSignin={onSigninActivity}
                    />
                  ))}
                </div>
              )}

              {lesson.activityList.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
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

function ActivityItem({
  activity,
  onSignin,
}: {
  activity: LessonActivity
  onSignin?: (activityId: string, signinType: number) => void
}) {
  const { t } = useTranslation()
  const isSignin = activity.signClazz === "1"
  const label = isSignin ? t("activity.signinItem") : t("activity.signoutItem")
  const canJoin = !activity.isEnd

  return (
    <button
      type="button"
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
            {formatDateTime(activity.createTime)}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <SigninStatusBadge isEnd={activity.isEnd} />
      </div>
    </button>
  )
}
