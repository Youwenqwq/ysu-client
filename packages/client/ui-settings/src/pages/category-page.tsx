import type { MouseEvent } from "react"
import { ChevronLeft, Puzzle } from "lucide-react"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@orahako/ui-primitives"
import type {
  DerivedComponentProps,
  ObservableSource,
  PluginLocale,
  PluginSettingsCategory,
  RouteLocation,
  SlotComponent,
} from "@orahako/sdk"
import "../slots-declare"
import type { SettingsDictionary } from "../dictionary"

export const categoryPageChildren = {
  "settings.category.panel": { kind: "keyed" },
} as const

export interface CategoryPageInject {
  readonly hooks: {
    readonly location: ObservableSource<RouteLocation>
    readonly categories: ObservableSource<readonly PluginSettingsCategory[]>
  }
  readonly settingsHref: string
  readonly navigateToSettings: () => void
  readonly resolveCategoryTitle: (category: PluginSettingsCategory, locale: PluginLocale) => string
  readonly resolveCategoryDescription: (
    category: PluginSettingsCategory,
    locale: PluginLocale
  ) => string
}

export type CategoryPageProps = DerivedComponentProps<
  Record<string, never>,
  SettingsDictionary,
  typeof categoryPageChildren,
  undefined,
  CategoryPageInject
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

function UnavailableCategoryView({
  title,
  description,
  backLabel,
  settingsHref,
  onBack,
}: {
  readonly title: string
  readonly description: string
  readonly backLabel: string
  readonly settingsHref: string
  readonly onBack: () => void
}) {
  return (
    <Empty className="min-h-64" data-category-unavailable="">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Puzzle />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <a
          href={settingsHref}
          onClick={(event) => handleSpaClick(event, onBack)}
          className="text-sm text-primary hover:underline"
        >
          {backLabel}
        </a>
      </EmptyContent>
    </Empty>
  )
}

export const CategoryPage: SlotComponent<CategoryPageProps> = (props) => {
  const { t, locale, renderSlot } = props
  const location = props.useLocation()
  const categories = props.useCategories()
  const categoryId = location.params.category
  const category = categoryId ? categories.find((item) => item.id === categoryId) : undefined

  const unavailableFallback = (
    <UnavailableCategoryView
      title={t("categoryUnavailable")}
      description={t("categoryUnavailableDesc")}
      backLabel={t("backToSettings")}
      settingsHref={props.settingsHref}
      onBack={props.navigateToSettings}
    />
  )

  if (!categoryId || !category) {
    return unavailableFallback
  }

  const Icon = category.icon
  const title = props.resolveCategoryTitle(category, locale)
  const description = props.resolveCategoryDescription(category, locale)

  return (
    <div className="flex flex-col gap-6" data-page="settings-category" data-category={category.id}>
      <div className="flex items-start gap-2">
        <a
          href={props.settingsHref}
          aria-label={t("backToSettings")}
          onClick={(event) => handleSpaClick(event, props.navigateToSettings)}
          className="mt-0.5 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-5" />
        </a>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{title}</h1>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
        </div>
      </div>

      {renderSlot(
        "settings.category.panel",
        {},
        { key: category.id, fallback: unavailableFallback }
      )}
    </div>
  )
}
