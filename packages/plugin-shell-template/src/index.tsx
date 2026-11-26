import {
  defineDictionary,
  definePlugin,
  validatePluginManifest,
  type DerivedComponentProps,
  type ObservableSource,
  type PluginUIServiceSnapshot,
  type ShellOwnerProps,
  type SlotComponent,
  type SlotName,
} from "@orahako/sdk"
import {
  BackLayerProvider,
  Toaster,
  type RegisterBackLayer,
} from "@orahako/ui-primitives"
import manifest from "../manifest.json"

const communityDictionary = defineDictionary({
  zh: {
    shell: { title: "社区界面", restore: "恢复默认界面", empty: "暂无可用页面" },
  },
  en: {
    shell: {
      title: "Community Shell",
      restore: "Restore default shell",
      empty: "No pages available",
    },
  },
})

/** Public shell slots shared by every replacement shell. */
const shellChildren = {
  "shell.gate": { kind: "chain" },
  "shell.banner": { kind: "list" },
  "shell.activity": { kind: "list" },
  "shell.header.actions": { kind: "list" },
  "shell.sidebar.footer": { kind: "list" },
  "shell.overlay": { kind: "list" },
} as const

interface CommunityShellInject {
  readonly hooks: {
    readonly ui: ObservableSource<PluginUIServiceSnapshot>
  }
  readonly openPage: (pluginId: string, pageId: string) => void
  readonly registerBackHandler: RegisterBackLayer
}

type CommunityShellProps = DerivedComponentProps<
  ShellOwnerProps,
  typeof communityDictionary,
  typeof shellChildren,
  undefined,
  CommunityShellInject
>

const sectionStyle = { minWidth: 0, padding: 20 } as const

const CommunityShell: SlotComponent<CommunityShellProps> = ({
  children,
  selectShell,
  t,
  renderSlot,
  renderSlotChain,
  useUi,
  openPage,
  registerBackHandler,
}: CommunityShellProps) => {
  const { navigation } = useUi()
  const bannerNode = renderSlot("shell.banner")
  const activityNode = renderSlot("shell.activity")
  const headerActionsNode = renderSlot("shell.header.actions")
  const sidebarFooterNode = renderSlot("shell.sidebar.footer")
  const overlayNode = renderSlot("shell.overlay")

  const shellBody = (
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
        {activityNode}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
          {headerActionsNode}
          <button
            type="button"
            onClick={() => selectShell()}
            style={{
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
        </div>
      </header>
      {bannerNode}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "180px minmax(0, 1fr)",
          minHeight: "calc(100svh - 62px)",
        }}
      >
        <nav
          style={{
            display: "flex",
            flexDirection: "column",
            padding: 16,
            borderRight: "1px solid #303038",
          }}
        >
          <div style={{ flex: 1 }}>
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
          </div>
          {sidebarFooterNode}
        </nav>
        <section style={sectionStyle}>
          {children ?? <p>{t("shell.empty")}</p>}
        </section>
      </div>
    </main>
  )

  return (
    <BackLayerProvider registerBackHandler={registerBackHandler}>
      {renderSlotChain("shell.gate", shellBody)}
      {overlayNode}
      <Toaster theme="dark" />
    </BackLayerProvider>
  )
}

export default definePlugin({
  manifest: validatePluginManifest(manifest),
  inject: ["ui", "slots", "router"] as const,
  apply(ctx) {
    for (const [name, spec] of Object.entries(shellChildren)) {
      ctx.slots.declare({ name: name as SlotName, kind: spec.kind })
    }
    ctx.ui.registerShell(
      {
        id: "community",
        name: "Community Shell",
        dictionary: communityDictionary,
        children: shellChildren,
        declareChildren: false,
        inject: (): CommunityShellInject => ({
          hooks: { ui: ctx.ui.state },
          openPage: (pluginId: string, pageId: string) => ctx.router.push({ pluginId, pageId }),
          registerBackHandler: (onBack, priority) =>
            ctx.router.registerBackGuard(() => {
              onBack()
              return false
            }, priority),
        }),
      },
      CommunityShell
    )
  },
})
