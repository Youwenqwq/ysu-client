import { Download, Package, Puzzle, RefreshCw, Store, Trash2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import semver from "semver"
import { toast } from "sonner"
import {
  findAvailableUpdates,
  loadCachedPluginMarket,
  loadPluginMarket,
  selectCompatibleRelease,
  type AvailablePluginUpdate,
  type DerivedComponentProps,
  type InstalledPluginSummary,
  type MarketplaceBundle,
  type MarketplaceIndex,
  type MarketplacePlugin,
  type ObservableSource,
  type PluginKind,
  type PluginManagerState,
  type PluginManifest,
  type PluginMarketResult,
  type PluginPlatform,
  type PluginUIServiceSnapshot,
  type SlotComponent,
  type TranslationKeyOf,
} from "@orahako/sdk"
import {
  Badge,
  Button,
  Card,
  CardContent,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Skeleton,
  Spinner,
  Switch,
} from "@orahako/ui-primitives"
import { groupByPluginCategory, pluginCategory, type PluginCategory } from "./categories"
import type { PluginsDictionary } from "./dictionary"
import type { PluginManagerPreferencesStore } from "./store"

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export interface OptionalProviderSnapshot {
  readonly schoolId: string | null
  readonly supportedPlugins?: readonly string[]
}

export interface PluginsPageInject {
  readonly enablePlugin: (id: string) => Promise<void>
  readonly disablePlugin: (id: string) => void
  readonly isProtected: (id: string) => boolean
  readonly listInstalled: () => Promise<readonly InstalledPluginSummary[]>
  readonly installPackage: (input: Uint8Array | ArrayBuffer | Blob) => Promise<PluginManifest>
  readonly uninstallPlugin: (id: string) => Promise<void>
  readonly installFromUrl: (
    url: string,
    sha256: string,
    expected: { id: string; version: string }
  ) => Promise<PluginManifest>
  readonly applyPluginBundle: (
    pluginIds: readonly string[],
    index: MarketplaceIndex,
    marketBaseUrl: string
  ) => Promise<PluginManifest>
  readonly getMarketUrl: () => string | undefined
  readonly getAppVersion: () => string
  readonly getNativeCapabilities: () => readonly string[]
  readonly getLoadErrors: () => ReadonlyMap<string, string>
  readonly getActiveShell: () => string | undefined
  readonly setActiveShell: (shellId: string | undefined) => void
  readonly getDefaultShell?: () => string | undefined
  readonly isSafeMode: () => boolean
  readonly getPlatform: () => PluginPlatform
  readonly confirmUninstall?: (message: string) => boolean
  readonly hooks: {
    readonly states: ObservableSource<readonly PluginManagerState[]>
    readonly ui: ObservableSource<PluginUIServiceSnapshot>
    readonly provider: ObservableSource<OptionalProviderSnapshot>
  }
}

export type PluginsPageProps = DerivedComponentProps<
  Record<string, never>,
  PluginsDictionary,
  undefined,
  PluginManagerPreferencesStore,
  PluginsPageInject
>

type StatusKey = Extract<
  TranslationKeyOf<PluginsDictionary>,
  "registered" | "waiting" | "active" | "starting" | "disabled" | "failed"
>

const STATUS_KEYS: Readonly<Record<string, StatusKey>> = {
  registered: "registered",
  waiting: "waiting",
  active: "active",
  starting: "starting",
  disabled: "disabled",
  failed: "failed",
}

const CATEGORY_LABEL_KEYS: Readonly<
  Record<PluginCategory, Extract<TranslationKeyOf<PluginsDictionary>, `category.${string}`>>
> = {
  provider: "category.provider",
  academic: "category.academic",
  toybox: "category.toybox",
  system: "category.system",
  appearance: "category.appearance",
}

function isSupportedFeature(
  supportedPlugins: readonly string[] | undefined,
  manifest: Pick<PluginManifest, "id" | "kind" | "required" | "providerIndependent">
): boolean {
  if (manifest.kind !== "feature") return true
  if (manifest.required || manifest.providerIndependent) return true
  return supportedPlugins === undefined || supportedPlugins.includes(manifest.id)
}

interface InstalledRow {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly kind: PluginKind
  readonly categories?: readonly string[]
  readonly required?: boolean
  readonly source: "builtin" | "external"
  readonly protected: boolean
  readonly supported: boolean
  readonly status: string
  readonly error?: string
}

export const PluginsPage: SlotComponent<PluginsPageProps> = (props) => {
  const {
    t,
    locale,
    useStore,
    actions,
    enablePlugin,
    disablePlugin,
    isProtected,
    listInstalled,
    installPackage,
    uninstallPlugin,
    installFromUrl,
    applyPluginBundle,
    getMarketUrl,
    getAppVersion,
    getNativeCapabilities,
    getLoadErrors,
    getActiveShell,
    setActiveShell,
    getDefaultShell,
    isSafeMode,
    getPlatform,
    confirmUninstall,
    useStates,
    useUi,
    useProvider,
  } = props

  const states = useStates()
  const uiSnapshot = useUi()
  const providerInfo = useProvider()
  const autoCheckUpdates = useStore((s) => s.autoCheckUpdates)
  const lastUpdateCheck = useStore((s) => s.lastUpdateCheck)
  const showSystemPlugins = useStore((s) => s.showSystemPlugins)
  const marketEnabled = useStore((s) => s.marketEnabled)
  const customMarketUrl = useStore((s) => s.customMarketUrl)
  const [defaultMarketUrl] = useState(() => getMarketUrl())
  const marketUrl = marketEnabled ? customMarketUrl.trim() || defaultMarketUrl : undefined

  const [packages, setPackages] = useState<readonly InstalledPluginSummary[]>([])
  const [market, setMarket] = useState<PluginMarketResult | undefined>(() =>
    marketUrl ? loadCachedPluginMarket(marketUrl) : undefined
  )
  // Only show the offline fallback notice when a network request actually failed
  // and fell back to cache — never simply because initial state hydrated from cache.
  const [marketOffline, setMarketOffline] = useState(false)
  const [marketError, setMarketError] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | undefined>()
  const [checking, setChecking] = useState(false)
  const [selectedShell, setSelectedShell] = useState<string | undefined>(() => getActiveShell())
  const checkingRef = useRef(false)
  const initialFetchUrlRef = useRef<string | undefined>(undefined)

  const platform = getPlatform()
  const appVersion = getAppVersion()
  const nativeCapabilities = getNativeCapabilities()
  const loadErrors = getLoadErrors()
  const safeMode = isSafeMode()

  const refreshPackages = useCallback(async () => {
    setPackages(await listInstalled())
  }, [listInstalled])

  const refreshMarket = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    setChecking(true)
    setMarketError(undefined)
    try {
      if (!marketUrl) {
        throw new Error("The active composition does not provide a plugin market")
      }
      const resolved = await loadPluginMarket(marketUrl)
      setMarket(resolved)
      setMarketOffline(resolved.stale)
      if (!resolved.stale) actions.setLastUpdateCheck(Date.now())
    } catch (error) {
      setMarketOffline(false)
      setMarketError(error instanceof Error ? error.message : String(error))
    } finally {
      checkingRef.current = false
      setChecking(false)
    }
  }, [actions, marketUrl])

  useEffect(() => {
    setMarket(marketUrl ? loadCachedPluginMarket(marketUrl) : undefined)
    setMarketOffline(false)
    setMarketError(undefined)
  }, [marketUrl])

  useEffect(() => {
    void refreshPackages().catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error))
    })
    if (!marketUrl) return
    const needsInitialFetch =
      initialFetchUrlRef.current !== marketUrl && !loadCachedPluginMarket(marketUrl)
    const autoCheckDue = autoCheckUpdates && Date.now() - lastUpdateCheck >= AUTO_CHECK_INTERVAL_MS
    if (needsInitialFetch || autoCheckDue) {
      initialFetchUrlRef.current = marketUrl
      void refreshMarket()
    }
  }, [autoCheckUpdates, lastUpdateCheck, marketUrl, refreshMarket, refreshPackages])

  async function runAction(id: string, task: () => Promise<unknown>): Promise<void> {
    if (busy) return
    setBusy(id)
    try {
      await task()
      await refreshPackages()
      setSelectedShell(getActiveShell())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(undefined)
    }
  }

  async function handleInstallRelease(plugin: MarketplacePlugin): Promise<void> {
    if (!marketUrl) return
    const release = selectCompatibleRelease(plugin, appVersion, platform, nativeCapabilities)
    if (!release) return
    await runAction(plugin.id, async () => {
      await installFromUrl(new URL(release.zipUrl, marketUrl).toString(), release.sha256, {
        id: plugin.id,
        version: release.version,
      })
      toast.success(t("installedSuccess", { name: plugin.name }))
    })
  }

  async function handleUpdateAll(updates: readonly AvailablePluginUpdate[]): Promise<void> {
    await runAction("update-all", async () => {
      if (!marketUrl) throw new Error("The active composition does not provide a plugin market")
      for (const update of updates) {
        await installFromUrl(
          new URL(update.release.zipUrl, marketUrl).toString(),
          update.release.sha256,
          { id: update.plugin.id, version: update.release.version }
        )
      }
      toast.success(t("updatedAll", { count: updates.length }))
    })
  }

  async function handleEnableBundle(bundle: MarketplaceBundle): Promise<void> {
    await runAction(bundle.id, async () => {
      if (!marketUrl) throw new Error("The active composition does not provide a plugin market")
      const resolved = market ?? (await loadPluginMarket(marketUrl))
      setMarket(resolved)
      if (!market) setMarketOffline(resolved.stale)
      await applyPluginBundle(bundle.pluginIds, resolved.index, marketUrl)
      toast.success(t("bundleEnabled", { name: bundle.name }))
    })
  }

  const installedIds = new Set(packages.map((pkg) => pkg.manifest.id))
  const externalOnly = packages.filter(
    (pkg) => !states.some((state) => state.manifest.id === pkg.manifest.id)
  )

  const rows: InstalledRow[] = [
    ...states.map((state): InstalledRow => {
      const source: "builtin" | "external" =
        state.source ?? (installedIds.has(state.manifest.id) ? "external" : "builtin")
      const categories =
        state.manifest.categories ??
        market?.index.plugins.find((entry) => entry.id === state.manifest.id)?.categories
      const error = state.error ?? loadErrors.get(state.manifest.id)
      return {
        id: state.manifest.id,
        name: state.manifest.name,
        version: state.manifest.version,
        kind: state.manifest.kind,
        ...(categories !== undefined ? { categories } : {}),
        ...(state.manifest.required !== undefined ? { required: state.manifest.required } : {}),
        source,
        protected: isProtected(state.manifest.id),
        supported: isSupportedFeature(providerInfo.supportedPlugins, state.manifest),
        status: state.status,
        ...(error !== undefined ? { error } : {}),
      }
    }),
    ...externalOnly.map((pkg): InstalledRow => {
      const categories =
        pkg.manifest.categories ??
        market?.index.plugins.find((entry) => entry.id === pkg.manifest.id)?.categories
      const error = loadErrors.get(pkg.manifest.id)
      return {
        id: pkg.manifest.id,
        name: pkg.manifest.name,
        version: pkg.manifest.version,
        kind: pkg.manifest.kind,
        ...(categories !== undefined ? { categories } : {}),
        ...(pkg.manifest.required !== undefined ? { required: pkg.manifest.required } : {}),
        source: "external",
        protected: isProtected(pkg.manifest.id),
        supported: isSupportedFeature(providerInfo.supportedPlugins, pkg.manifest),
        status: error ? "failed" : "disabled",
        ...(error !== undefined ? { error } : {}),
      }
    }),
  ]

  const availableUpdates = market
    ? findAvailableUpdates(
        market.index,
        rows.filter((row) => row.source === "external"),
        appVersion,
        platform,
        nativeCapabilities
      )
    : []

  const installedGroups = groupByPluginCategory(
    showSystemPlugins ? rows : rows.filter((row) => pluginCategory(row) !== "system")
  )
  const compatibleMarketPlugins =
    market?.index.plugins.filter(
      (plugin) =>
        pluginCategory(plugin) !== "provider" &&
        Boolean(selectCompatibleRelease(plugin, appVersion, platform, nativeCapabilities))
    ) ?? []
  const marketGroups = groupByPluginCategory(compatibleMarketPlugins)

  const recommendedBundles =
    market?.index.bundles?.filter(
      (bundle) =>
        bundle.schoolId === "*" ||
        (providerInfo.schoolId !== null && bundle.schoolId === providerInfo.schoolId)
    ) ?? []

  const lastCheckText =
    lastUpdateCheck > 0
      ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }).format(lastUpdateCheck)
      : undefined

  const shells = uiSnapshot.shells
  const activeShellId = selectedShell ?? getDefaultShell?.()

  const handleSelectShell = (shellId: string): void => {
    setActiveShell(shellId)
    setSelectedShell(shellId)
  }

  const askConfirmUninstall = (name: string): boolean => {
    const promptText = t("uninstallConfirm", { name })
    if (confirmUninstall) return confirmUninstall(promptText)
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      return window.confirm(promptText)
    }
    return true
  }

  return (
    <div className="flex flex-col gap-6">
      {safeMode && (
        <Card className="border-amber-500/50 bg-amber-500/5 py-0">
          <CardContent className="p-4 text-sm">{t("safeMode")}</CardContent>
        </Card>
      )}

      {marketUrl && (
        <Card className="py-0">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{t("updateCheck")}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {lastCheckText
                    ? t("lastUpdateCheck", { time: lastCheckText })
                    : t("neverChecked")}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t("autoCheckUpdates")}</span>
                <Switch
                  checked={autoCheckUpdates}
                  onCheckedChange={actions.setAutoCheckUpdates}
                  aria-label={t("autoCheckUpdates")}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={checking}
                onClick={() => void refreshMarket()}
              >
                <RefreshCw className={checking ? "animate-spin" : undefined} />
                {t(checking ? "checking" : "checkNow")}
              </Button>
              {availableUpdates.length > 0 && (
                <Button
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={() => void handleUpdateAll(availableUpdates)}
                >
                  {t("updateAll", { count: availableUpdates.length })}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {recommendedBundles.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Package className="size-4" />
            {t("recommendedBundles")}
          </h2>
          {recommendedBundles.map((bundle) => {
            const complete = bundle.pluginIds.every((id) => {
              const row = rows.find((item) => item.id === id)
              return row?.status === "active" || row?.status === "starting"
            })
            const names = bundle.pluginIds
              .map(
                (id) =>
                  rows.find((row) => row.id === id)?.name ??
                  market?.index.plugins.find((plugin) => plugin.id === id)?.name ??
                  id
              )
              .join(" · ")
            return (
              <Card key={bundle.id} className="py-0">
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{bundle.name}</div>
                    <p className="mt-1 text-xs break-words text-muted-foreground">{names}</p>
                  </div>
                  <Button
                    size="sm"
                    disabled={complete || Boolean(busy)}
                    onClick={() => void handleEnableBundle(bundle)}
                  >
                    {busy === bundle.id && <Spinner data-icon="inline-start" />}
                    {t(
                      busy === bundle.id
                        ? "bundleWorking"
                        : complete
                          ? "bundleComplete"
                          : "enableBundle"
                    )}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Puzzle className="size-4" />
            {t("installed")}
          </h2>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary">
            <Download className="size-4" />
            {t("sideload")}
            <input
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              disabled={Boolean(busy)}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (file) {
                  void runAction("sideload", async () => {
                    const manifest = await installPackage(file)
                    toast.success(t("installedSuccess", { name: manifest.name }))
                  })
                }
              }}
            />
          </label>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("trustWarning")}</p>
        {installedGroups.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Package />
              </EmptyMedia>
              <EmptyTitle>{t("noPlugins")}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          installedGroups.map((group) => (
            <div key={group.id} className="flex flex-col gap-3">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t(CATEGORY_LABEL_KEYS[group.id])}
              </h3>
              {group.plugins.map((plugin) => {
                const statusKey = STATUS_KEYS[plugin.status] ?? "disabled"
                return (
                  <Card key={plugin.id} className="py-0">
                    <CardContent className="flex flex-col gap-3 p-4">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{plugin.name}</div>
                          <div className="truncate font-mono text-xs text-muted-foreground">
                            {plugin.id} · v{plugin.version}
                          </div>
                        </div>
                        <Badge variant="outline">{t(plugin.source)}</Badge>
                        <Badge variant={plugin.status === "failed" ? "destructive" : "secondary"}>
                          {t(statusKey)}
                        </Badge>
                      </div>
                      {plugin.error && (
                        <p className="text-xs break-words text-destructive">{plugin.error}</p>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        {!plugin.protected ? (
                          <Switch
                            checked={
                              plugin.status === "active" ||
                              plugin.status === "starting" ||
                              plugin.status === "waiting"
                            }
                            disabled={
                              Boolean(busy) ||
                              !plugin.supported ||
                              plugin.status === "registered" ||
                              plugin.status === "starting"
                            }
                            onCheckedChange={(enabled) =>
                              void runAction(plugin.id, async () => {
                                if (enabled) await enablePlugin(plugin.id)
                                else disablePlugin(plugin.id)
                              })
                            }
                            aria-label={t("toggle", { name: plugin.name })}
                          />
                        ) : (
                          <span />
                        )}
                        {plugin.source === "external" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={Boolean(busy)}
                            onClick={() => {
                              if (askConfirmUninstall(plugin.name)) {
                                void runAction(plugin.id, () => uninstallPlugin(plugin.id))
                              }
                            }}
                          >
                            <Trash2 />
                            {t("uninstall")}
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          ))
        )}
      </section>

      {shells.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">{t("shell")}</h2>
          <div className="grid grid-cols-2 gap-2">
            {shells.map((shell) => {
              const id = `${shell.pluginId}:${shell.id}`
              const selected =
                activeShellId !== undefined && (activeShellId === id || activeShellId === shell.id)
              return (
                <Button
                  key={id}
                  variant={selected ? "default" : "outline"}
                  onClick={() => handleSelectShell(id)}
                >
                  {shell.name}
                </Button>
              )
            })}
          </div>
        </section>
      )}

      {marketUrl && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Store className="size-4" />
              {t("market")}
            </h2>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void refreshMarket()}
              aria-label={t("refresh")}
            >
              <RefreshCw className={checking ? "animate-spin" : undefined} />
            </Button>
          </div>
          {marketOffline && <p className="text-xs text-amber-600">{t("staleMarket")}</p>}
          {marketError && <p className="text-sm text-destructive">{marketError}</p>}
          {!market && !marketError && <Skeleton className="h-28 w-full" />}
          {market && compatibleMarketPlugins.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Store />
                </EmptyMedia>
                <EmptyTitle>{t("noMarket")}</EmptyTitle>
                <EmptyDescription>{t("noMarketDesc")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {marketGroups.map((group) => (
            <div key={group.id} className="flex flex-col gap-3">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t(CATEGORY_LABEL_KEYS[group.id])}
              </h3>
              {group.plugins.map((plugin) => {
                const release = selectCompatibleRelease(
                  plugin,
                  appVersion,
                  platform,
                  nativeCapabilities
                )
                if (!release) return null
                const installed = rows.find((row) => row.id === plugin.id)
                const hasUpdate = Boolean(
                  installed && semver.gt(release.version, installed.version)
                )
                return (
                  <Card key={plugin.id} className="py-0">
                    <CardContent className="flex items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium">{plugin.name}</span>
                          {plugin.trust === "official" && (
                            <Badge variant="secondary">{t("official")}</Badge>
                          )}
                          {plugin.trust === "community" && (
                            <Badge variant="outline">{t("community")}</Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {plugin.summary}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 font-mono text-xs text-muted-foreground">
                          <span>
                            {plugin.author} ·{" "}
                            {hasUpdate && installed
                              ? `v${installed.version} → v${release.version}`
                              : `v${release.version}`}
                          </span>
                          {plugin.homepage && (
                            <>
                              <span>·</span>
                              <a
                                href={plugin.homepage}
                                target="_blank"
                                rel="noreferrer"
                                className="font-sans text-primary underline-offset-4 hover:underline"
                              >
                                {t("sourceLink")}
                              </a>
                            </>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={Boolean(busy) || (Boolean(installed) && !hasUpdate)}
                        onClick={() => void handleInstallRelease(plugin)}
                      >
                        {t(hasUpdate ? "update" : installed ? "installedBadge" : "install")}
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
