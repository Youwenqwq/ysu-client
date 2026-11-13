"use client"

import { useState } from "react"
import Image from "next/image"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  ToggleGroupItem,
} from "@orahako/plugin-ui/components"
import { useTranslation } from "@orahako/plugin-ui/hooks"
import { examCompactWidgetPreview, examWidgetPreview } from "@orahako/plugin-ui/assets"
import { requestWidgetPin, type NativeWidgetId } from "@orahako/plugin-ui/platform"

/** Settings contribution into "settings.notificationContent". */
export function ExamNotificationContent() {
  const { t } = useTranslation()

  return (
    <ToggleGroupItem value="exams" className="text-xs">
      {t("settings.notifyExams")}
    </ToggleGroupItem>
  )
}

function ExamWidgetCard({
  widget,
  name,
  preview,
  size,
  compact,
}: {
  widget: NativeWidgetId
  name: string
  preview: typeof examWidgetPreview
  size: string
  compact?: boolean
}) {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)

  async function addWidget() {
    if (adding) return
    setAdding(true)
    const added = await requestWidgetPin(widget)
    setAdding(false)
    if (added) {
      toast.success(t("desktopWidgets.added"))
    } else {
      toast.info(t("desktopWidgets.unsupported"))
      document.getElementById("widget-manual-guide")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    }
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{name}</CardTitle>
        <CardAction>
          <Badge variant="secondary">{size}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="mx-4 flex flex-1 items-center justify-center rounded-lg bg-muted/35 p-3">
        <Image
          src={preview}
          alt={name}
          className={compact ? "h-auto w-48 max-w-full rounded-lg" : "h-auto w-full rounded-lg"}
        />
      </CardContent>
      <CardFooter>
        <Button type="button" className="w-full" disabled={adding} onClick={() => void addWidget()}>
          <Plus data-icon="inline-start" />
          {adding ? t("desktopWidgets.adding") : t("desktopWidgets.add")}
        </Button>
      </CardFooter>
    </Card>
  )
}

/** Settings contribution into "settings.widgets". */
export function ExamSettingsWidget() {
  const { t } = useTranslation()
  return (
    <ExamWidgetCard
      widget="exam"
      name={t("desktopWidgets.examName")}
      preview={examWidgetPreview}
      size="4×2"
    />
  )
}

/** Settings contribution into "settings.widgets". */
export function ExamCompactSettingsWidget() {
  const { t } = useTranslation()
  return (
    <ExamWidgetCard
      widget="exam-compact"
      name={t("desktopWidgets.examCompactName")}
      preview={examCompactWidgetPreview}
      size="2×2"
      compact
    />
  )
}
