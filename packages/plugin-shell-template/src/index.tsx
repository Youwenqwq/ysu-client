import {
  defineDictionary,
  definePlugin,
  validatePluginManifest,
  type DerivedComponentProps,
  type ObservableSource,
  type PluginUIServiceSnapshot,
  type ShellOwnerProps,
} from "@orahako/sdk"
import manifest from "../manifest.json"

const communityDictionary = defineDictionary({
  zh: {
    shell: { title: "社区界面", restore: "恢复默认界面", empty: "暂无可用页面" },
  },
  en: {
    shell: { title: "Community Shell", restore: "Restore default shell", empty: "No pages available" },
  },
})

interface CommunityShellInject {
  readonly hooks: {
    readonly ui: ObservableSource<PluginUIServiceSnapshot>
  }
  readonly openPage: (pluginId: string, pageId: string) => void
}

type CommunityShellProps = DerivedComponentProps<
  ShellOwnerProps,
  typeof communityDictionary,
  undefined,
  undefined,
  CommunityShellInject
>

function CommunityShell({ children, selectShell, t, useUi, openPage }: CommunityShellProps) {
  const { navigation } = useUi()
  return (
    <main
      style={{
        minHeight: "100svh",
        background: "#101114",
        color: "#f4f4f5",
        fontFamily: "system-ui",
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
        <strong>{t("shell.title")}</strong>
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
          {t("shell.restore")}
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
              {item.title ?? item.titleKey ?? item.id}
            </button>
          ))}
        </nav>
        <section style={{ minWidth: 0, padding: 20 }}>
          {children ?? <p>{t("shell.empty")}</p>}
        </section>
      </div>
    </main>
  )
}

export default definePlugin({
  manifest: validatePluginManifest(manifest),
  inject: ["ui", "router"] as const,
  apply(ctx) {
    ctx.ui.registerShell(
      {
        id: "community",
        name: "Community Shell",
        dictionary: communityDictionary,
        inject: () => ({
          hooks: { ui: ctx.ui.state },
          openPage: (pluginId: string, pageId: string) => ctx.router.push({ pluginId, pageId }),
        }),
      },
      CommunityShell
    )
  },
})
