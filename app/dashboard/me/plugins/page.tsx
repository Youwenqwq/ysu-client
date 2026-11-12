"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Download, Package, Puzzle, RefreshCw, Store, Trash2 } from "lucide-react"
import semver from "semver"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { usePluginHost, usePluginStates } from "@/components/plugin-provider"
import { usePluginUI } from "@/lib/plugins/use-plugin-ui"
import { usePluginPreferences } from "@/lib/stores/plugin-preferences"
import {
  findAvailableUpdates,
  loadCachedPluginMarket,
  loadPluginMarket,
  PLUGIN_MARKET_URL,
  selectCompatibleRelease,
  type AvailablePluginUpdate,
  type PluginMarketResult,
} from "@/lib/plugins/market"
import type { InstalledPluginSummary } from "@/lib/plugins/package-store"
import { isCapacitor } from "@/lib/native/platform"
import { APP_VERSION } from "@/lib/version"
import { useTranslation } from "@/lib/i18n/use-translation"
import type { MarketplacePlugin } from "@ysu/plugin-sdk"

export default function PluginsPage() {
  const { host, isReady } = usePluginHost()
  const states = usePluginStates()
  const { themes } = usePluginUI(host.ui)
  const activeTheme = usePluginPreferences((state) => state.activeTheme)
  const setActiveTheme = usePluginPreferences((state) => state.setActiveTheme)
  const autoCheckUpdates = usePluginPreferences((state) => state.autoCheckUpdates)
  const setAutoCheckUpdates = usePluginPreferences((state) => state.setAutoCheckUpdates)
  const lastUpdateCheck = usePluginPreferences((state) => state.lastUpdateCheck)
  const setLastUpdateCheck = usePluginPreferences((state) => state.setLastUpdateCheck)
  const { t, locale } = useTranslation()
  const [packages, setPackages] = useState<readonly InstalledPluginSummary[]>([])
  const [market, setMarket] = useState<PluginMarketResult>()
  const [marketError, setMarketError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [checking, setChecking] = useState(false)
  const checkingRef = useRef(false)
  const platform = isCapacitor() ? "android" : "web"

  const refreshPackages = useCallback(async () => {
    setPackages(await host.packages.list())
  }, [host])
  const refreshMarket = useCallback(async () => {
    if (checkingRef.current) return
    checkingRef.current = true
    setChecking(true)
    setMarketError(undefined)
    try {
      setMarket(await loadPluginMarket())
    } catch (error) {
      setMarketError(error instanceof Error ? error.message : String(error))
    } finally {
      setLastUpdateCheck(Date.now())
      checkingRef.current = false
      setChecking(false)
    }
  }, [setLastUpdateCheck])

  useEffect(() => {
    if (!isReady) return
    void refreshPackages().catch((error) => toast.error(String(error)))
    setMarket((current) => current ?? loadCachedPluginMarket())
    if (autoCheckUpdates && Date.now() - lastUpdateCheck >= 6 * 60 * 60 * 1000) {
      void refreshMarket()
    }
  }, [isReady, autoCheckUpdates, lastUpdateCheck, refreshMarket, refreshPackages])

  async function run(id: string, action: () => Promise<unknown>) {
    if (busy) return
    setBusy(id)
    try {
      await action()
      await refreshPackages()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(undefined)
    }
  }

  async function installRelease(plugin: MarketplacePlugin) {
    const release = selectCompatibleRelease(plugin, APP_VERSION, platform)
    if (!release) return
    await run(plugin.id, async () => {
      await host.installFromUrl(
        new URL(release.zipUrl, PLUGIN_MARKET_URL).toString(),
        release.sha256,
        {
          id: plugin.id,
          version: release.version,
        }
      )
      toast.success(t("plugins.installedSuccess", { name: plugin.name }))
    })
  }

  async function updateAll(updates: AvailablePluginUpdate[]) {
    await run("update-all", async () => {
      for (const update of updates) {
        await host.installFromUrl(
          new URL(update.release.zipUrl, PLUGIN_MARKET_URL).toString(),
          update.release.sha256,
          { id: update.plugin.id, version: update.release.version }
        )
      }
      toast.success(t("plugins.updatedAll", { count: updates.length }))
    })
  }

  const externalOnly = packages.filter(
    (pkg) => !states.some((state) => state.manifest.id === pkg.manifest.id)
  )
  const rows = [
    ...states.map((state) => ({
      id: state.manifest.id,
      name: state.manifest.name,
      version: state.manifest.version,
      kind: state.manifest.kind,
      source: state.source,
      required: state.manifest.required,
      status: state.status,
      error: state.error ?? host.loadErrors.get(state.manifest.id),
    })),
    ...externalOnly.map((pkg) => ({
      id: pkg.manifest.id,
      name: pkg.manifest.name,
      version: pkg.manifest.version,
      kind: pkg.manifest.kind,
      source: "external" as const,
      required: pkg.manifest.required,
      status: "disabled" as const,
      error: host.loadErrors.get(pkg.manifest.id),
    })),
  ]
  const availableUpdates = market
    ? findAvailableUpdates(market.index, rows, APP_VERSION, platform)
    : []
  const lastCheckText = lastUpdateCheck
    ? new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(lastUpdateCheck)
    : undefined

  return (
    <div className="flex flex-col gap-6">
      {host.recovery?.safeMode && (
        <Card className="border-amber-500/50 bg-amber-500/5 py-0">
          <CardContent className="p-4 text-sm">{t("plugins.safeMode")}</CardContent>
        </Card>
      )}

      <Card className="py-0">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">{t("plugins.updateCheck")}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {lastCheckText
                  ? t("plugins.lastUpdateCheck", { time: lastCheckText })
                  : t("plugins.neverChecked")}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("plugins.autoCheckUpdates")}</span>
              <Switch
                checked={autoCheckUpdates}
                onCheckedChange={setAutoCheckUpdates}
                aria-label={t("plugins.autoCheckUpdates")}
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
              {t(checking ? "plugins.checking" : "plugins.checkNow")}
            </Button>
            {availableUpdates.length > 0 && (
              <Button size="sm" disabled={!!busy} onClick={() => void updateAll(availableUpdates)}>
                {t("plugins.updateAll", { count: availableUpdates.length })}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Puzzle className="size-4" />
            {t("plugins.installed")}
          </h2>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary">
            <Download className="size-4" />
            {t("plugins.sideload")}
            <input
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              disabled={!!busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ""
                if (file) {
                  void run("sideload", async () => {
                    const manifest = await host.install(file)
                    toast.success(t("plugins.installedSuccess", { name: manifest.name }))
                  })
                }
              }}
            />
          </label>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{t("plugins.trustWarning")}</p>
        {rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Package />
              </EmptyMedia>
              <EmptyTitle>{t("plugins.noPlugins")}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          rows.map((plugin) => (
            <Card key={plugin.id} className="py-0">
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{plugin.name}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {plugin.id} · v{plugin.version}
                    </div>
                  </div>
                  <Badge variant="outline">{t(`plugins.${plugin.source}`)}</Badge>
                  <Badge variant={plugin.status === "failed" ? "destructive" : "secondary"}>
                    {t(`plugins.${plugin.status}`)}
                  </Badge>
                </div>
                {plugin.error && (
                  <p className="text-xs break-words text-destructive">{plugin.error}</p>
                )}
                <div className="flex items-center justify-between gap-2">
                  {!plugin.required ? (
                    <Switch
                      checked={plugin.status === "active"}
                      disabled={!!busy || plugin.status === "registered"}
                      onCheckedChange={(enabled) =>
                        void run(plugin.id, async () => {
                          if (enabled) await host.enable(plugin.id)
                          else host.disable(plugin.id)
                        })
                      }
                      aria-label={t("plugins.toggle", { name: plugin.name })}
                    />
                  ) : (
                    <span />
                  )}
                  {plugin.source === "external" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={!!busy}
                      onClick={() => {
                        if (window.confirm(t("plugins.uninstallConfirm", { name: plugin.name }))) {
                          void run(plugin.id, () => host.uninstall(plugin.id))
                        }
                      }}
                    >
                      <Trash2 />
                      {t("plugins.uninstall")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      {themes.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold">{t("plugins.theme")}</h2>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={activeTheme ? "outline" : "default"}
              onClick={() => setActiveTheme(undefined)}
            >
              {t("plugins.defaultTheme")}
            </Button>
            {themes.map((theme) => {
              const id = `${theme.pluginId}:${theme.id}`
              return (
                <Button
                  key={id}
                  variant={activeTheme === id ? "default" : "outline"}
                  onClick={() => setActiveTheme(id)}
                >
                  {theme.name}
                </Button>
              )
            })}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Store className="size-4" />
            {t("plugins.market")}
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void refreshMarket()}
            aria-label={t("plugins.refresh")}
          >
            <RefreshCw className={checking ? "animate-spin" : undefined} />
          </Button>
        </div>
        {market?.stale && <p className="text-xs text-amber-600">{t("plugins.staleMarket")}</p>}
        {marketError && <p className="text-sm text-destructive">{marketError}</p>}
        {!market && !marketError && <Skeleton className="h-28 w-full" />}
        {market?.index.plugins.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Store />
              </EmptyMedia>
              <EmptyTitle>{t("plugins.noMarket")}</EmptyTitle>
              <EmptyDescription>{t("plugins.noMarketDesc")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {market?.index.plugins.map((plugin) => {
          const release = selectCompatibleRelease(plugin, APP_VERSION, platform)
          if (!release) return null
          const installed = rows.find((row) => row.id === plugin.id)
          const update = installed && semver.gt(release.version, installed.version)
          return (
            <Card key={plugin.id} className="py-0">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{plugin.name}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {plugin.summary}
                  </p>
                  <div className="mt-2 font-mono text-xs text-muted-foreground">
                    {plugin.author} ·{" "}
                    {update && installed
                      ? `v${installed.version} → v${release.version}`
                      : `v${release.version}`}
                  </div>
                </div>
                <Button
                  size="sm"
                  disabled={!!busy || (!!installed && !update)}
                  onClick={() => void installRelease(plugin)}
                >
                  {t(
                    update
                      ? "plugins.update"
                      : installed
                        ? "plugins.installedBadge"
                        : "plugins.install"
                  )}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </section>
    </div>
  )
}
