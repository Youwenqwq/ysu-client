"use client"

import { Component, Suspense, useSyncExternalStore, type ReactNode } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ChevronLeft, Puzzle } from "lucide-react"
import type { PluginSettingsCategory } from "@orahako/plugin-sdk"
import { usePluginHost } from "@/components/plugin-provider"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { useTranslation } from "@/lib/i18n/use-translation"
import { usePluginTranslation } from "@/lib/plugins/use-plugin-translation"

class PluginSettingsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    console.error("Plugin settings panel failed", error)
  }

  render() {
    if (this.state.failed) {
      return (
        <PluginSettingsMessage
          title="插件设置运行失败"
          description="该分类的设置面板暂时无法显示，请停用后重试或恢复默认界面。"
        />
      )
    }
    return this.props.children
  }
}

function PluginSettingsMessage({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="min-h-64">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Puzzle />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function ResolvedPluginSettingsCategory({ category }: { category: PluginSettingsCategory }) {
  const { t } = useTranslation()
  const { t: translatePlugin } = usePluginTranslation(category.pluginId)
  const Icon = category.icon
  const Panel = category.component
  const title = category.titleKey ? translatePlugin(category.titleKey) : category.title
  const description = category.descriptionKey
    ? translatePlugin(category.descriptionKey)
    : category.description

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-2">
        <Link
          href="/dashboard/me/settings/"
          aria-label={t("settings.backToPluginSettings")}
          className="mt-0.5 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
      </div>
      <PluginSettingsBoundary key={`${category.pluginId}:${category.id}`}>
        <Panel />
      </PluginSettingsBoundary>
    </div>
  )
}

function PluginSettingsContent() {
  const { host, isReady } = usePluginHost()
  const categories = useSyncExternalStore(
    host.settings.subscribe,
    host.settings.getSnapshot,
    host.settings.getSnapshot
  )
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const categoryId = searchParams.get("category")
  const category = categories.find((item) => item.id === categoryId)

  if (!isReady) return null
  if (!category) {
    return (
      <Empty className="min-h-64">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Puzzle />
          </EmptyMedia>
          <EmptyTitle>{t("settings.pluginCategoryUnavailable")}</EmptyTitle>
          <EmptyDescription>{t("settings.pluginCategoryUnavailableDesc")}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link href="/dashboard/me/settings/" className="text-sm text-primary hover:underline">
            {t("settings.backToPluginSettings")}
          </Link>
        </EmptyContent>
      </Empty>
    )
  }
  return <ResolvedPluginSettingsCategory category={category} />
}

export default function PluginSettingsPage() {
  return (
    <Suspense fallback={null}>
      <PluginSettingsContent />
    </Suspense>
  )
}
