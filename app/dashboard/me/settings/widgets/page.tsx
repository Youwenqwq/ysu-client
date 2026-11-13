"use client"

import { useEffect, useState } from "react"
import { LayoutGrid } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { useTranslation } from "@/lib/i18n/use-translation"
import { isCapacitor } from "@/lib/native/platform"
import { PluginSlot } from "@orahako/plugin-sdk"

export default function WidgetSettingsPage() {
  const { t } = useTranslation()
  const [native, setNative] = useState<boolean | null>(null)

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
        <PluginSlot
          name="settings.widgets"
          fallback={
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <LayoutGrid />
                </EmptyMedia>
                <EmptyTitle>{t("app.featureUnavailable")}</EmptyTitle>
                <EmptyDescription>{t("app.featureUnavailableDesc")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          }
        />
      </section>

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
