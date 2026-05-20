"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { useSettingsStore, type CardStyle, type BackgroundStyle } from "@/lib/settings-store";
import { useTranslation } from "@/lib/i18n/use-translation";
import { ImagePlus, Trash2 } from "lucide-react";

export default function BackgroundSettingsPage() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const backgroundImage = useSettingsStore((s) => s.backgroundImage);
  const setBackgroundImage = useSettingsStore((s) => s.setBackgroundImage);
  const overlayOpacity = useSettingsStore((s) => s.backgroundOverlayOpacity);
  const setOverlayOpacity = useSettingsStore((s) => s.setBackgroundOverlayOpacity);
  const backgroundStyle = useSettingsStore((s) => s.backgroundStyle);
  const setBackgroundStyle = useSettingsStore((s) => s.setBackgroundStyle);
  const backgroundBlurAmount = useSettingsStore((s) => s.backgroundBlurAmount);
  const setBackgroundBlurAmount = useSettingsStore((s) => s.setBackgroundBlurAmount);
  const cardStyle = useSettingsStore((s) => s.cardStyle);
  const setCardStyle = useSettingsStore((s) => s.setCardStyle);
  const cardOpacity = useSettingsStore((s) => s.cardOpacity);
  const setCardOpacity = useSettingsStore((s) => s.setCardOpacity);

  const [localOverlay, setLocalOverlay] = useState(overlayOpacity);
  const [localBackgroundStyle, setLocalBackgroundStyle] = useState<BackgroundStyle>(backgroundStyle);
  const [localBlurAmount, setLocalBlurAmount] = useState(backgroundBlurAmount);
  const [localCardStyle, setLocalCardStyle] = useState<CardStyle>(cardStyle);
  const [localCardOpacity, setLocalCardOpacity] = useState(cardOpacity);

  function handleSelectImage() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("app.backgroundImageTooLarge"));
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setBackgroundImage(reader.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleRemoveImage() {
    setBackgroundImage("");
  }

  function handleOverlayChange(values: number[]) {
    const v = values[0] ?? 75;
    setLocalOverlay(v);
    setOverlayOpacity(v);
  }

  function handleBackgroundStyleChange(v: string) {
    const style = v as BackgroundStyle;
    setLocalBackgroundStyle(style);
    setBackgroundStyle(style);
  }

  function handleBlurAmountChange(values: number[]) {
    const v = values[0] ?? 20;
    setLocalBlurAmount(v);
    setBackgroundBlurAmount(v);
  }

  function handleCardStyleChange(v: string) {
    const style = v as CardStyle;
    setLocalCardStyle(style);
    setCardStyle(style);
  }

  function handleCardOpacityChange(values: number[]) {
    const v = values[0] ?? 100;
    setLocalCardOpacity(v);
    setCardOpacity(v);
  }

  function handleReset() {
    setBackgroundImage("");
    setOverlayOpacity(75);
    setBackgroundStyle("overlay");
    setBackgroundBlurAmount(20);
    setCardStyle("solid");
    setCardOpacity(100);
    setLocalOverlay(75);
    setLocalBackgroundStyle("overlay");
    setLocalBlurAmount(20);
    setLocalCardStyle("solid");
    setLocalCardOpacity(100);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">{t("app.backgroundSettings")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("app.backgroundUpload")}</CardTitle>
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
            {backgroundImage ? (
              <div className="flex items-center gap-4">
                <div
                  className="size-20 rounded-lg border bg-cover bg-center"
                  style={{ backgroundImage: `url(${backgroundImage})` }}
                />
                <div className="flex flex-col gap-2">
                  <Button variant="outline" size="sm" onClick={handleSelectImage}>
                    <ImagePlus data-icon="inline-start" />
                    {t("app.backgroundImageSelect")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleRemoveImage}>
                    <Trash2 data-icon="inline-start" />
                    {t("app.backgroundImageRemove")}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleSelectImage}
                className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 transition-colors hover:bg-muted"
              >
                <ImagePlus className="size-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  {t("app.backgroundImageSelect")}
                </span>
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("app.backgroundSettings")}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-6">
            <Field>
              <FieldLabel>{t("app.backgroundStyle")}</FieldLabel>
              <ToggleGroup
                type="single"
                value={localBackgroundStyle}
                onValueChange={handleBackgroundStyleChange}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="overlay">
                  {t("app.backgroundStyleOverlay")}
                </ToggleGroupItem>
                <ToggleGroupItem value="blur-overlay">
                  {t("app.backgroundStyleBlurOverlay")}
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>{t("app.backgroundOverlayOpacity")}</FieldLabel>
                <span className="text-sm text-muted-foreground">{localOverlay}%</span>
              </div>
              <Slider
                value={[localOverlay]}
                onValueChange={handleOverlayChange}
                min={0}
                max={100}
                step={1}
              />
            </Field>

            {localBackgroundStyle === "blur-overlay" && (
              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel>{t("app.backgroundBlurAmount")}</FieldLabel>
                  <span className="text-sm text-muted-foreground">{localBlurAmount}px</span>
                </div>
                <Slider
                  value={[localBlurAmount]}
                  onValueChange={handleBlurAmountChange}
                  min={1}
                  max={50}
                  step={1}
                />
              </Field>
            )}

            <Field>
              <FieldLabel>{t("app.cardStyle")}</FieldLabel>
              <ToggleGroup
                type="single"
                value={localCardStyle}
                onValueChange={handleCardStyleChange}
                variant="outline"
                size="sm"
              >
                <ToggleGroupItem value="solid">
                  {t("app.cardStyleSolid")}
                </ToggleGroupItem>
                <ToggleGroupItem value="translucent">
                  {t("app.cardStyleTranslucent")}
                </ToggleGroupItem>
                <ToggleGroupItem value="glass">
                  {t("app.cardStyleGlass")}
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>

            {localCardStyle !== "solid" && (
              <Field>
                <div className="flex items-center justify-between">
                  <FieldLabel>{t("app.backgroundCardOpacity")}</FieldLabel>
                  <span className="text-sm text-muted-foreground">{localCardOpacity}%</span>
                </div>
                <Slider
                  value={[localCardOpacity]}
                  onValueChange={handleCardOpacityChange}
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
        <Button variant="outline" onClick={handleReset}>
          <Trash2 data-icon="inline-start" />
          {t("app.backgroundReset")}
        </Button>
      </div>
    </div>
  );
}
