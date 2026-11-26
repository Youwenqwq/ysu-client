import type { MouseEvent } from "react"
import { ChevronRight, UserCircle } from "lucide-react"
import type { DerivedComponentProps, SlotComponent } from "@orahako/sdk"
import "./slots-declare"
import type { ProfileDictionary } from "./dictionary"

export interface AppearanceAvatarRowInject {
  readonly avatarHref: string
  readonly navigateToAvatar: () => void
}

export type AppearanceAvatarRowProps = DerivedComponentProps<
  Record<string, never>,
  ProfileDictionary,
  undefined,
  undefined,
  AppearanceAvatarRowInject
>

function handleSpaClick(event: MouseEvent<HTMLAnchorElement>, navigate: () => void): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return
  }
  event.preventDefault()
  navigate()
}

export const AppearanceAvatarRow: SlotComponent<AppearanceAvatarRowProps> = (props) => {
  const { t } = props
  return (
    <a
      href={props.avatarHref}
      onClick={(event) => handleSpaClick(event, props.navigateToAvatar)}
      className="flex items-center gap-3 py-3 transition-colors active:bg-muted/60"
      data-settings-avatar-link=""
    >
      <UserCircle className="size-5 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-sm">{t("avatar.title")}</span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </a>
  )
}
