"use client"

import { useEffect, useState } from "react"
import Image from "next/image"
import { LayoutGrid, Plus } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Switch } from "@/components/ui/switch"
import buroImage from "@/public/widgets/buro.png"
import schedulePreview from "@/public/widgets/schedule.png"
import examPreview from "@/public/widgets/exam.png"
import examCompactPreview from "@/public/widgets/exam-compact.png"
import { useTranslation } from "@/lib/i18n/use-translation"
import { isCapacitor } from "@/lib/native/platform"
import { requestWidgetPin, type NativeWidgetId } from "@/lib/native/widget-bridge"
import { useSettingsStore } from "@/lib/stores/settings"

export default function WidgetSettingsPage() {
  const { t } = useTranslation()
  const assistantHidden = useSettingsStore((s) => s.widgetAssistantHidden)
  const setAssistantHidden = useSettingsStore((s) => s.setWidgetAssistantHidden)
  const [native, setNative] = useState<boolean | null>(null)
  const [adding, setAdding] = useState<NativeWidgetId | null>(null)

  useEffect(() => {
    setNative(isCapacitor())
  }, [])

  useEffect(() => {
    if (!native || window.location.hash !== "#widget-manual-guide") return
    const frame = requestAnimationFrame(() => {
      document.getElementById("widget-manual-guide")?.scrollIntoView({ block: "start" })
    })
    return () => cancelAnimationFrame(frame)
  }, [native])

  if (native === null) return null

  if (!native) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutGrid />
          </EmptyMedia>
          <EmptyTitle>{t("desktopWidgets.title")}</EmptyTitle>
          <EmptyDescription>{t("desktopWidgets.nativeOnly")}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const widgets = [
    {
      id: "schedule" as const,
      name: t("desktopWidgets.scheduleName"),
      preview: schedulePreview,
      size: "4×2",
    },
    {
      id: "tomorrow" as const,
      name: t("desktopWidgets.tomorrowName"),
      preview: schedulePreview,
      size: "4×2",
    },
    {
      id: "exam" as const,
      name: t("desktopWidgets.examName"),
      preview: examPreview,
      size: "4×2",
    },
    {
      id: "exam-compact" as const,
      name: t("desktopWidgets.examCompactName"),
      preview: examCompactPreview,
      size: "2×2",
    },
  ]

  async function addWidget(widget: NativeWidgetId) {
    if (adding) return
    setAdding(widget)
    const added = await requestWidgetPin(widget)
    setAdding(null)
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

  const manualSteps = [
    t("desktopWidgets.manualStep1"),
    t("desktopWidgets.manualStep2"),
    t("desktopWidgets.manualStep3"),
    t("desktopWidgets.manualStep4"),
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{t("desktopWidgets.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("desktopWidgets.description")}</p>
      </div>

      <section className="grid gap-4 lg:grid-cols-2" aria-label={t("desktopWidgets.title")}>
        {widgets.map((widget) => (
          <Card key={widget.id} className="h-full">
            <CardHeader>
              <CardTitle>{widget.name}</CardTitle>
              <CardAction>
                <Badge variant="secondary">{widget.size}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="mx-4 flex flex-1 items-center justify-center rounded-lg bg-muted/35 p-3">
              <Image
                src={widget.preview}
                alt={widget.name}
                className={
                  widget.id === "exam-compact"
                    ? "h-auto w-48 max-w-full rounded-lg"
                    : "h-auto w-full rounded-lg"
                }
              />
            </CardContent>
            <CardFooter>
              <Button
                type="button"
                className="w-full"
                disabled={adding !== null}
                onClick={() => addWidget(widget.id)}
              >
                <Plus data-icon="inline-start" />
                {adding === widget.id ? t("desktopWidgets.adding") : t("desktopWidgets.add")}
              </Button>
            </CardFooter>
          </Card>
        ))}
      </section>

      <Card>
        <CardContent className="flex items-center gap-3 py-1">
          <Image src={buroImage} alt="" className="size-11 shrink-0 object-contain" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium">{t("desktopWidgets.assistantToggle")}</span>
            <span className="text-xs text-muted-foreground">
              {t("desktopWidgets.assistantToggleDesc")}
            </span>
          </div>
          <Switch
            aria-label={t("desktopWidgets.assistantToggle")}
            checked={!assistantHidden}
            onCheckedChange={(visible) => setAssistantHidden(!visible)}
          />
        </CardContent>
      </Card>

      <Card id="widget-manual-guide" className="scroll-mt-20">
        <CardHeader>
          <CardTitle>{t("desktopWidgets.manualTitle")}</CardTitle>
          <CardDescription>{t("desktopWidgets.manualDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ol className="grid gap-4 md:grid-cols-2">
            {manualSteps.map((step, index) => (
              <li key={step} className="flex items-start gap-3 text-sm leading-6">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="flex flex-col gap-1 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
            <p>{t("desktopWidgets.resizeNote")}</p>
            <p>{t("desktopWidgets.syncNote")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
