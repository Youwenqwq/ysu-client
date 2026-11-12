"use client"

import type { ReactNode } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useSettingsStore } from "@/lib/stores/settings"
import { useStoredMediaUrl } from "@/lib/storage/media"
import { loadAvatarImage } from "@/lib/storage/avatar"
import { useTranslation } from "@/lib/i18n/use-translation"
import { useStudentInfo } from "@/providers/hooks"
import { QueryState } from "./query-state"

export function ProfileWidget({ compact, children }: { compact: boolean; children?: ReactNode }) {
  const { t } = useTranslation()
  const student = useStudentInfo()
  const avatarImage = useSettingsStore((s) => s.avatarImage)
  const avatarUrl = useStoredMediaUrl(avatarImage, loadAvatarImage)
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3">
        <Avatar className="size-12 shrink-0">
          {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
          <AvatarFallback>{student.data?.name?.slice(-2) || "--"}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <CardTitle>{student.data?.name || t("app.studentInfo")}</CardTitle>
          <CardDescription className="truncate">
            {compact ? student.data?.department : student.data?.studentId}
          </CardDescription>
        </div>
      </CardHeader>
      {(!compact || !student.data) && (
        <CardContent>
          <QueryState queries={[student]} compact={compact}>
            <p className="text-sm text-muted-foreground">
              {[student.data?.department, student.data?.major].filter(Boolean).join(" · ")}
            </p>
          </QueryState>
        </CardContent>
      )}
      {children}
    </Card>
  )
}
