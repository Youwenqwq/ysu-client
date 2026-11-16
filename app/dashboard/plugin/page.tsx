"use client"

import { Component, Suspense, useCallback, useEffect, useMemo, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Puzzle } from "lucide-react"
import { usePluginHost } from "@/components/plugin-provider"
import { usePluginUI } from "@/lib/plugins/use-plugin-ui"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  pluginPageHref,
  type PluginNavigationService,
  type PluginPageProps,
} from "@orahako/plugin-sdk"

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
  const pluginId = searchParams.get("plugin")
  const pageId = searchParams.get("page") ?? "index"
  const semanticRoute = searchParams.get("route")
  const navigation: PluginNavigationService | undefined = host.navigation
  const semanticTarget = semanticRoute ? navigation?.resolve(semanticRoute) : undefined
  const requested = semanticTarget
    ? { pluginId: semanticTarget.pluginId, pageId: semanticTarget.pageId }
    : pluginId
      ? { pluginId, pageId }
      : undefined
  const page = requested
    ? pages.find((item) => item.pluginId === requested.pluginId && item.id === requested.pageId)
    : undefined
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams])
  const navigate = useCallback<PluginPageProps["navigate"]>(
    (nextPage, nextParams) => {
      if (!page) return
      router.push(pluginPageHref(page.pluginId, nextPage, nextParams))
    },
    [page, router]
  )

  // Canonicalize a semantic `?route=` URL to its concrete plugin-page URL once the
  // page resolves, so deep links, history, and back navigation share one address.
  useEffect(() => {
    if (!semanticRoute || !page) return
    const query = Object.fromEntries(params)
    delete query.route
    router.replace(pluginPageHref(page.pluginId, page.id, query))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the resolved page identity
  }, [semanticRoute, page?.pluginId, page?.id])

  if (!isReady) return <PluginMessage title="正在加载插件" description="正在恢复插件与扩展页面。" />
  if (!page) {
    return (
      <PluginMessage
        title="插件页面不可用"
        description="插件尚未安装、已停用，或页面已在更新中移除。"
      />
    )
  }

  const Page = page.component
  return (
    <PluginPageBoundary key={`${page.pluginId}:${page.id}`}>
      <Page
        context={page.context}
        pluginId={page.pluginId}
        pageId={page.id}
        params={params}
        navigate={navigate}
      />
    </PluginPageBoundary>
  )
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
