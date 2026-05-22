"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useSettingsStore } from "@/lib/settings-store";
import { useTranslation } from "@/lib/i18n/use-translation";
import { saveAvatarImage, removeAvatarImage } from "@/lib/avatar-storage";
import { ImagePlus, Trash2 } from "lucide-react";
import { useAuthStore } from "@/lib/auth-store";

export default function AvatarSettingsPage() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const username = useAuthStore((s) => s.username);

  const avatarImage = useSettingsStore((s) => s.avatarImage);
  const setAvatarImage = useSettingsStore((s) => s.setAvatarImage);

  const [uploading, setUploading] = useState(false);

  const initials = (username || "U").slice(-2);

  function handleSelectImage() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("app.avatarImageTooLarge"));
      e.target.value = "";
      return;
    }

    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const storedUrl = await saveAvatarImage(reader.result as string);
        setAvatarImage(storedUrl);
        toast.success(t("app.avatarSaveSuccess"));
      } catch {
        toast.error(t("app.networkError"));
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => {
      toast.error(t("app.networkError"));
      setUploading(false);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function handleRemoveImage() {
    await removeAvatarImage();
    setAvatarImage("");
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">{t("app.avatarSettings")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("app.avatarPreview")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-6">
            <Avatar className="size-24">
              {avatarImage ? <AvatarImage src={avatarImage} alt="avatar" /> : null}
              <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
            </Avatar>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectImage}
                disabled={uploading}
              >
                <ImagePlus data-icon="inline-start" />
                {avatarImage ? t("app.avatarReplace") : t("app.avatarSelect")}
              </Button>
              {avatarImage && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveImage}
                  disabled={uploading}
                >
                  <Trash2 data-icon="inline-start" />
                  {t("app.avatarRemove")}
                </Button>
              )}
            </div>

            <p className="text-center text-xs text-muted-foreground">
              {t("app.avatarCropHint")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
