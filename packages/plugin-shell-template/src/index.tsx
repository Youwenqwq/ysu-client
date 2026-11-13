import { Component, useMemo, useSyncExternalStore, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import {
  ActivationGate,
  BackButtonHandler,
  DeepLinkHandler,
  MFAModal,
  ProviderProvider,
  SDKProvider,
  Toaster,
  TooltipProvider,
} from "@orahako/plugin-ui/shell"
import {
  definePlugin,
  pluginPageHref,
  PluginSlot,
  withAppBasePath,
  type PluginContext,
} from "@orahako/plugin-sdk"

class CommunityPageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <p>此页面无法在当前 Shell 中运行。</p> : this.props.children
  }
}

function CommunityShell({
  ctx,
  selectShell,
}: {
  ctx: PluginContext
  selectShell(id?: string): void
}) {
  const { pages, navigation } = useSyncExternalStore(
    ctx.ui.subscribe,
    ctx.ui.getSnapshot,
    ctx.ui.getSnapshot
  )
  const searchParams = useSearchParams()
  const params = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams])
  const pluginId = params.get("plugin")
  const pageId = params.get("page") ?? "index"
  const primaryNavigation = navigation
    .filter((item) => item.primary)
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))[0]
  const primaryPage = primaryNavigation
    ? pages.find(
        (item) => item.pluginId === primaryNavigation.pluginId && item.id === primaryNavigation.page
      )
    : undefined
  const page =
    pages.find((item) => item.pluginId === pluginId && item.id === pageId) ??
    primaryPage ??
    pages.find((item) => item.primary) ??
    pages[0]

  function openPage(
    id: string,
    targetPage = "index",
    params?: Record<string, string | number | undefined>
  ) {
    const href = withAppBasePath(pluginPageHref(id, targetPage, params))
    window.history.pushState(undefined, "", href)
  }

  const Page = page?.component
  return (
    <ActivationGate>
      <ProviderProvider>
        <SDKProvider>
          <TooltipProvider>
            <BackButtonHandler />
            <DeepLinkHandler />
            <PluginSlot name="shell.overlay" />
            <main
              style={{
                minHeight: "100svh",
                fontFamily: "system-ui",
                background: "#101114",
                color: "#f4f4f5",
              }}
            >
              <header
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "16px 20px",
                  borderBottom: "1px solid #303038",
                }}
              >
                <strong>Community Shell</strong>
                <span style={{ color: "#a1a1aa", fontSize: 13 }}>完全由外部插件渲染</span>
                <button
                  type="button"
                  onClick={() => selectShell()}
                  style={{
                    marginLeft: "auto",
                    color: "inherit",
                    background: "transparent",
                    border: "1px solid #3f3f46",
                    borderRadius: 8,
                    padding: "8px 12px",
                    cursor: "pointer",
                  }}
                >
                  恢复默认界面
                </button>
              </header>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "180px minmax(0, 1fr)",
                  minHeight: "calc(100svh - 62px)",
                }}
              >
                <nav style={{ padding: 16, borderRight: "1px solid #303038" }}>
                  {navigation.map((item) => (
                    <button
                      key={`${item.pluginId}:${item.id}`}
                      type="button"
                      onClick={() => openPage(item.pluginId, item.page)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "10px 12px",
                        marginBottom: 6,
                        textAlign: "left",
                        color: "inherit",
                        background: "transparent",
                        border: 0,
                        borderRadius: 8,
                        cursor: "pointer",
                      }}
                    >
                      {item.title}
                    </button>
                  ))}
                </nav>
                <section style={{ minWidth: 0, padding: 20 }}>
                  {page && Page ? (
                    <CommunityPageBoundary key={`${page.pluginId}:${page.id}`}>
                      <Page
                        pluginId={page.pluginId}
                        pageId={page.id}
                        params={params}
                        navigate={(targetPage, params) =>
                          openPage(page.pluginId, targetPage, params)
                        }
                      />
                    </CommunityPageBoundary>
                  ) : (
                    <p>暂无可用页面。请启用一个功能插件。</p>
                  )}
                </section>
              </div>
            </main>
            <Toaster />
            <MFAModal />
          </TooltipProvider>
        </SDKProvider>
      </ProviderProvider>
    </ActivationGate>
  )
}

export default definePlugin((ctx) => {
  ctx.ui.registerShell({
    id: "community",
    name: "Community Shell",
    component: ({ selectShell }) => <CommunityShell ctx={ctx} selectShell={selectShell} />,
  })
})
