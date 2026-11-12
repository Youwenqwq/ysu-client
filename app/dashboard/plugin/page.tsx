"use client"

import { Component, Suspense, useCallback, useEffect, useMemo, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Puzzle } from "lucide-react"
import { usePluginHost } from "@/components/plugin-provider"
import { usePluginUI } from "@/lib/plugins/use-plugin-ui"
import type { RegisteredPluginPage } from "@/lib/plugins/ui-registry"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { pluginPageHref, type PluginPageProps } from "@ysu/plugin-sdk"
import { usePluginRouteStore } from "@/lib/stores/plugin-route"
import { useProviderCapabilities } from "@/providers/use-provider"
import { hasPluginCapability } from "@/lib/plugins/navigation"
import { useTranslation } from "@/lib/i18n/use-translation"

class PluginPageBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return <PluginMessage title="插件页面运行失败" description={this.state.error.message} />
    }
    return this.props.children
  }
}

function PluginMessage({ title, description }: { title: string; description: string }) {
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

function PluginHostContent() {
  const { host, isReady } = usePluginHost()
  const { pages } = usePluginUI(host.ui)
  const searchParams = useSearchParams()
  const router = useRouter()
  const capabilities = useProviderCapabilities()
  const { t } = useTranslation()
  const pluginId = searchParams.get("plugin")
  const pageId = searchParams.get("page") ?? "index"
  const page = pluginId
    ? pages.find((item) => item.pluginId === pluginId && item.id === pageId)
    : undefined
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams])
  const navigate = useCallback<PluginPageProps["navigate"]>(
    (nextPage, nextParams) => {
      if (!pluginId) return
      router.push(pluginPageHref(pluginId, nextPage, nextParams))
    },
    [pluginId, router]
  )

  if (!isReady) return <PluginMessage title="正在加载插件" description="正在恢复插件与扩展页面。" />
  if (!pluginId || !page) {
    return (
      <PluginMessage
        title="插件页面不可用"
        description="插件尚未安装、已停用，或页面已在更新中移除。"
      />
    )
  }

  if (!hasPluginCapability(capabilities, page.capability)) {
    return (
      <ActivePluginRoute page={page}>
        <PluginMessage
          title={t("app.featureUnavailable")}
          description={t("app.featureUnavailableDesc")}
        />
      </ActivePluginRoute>
    )
  }

  const Page = page.component
  return (
    <PluginPageBoundary key={`${pluginId}:${pageId}`}>
      <ActivePluginRoute page={page}>
        <Page pluginId={pluginId} pageId={pageId} params={params} navigate={navigate} />
      </ActivePluginRoute>
    </PluginPageBoundary>
  )
}

function ActivePluginRoute({
  page,
  children,
}: {
  page: RegisteredPluginPage
  children: ReactNode
}) {
  const setCurrent = usePluginRouteStore((state) => state.setCurrent)
  useEffect(() => {
    setCurrent({
      pluginId: page.pluginId,
      pageId: page.id,
      title: page.title,
      titleKey: page.titleKey,
      parent: page.parent,
      primary: page.primary,
      capability: page.capability,
    })
    return () => setCurrent(undefined)
  }, [page, setCurrent])
  return children
}

export default function PluginHostPage() {
  return (
    <Suspense
      fallback={<PluginMessage title="正在加载插件" description="正在读取插件页面参数。" />}
    >
      <PluginHostContent />
    </Suspense>
  )
}
