"use client"

import { Component, Suspense, useCallback, useMemo, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Puzzle } from "lucide-react"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { usePluginHost } from "@/components/plugin-context"
import { useAppTranslation } from "@/components/plugin-provider"
import { usePluginUI } from "@/lib/plugins/use-plugin-ui"
import {
  pluginPageHref,
  type PluginNavigationService,
  type PluginPageProps,
} from "@orahako/plugin-sdk"

export interface SemanticPageProps {
  /** Stable semantic route registered by a plugin page. */
  route: string
}

class SemanticPageBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return <SemanticPageMessage title="页面运行失败" description={this.state.error.message} />
    }
    return this.props.children
  }
}

function SemanticPageMessage({ title, description }: { title: string; description: string }) {
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

function SemanticPageContent({ route }: SemanticPageProps) {
  const { host, isReady } = usePluginHost()
  const { pages } = usePluginUI(host.ui)
  const searchParams = useSearchParams()
  const router = useRouter()
  const { t } = useAppTranslation()

  const navigation: PluginNavigationService | undefined = host.navigation
  const target = navigation?.resolve(route)
  const resolved = target
    ? pages.find((item) => item.pluginId === target.pluginId && item.id === target.pageId)
    : // Provider-independent pages (for example login) stay reachable when the
      // navigation service's plugin allowlist omits their contributing plugin.
      pages.find((item) => item.route === route && item.requiresProvider === false)

  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams])
  const navigate = useCallback<PluginPageProps["navigate"]>(
    (nextPage, nextParams) => {
      if (!resolved) return
      router.push(pluginPageHref(resolved.pluginId, nextPage, nextParams))
    },
    [resolved, router]
  )

  if (!isReady) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!resolved) {
    return (
      <SemanticPageMessage
        title={t("app.featureUnavailable")}
        description={t("app.featureUnavailableDesc")}
      />
    )
  }

  const Page = resolved.component
  return (
    <SemanticPageBoundary key={`${resolved.pluginId}:${resolved.id}`}>
      <Page
        context={resolved.context}
        pluginId={resolved.pluginId}
        pageId={resolved.id}
        params={params}
        navigate={navigate}
      />
    </SemanticPageBoundary>
  )
}

/**
 * Generic page host for static content routes. The route is a stable semantic id
 * resolved through the navigation service; the rendered implementation is
 * whatever plugin currently contributes it, so a different composition can
 * replace the page without changing the Next.js entry.
 */
export function SemanticPage(props: SemanticPageProps) {
  return (
    <Suspense fallback={null}>
      <SemanticPageContent {...props} />
    </Suspense>
  )
}
