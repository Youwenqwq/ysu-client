import type { MouseEvent } from "react"
import { Info } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@orahako/ui-primitives"
import type { DerivedComponentProps, ObservableSource, SlotComponent } from "@orahako/sdk"
import "./slots-declare"
import type { ProfileDictionary } from "./dictionary"
import type { ProfileStoreInstance } from "./store"

export interface SidebarFooterInject {
  readonly hooks: {
    readonly avatarUrl: ObservableSource<string | null>
  }
  readonly appVersion: string
  readonly appBuild: string
  readonly meHref: string
  readonly navigateToMe: () => void
  readonly aboutHref: string
  readonly navigateToAbout: () => void
}

export type SidebarProfileFooterProps = DerivedComponentProps<
  Record<string, never>,
  ProfileDictionary,
  undefined,
  ProfileStoreInstance,
  SidebarFooterInject
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

export const SidebarProfileFooter: SlotComponent<SidebarProfileFooterProps> = (props) => {
  const { t, useStore } = props
  const avatarUrl = props.useAvatarUrl()
  const customDisplayName = useStore((s) => s.displayName)
  const displayName = customDisplayName || t("sidebar.profile")
  const initials = (customDisplayName || "U").slice(-2)

  return (
    <div className="flex flex-col gap-1" data-sidebar-profile-footer="">
      <a
        href={props.meHref}
        onClick={(event) => handleSpaClick(event, props.navigateToMe)}
        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Avatar className="size-7 shrink-0">
          {avatarUrl && <AvatarImage src={avatarUrl} alt="avatar" />}
          <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
        </Avatar>
        <span className="truncate font-medium group-data-[collapsible=icon]:hidden">
          {displayName}
        </span>
      </a>
      <a
        href={props.aboutHref}
        onClick={(event) => handleSpaClick(event, props.navigateToAbout)}
        aria-label={t("sidebar.about")}
        className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Info className="size-3.5 shrink-0" />
        <span className="group-data-[collapsible=icon]:hidden">
          v{props.appVersion} ({props.appBuild})
        </span>
      </a>
    </div>
  )
}
