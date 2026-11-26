import { useRef, useState, type ChangeEvent } from "react"
import { toast } from "sonner"
import { ImagePlus, Trash2 } from "lucide-react"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@orahako/ui-primitives"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import "../slots-declare"
import type { ProfileDictionary } from "../dictionary"
import type { ProfileStoreInstance } from "../store"

const MAX_AVATAR_BYTES = 10 * 1024 * 1024

export interface AvatarPageInject {
  readonly hooks: {
    readonly avatarUrl: ObservableSource<string | null>
  }
  readonly saveAvatarDataUrl: (dataUrl: string) => Promise<string>
  readonly removeAvatar: () => Promise<void>
}

export type AvatarPageProps = DerivedComponentProps<
  Record<string, never>,
  ProfileDictionary,
  undefined,
  ProfileStoreInstance,
  AvatarPageInject
>

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

export const AvatarPage: SlotComponent<AvatarPageProps> = (props) => {
  const { t, useStore, actions } = props
  const avatarUrl = props.useAvatarUrl()
  const avatarToken = useStore((s) => s.avatarToken)
  const displayName = useStore((s) => s.displayName)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const initials = (displayName || "U").slice(-2)
  const hasAvatar = Boolean(avatarToken || avatarUrl)

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(t("avatar.tooLarge"))
      return
    }
    setUploading(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const storedToken = await props.saveAvatarDataUrl(dataUrl)
      actions.setAvatarToken(storedToken)
      toast.success(t("avatar.saveSuccess"))
    } catch {
      toast.error(t("avatar.saveError"))
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = async () => {
    setUploading(true)
    try {
      await props.removeAvatar()
      actions.setAvatarToken("")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6" data-page="avatar">
      <h1 className="text-lg font-semibold">{t("avatar.title")}</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("avatar.preview")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-6">
            <Avatar className="size-24">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt="avatar" /> : null}
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
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <ImagePlus data-icon="inline-start" />
                {hasAvatar ? t("avatar.replace") : t("avatar.select")}
              </Button>
              {hasAvatar && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRemove}
                  disabled={uploading}
                >
                  <Trash2 data-icon="inline-start" />
                  {t("avatar.remove")}
                </Button>
              )}
            </div>

            <p className="text-center text-xs text-muted-foreground">{t("avatar.cropHint")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
