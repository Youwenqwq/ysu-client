import type { MouseEvent, ReactNode } from "react"
import { ChevronRight, Puzzle, Settings } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage, Card, CardContent, cn } from "@orahako/ui-primitives"
import type {
  DerivedComponentProps,
  ObservableSource,
  PluginIcon,
  PluginLocale,
  SlotComponent,
} from "@orahako/sdk"
import "../slots-declare"
import type { ProfileDictionary } from "../dictionary"
import type { ProfileStoreInstance } from "../store"

export const mePageChildren = {
  "profile.header": { kind: "single" },
  "profile.accountActions": { kind: "list" },
} as const

export interface ProfileNavItem {
  readonly id: string
  readonly href: string
  readonly label: string
  readonly icon: PluginIcon
  readonly onNavigate: () => void
}

export interface ProfileNavGroup {
  readonly group: string
  readonly title: string
  readonly items: readonly ProfileNavItem[]
}

export interface MePageInject {
  readonly hooks: {
    readonly avatarUrl: ObservableSource<string | null>
    readonly navRevision: ObservableSource<number>
  }
  readonly appVersion: string
  readonly appBuild: string
  readonly getFeatureGroups: (locale: PluginLocale) => readonly ProfileNavGroup[]
  readonly hasPluginsPage: () => boolean
  readonly avatarHref: string
  readonly navigateToAvatar: () => void
  readonly settingsHref: string
  readonly navigateToSettings: () => void
  readonly pluginsHref: string
  readonly navigateToPlugins: () => void
  readonly aboutHref: string
  readonly navigateToAbout: () => void
}

export type MePageProps = DerivedComponentProps<
  Record<string, never>,
  ProfileDictionary,
  typeof mePageChildren,
  ProfileStoreInstance,
  MePageInject
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

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      {children}
    </section>
  )
}

function LinkCard({ items }: { readonly items: readonly ProfileNavItem[] }) {
  return (
    <Card className="py-0">
      <CardContent className="flex flex-col py-1">
        {items.map((item, idx) => {
          const Icon = item.icon
          return (
            <a
              key={item.id}
              href={item.href}
              onClick={(event) => handleSpaClick(event, item.onNavigate)}
              className={cn(
                "flex items-center gap-3 py-3 transition-colors active:bg-muted/60",
                idx > 0 && "border-t border-border"
              )}
            >
              <Icon className="size-5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-sm">{item.label}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </a>
          )
        })}
      </CardContent>
    </Card>
  )
}

export const MePage: SlotComponent<MePageProps> = (props) => {
  const { t, locale, renderSlot, useStore } = props
  const avatarUrl = props.useAvatarUrl()
  const navRevision = props.useNavRevision()
  void navRevision

  const customDisplayName = useStore((s) => s.displayName)
  const displayName = customDisplayName || t("me.defaultUser")
  const initials = (customDisplayName || "U").slice(-2)

  const featureGroups = props.getFeatureGroups(locale)
  const showPluginsItem = props.hasPluginsPage()
  const accountActionsNode = renderSlot("profile.accountActions")

  const preferenceItems: ProfileNavItem[] = [
    {
      id: "settings",
      href: props.settingsHref,
      label: t("me.settings"),
      icon: Settings,
      onNavigate: props.navigateToSettings,
    },
    ...(showPluginsItem
      ? [
          {
            id: "plugins",
            href: props.pluginsHref,
            label: t("me.plugins"),
            icon: Puzzle,
            onNavigate: props.navigateToPlugins,
          },
        ]
      : []),
  ]

  const defaultHeader = (
    <a
      href={props.avatarHref}
      onClick={(event) => handleSpaClick(event, props.navigateToAvatar)}
      className="block"
      data-profile-default-header=""
    >
      <Card className="py-0 transition-colors hover:bg-muted/40 active:bg-muted/60">
        <CardContent className="flex items-center gap-4 py-5">
          <Avatar className="size-14">
            {avatarUrl && <AvatarImage src={avatarUrl} alt="avatar" />}
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-base font-semibold">{displayName}</span>
            <span className="truncate text-xs text-muted-foreground">
              {t("me.customizeAvatarDesc")}
            </span>
          </div>
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
        </CardContent>
      </Card>
    </a>
  )

  return (
    <div className="flex flex-col gap-4" data-page="me">
      {renderSlot("profile.header", {}, { fallback: defaultHeader })}

      {featureGroups.map((group) => (
        <Section key={group.group} title={group.title}>
          <LinkCard items={group.items} />
        </Section>
      ))}

      <Section title={t("me.sectionPreferences")}>
        <LinkCard items={preferenceItems} />
      </Section>

      {accountActionsNode !== null && (
        <Section title={t("me.sectionAccount")}>
          <Card className="py-0">
            <CardContent className="flex flex-col divide-y divide-border py-1">
              {accountActionsNode}
            </CardContent>
          </Card>
        </Section>
      )}

      <div className="flex items-center justify-between px-1 pt-2 text-sm">
        <a
          href={props.aboutHref}
          onClick={(event) => handleSpaClick(event, props.navigateToAbout)}
          className="relative text-primary underline underline-offset-2"
        >
          {t("about.title")}
        </a>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            v{props.appVersion} · {props.appBuild}
          </span>
        </div>
      </div>
    </div>
  )
}
