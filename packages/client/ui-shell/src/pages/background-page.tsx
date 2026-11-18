import { useRef, type ChangeEvent } from "react"
import { toast } from "sonner"
import { ImagePlus, Trash2 } from "lucide-react"
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldGroup,
  FieldLabel,
  Slider,
  ToggleGroup,
  ToggleGroupItem,
} from "@orahako/ui-primitives"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import "../slots-declare"
import type { ShellDictionary } from "../dictionary"
import type { AppearanceStoreInstance, BackgroundStyle, CardStyle } from "../store"

const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024

export interface BackgroundPageInject {
  readonly hooks: {
    readonly backgroundUrl: ObservableSource<string | null>
  }
  readonly saveBackgroundDataUrl: (dataUrl: string) => Promise<string>
  readonly removeBackground: () => Promise<void>
}

export type BackgroundPageProps = DerivedComponentProps<
  Record<string, never>,
  ShellDictionary,
  undefined,
  AppearanceStoreInstance,
  BackgroundPageInject
>

function isBackgroundStyle(value: string): value is BackgroundStyle {
  return value === "overlay" || value === "blur-overlay"
}

function isCardStyle(value: string): value is CardStyle {
  return value === "solid" || value === "translucent" || value === "glass"
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
      } else {
        reject(new Error("Unexpected FileReader result"))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"))
    reader.readAsDataURL(file)
  })
}

export const BackgroundPage: SlotComponent<BackgroundPageProps> = (props) => {
  const { t, useStore, actions } = props
  const backgroundUrl = props.useBackgroundUrl()
  const backgroundStyle = useStore((s) => s.backgroundStyle)
  const overlayOpacity = useStore((s) => s.backgroundOverlayOpacity)
  const blurAmount = useStore((s) => s.backgroundBlurAmount)
  const cardStyle = useStore((s) => s.cardStyle)
  const cardOpacity = useStore((s) => s.cardOpacity)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (file.size > MAX_BACKGROUND_BYTES) {
      toast.error(t("background.tooLarge"))
      return
    }
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const token = await props.saveBackgroundDataUrl(dataUrl)
      actions.setBackgroundImage(token)
    } catch {
      toast.error(t("background.saveError"))
    }
  }

  const handleRemoveImage = async () => {
    await props.removeBackground()
    actions.setBackgroundImage("")
  }

  const handleReset = async () => {
    await props.removeBackground()
    actions.resetBackground()
  }

  return (
    <div className="flex flex-col gap-6" data-page="background">
      <h1 className="text-lg font-semibold">{t("background.title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("background.upload")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            {backgroundUrl ? (
              <div className="flex items-center gap-4">
                <div
                  className="size-20 rounded-lg border bg-cover bg-center"
                  style={{ backgroundImage: `url(${backgroundUrl})` }}
                />
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <ImagePlus data-icon="inline-start" />
                    {t("background.select")}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={handleRemoveImage}>
                    <Trash2 data-icon="inline-start" />
                    {t("background.remove")}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 transition-colors hover:bg-muted"
              >
                <ImagePlus className="size-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{t("background.select")}</span>
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("background.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-6">
            <Field>
              <FieldLabel>{t("background.style")}</FieldLabel>
              <ToggleGroup
                type="single"
                value={backgroundStyle}
                onValueChange={(value) => {
                  if (isBackgroundStyle(value)) {
                    actions.setBackgroundStyle(value)
                  }
                }}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="overlay">{t("background.styleOverlay")}</ToggleGroupItem>
                <ToggleGroupItem value="blur-overlay">
                  {t("background.styleBlurOverlay")}
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>{t("background.overlayOpacity")}</FieldLabel>
                <span className="text-sm text-muted-foreground">{overlayOpacity}%</span>
              </div>
              <Slider
                value={[overlayOpacity]}
                onValueChange={(values) => actions.setBackgroundOverlayOpacity(values[0] ?? 75)}
                min={0}
                max={100}
                step={1}
              />
            </Field>

            {backgroundStyle === "blur-overlay" && (
              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel>{t("background.blurAmount")}</FieldLabel>
                  <span className="text-sm text-muted-foreground">{blurAmount}px</span>
                </div>
                <Slider
                  value={[blurAmount]}
                  onValueChange={(values) => actions.setBackgroundBlurAmount(values[0] ?? 20)}
                  min={1}
                  max={50}
                  step={1}
                />
              </Field>
            )}

            <Field>
              <FieldLabel>{t("background.cardStyle")}</FieldLabel>
              <ToggleGroup
                type="single"
                value={cardStyle}
                onValueChange={(value) => {
                  if (isCardStyle(value)) {
                    actions.setCardStyle(value)
                  }
                }}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="solid">{t("background.cardStyleSolid")}</ToggleGroupItem>
                <ToggleGroupItem value="translucent">
                  {t("background.cardStyleTranslucent")}
                </ToggleGroupItem>
                <ToggleGroupItem value="glass">{t("background.cardStyleGlass")}</ToggleGroupItem>
              </ToggleGroup>
            </Field>

            {cardStyle !== "solid" && (
              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel>{t("background.cardOpacity")}</FieldLabel>
                  <span className="text-sm text-muted-foreground">{cardOpacity}%</span>
                </div>
                <Slider
                  value={[cardOpacity]}
                  onValueChange={(values) => actions.setCardOpacity(values[0] ?? 100)}
                  min={50}
                  max={100}
                  step={1}
                />
              </Field>
            )}
          </FieldGroup>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={handleReset}>
          <Trash2 data-icon="inline-start" />
          {t("background.reset")}
        </Button>
      </div>
    </div>
  )
}
