"use client"

import type { ReactNode } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ysu/plugin-ui/components"
import { Avatar, AvatarFallback, AvatarImage } from "@ysu/plugin-ui/components"
import { useSettingsStore } from "@ysu/plugin-ui/stores"
import { useStoredMediaUrl } from "@ysu/plugin-ui/hooks"
import { loadAvatarImage } from "@ysu/plugin-ui/stores"
import { useTranslation } from "@ysu/plugin-ui/hooks"
import { useStudentInfo } from "@ysu/plugin-ui/hooks"
import { QueryState } from "@ysu/academic"

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
