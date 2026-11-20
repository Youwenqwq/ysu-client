import { useState, type ReactNode } from "react"
import { Plus } from "lucide-react"
import { toast } from "sonner"
import { hasSlice, type ProviderRuntimeSnapshot } from "@orahako/academic-sdk"
import type {
  DerivedComponentProps,
  ObservableSource,
  SlotComponent,
  Translator,
} from "@orahako/sdk"
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
} from "@orahako/ui-primitives"
import type { ExamsDictionary } from "./dictionary"
import "./slots"
import type { ExamsSettingsStoreInstance } from "./store"
import type { ExamWidgetId } from "./widget-sync"

export interface ExamNotificationContentInject {
  readonly hooks: {
    readonly provider: ObservableSource<ProviderRuntimeSnapshot>
  }
}

export type ExamNotificationContentProps = DerivedComponentProps<
  Record<string, never>,
  ExamsDictionary,
  undefined,
  ExamsSettingsStoreInstance,
  ExamNotificationContentInject
>

export const ExamNotificationContent: SlotComponent<ExamNotificationContentProps> = (props) => {
  const providerSnap = props.useProvider()
  const notifyExams = props.useStore((s) => s.notifyExams)

  if (!hasSlice(providerSnap.provider, "exams") || !notifyExams) {
    return null
  }

  return (
    <ToggleGroupItem value="exams" className="text-xs">
      {props.t("settings.notifyExams")}
    </ToggleGroupItem>
  )
}

export interface ExamWidgetPinInject {
  readonly previewSrc: string
  readonly requestPin: (widget: ExamWidgetId) => Promise<boolean>
}

export type ExamWidgetPinProps = DerivedComponentProps<
  Record<string, never>,
  ExamsDictionary,
  undefined,
  undefined,
  ExamWidgetPinInject
>

function ExamWidgetPinCard({
  widget,
  name,
  previewSrc,
  size,
  compact = false,
  requestPin,
  t,
}: {
  readonly widget: ExamWidgetId
  readonly name: string
  readonly previewSrc: string
  readonly size: string
  readonly compact?: boolean
  readonly requestPin: (widget: ExamWidgetId) => Promise<boolean>
  readonly t: Translator<ExamsDictionary>
}): ReactNode {
  const [adding, setAdding] = useState(false)

  async function handleAddWidget(): Promise<void> {
    if (adding) return
    setAdding(true)
    try {
      const added = await requestPin(widget)
      if (added) {
        toast.success(t("desktopWidgets.added"))
      } else {
        toast.info(t("desktopWidgets.unsupported"))
        if (typeof document !== "undefined" && typeof document.getElementById === "function") {
          document.getElementById("widget-manual-guide")?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          })
        }
      }
    } finally {
      setAdding(false)
    }
  }

  return (
    <Card data-exam-widget-card={widget} className="h-full">
      <CardHeader>
        <CardTitle>{name}</CardTitle>
        <CardAction>
          <Badge variant="secondary">{size}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="mx-4 flex flex-1 items-center justify-center rounded-lg bg-muted/35 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewSrc}
          alt={name}
          className={compact ? "h-auto w-48 max-w-full rounded-lg" : "h-auto w-full rounded-lg"}
        />
      </CardContent>
      <CardFooter>
        <Button
          type="button"
          className="w-full"
          disabled={adding}
          onClick={() => void handleAddWidget()}
        >
          <Plus data-icon="inline-start" />
          {adding ? t("desktopWidgets.adding") : t("desktopWidgets.add")}
        </Button>
      </CardFooter>
    </Card>
  )
}

export const ExamSettingsWidget: SlotComponent<ExamWidgetPinProps> = (props) => (
  <ExamWidgetPinCard
    widget="exam"
    name={props.t("desktopWidgets.examName")}
    previewSrc={props.previewSrc}
    size="4×2"
    requestPin={props.requestPin}
    t={props.t}
  />
)

export const ExamCompactSettingsWidget: SlotComponent<ExamWidgetPinProps> = (props) => (
  <ExamWidgetPinCard
    widget="exam-compact"
    name={props.t("desktopWidgets.examCompactName")}
    previewSrc={props.previewSrc}
    size="2×2"
    compact
    requestPin={props.requestPin}
    t={props.t}
  />
)
