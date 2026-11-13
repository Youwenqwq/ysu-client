"use client"

import { Bike, History, MapPin, RefreshCw, Settings, UserRound } from "lucide-react"
import { Button, cn } from "@ysu/plugin-ui/components"
import { usePluginTranslation } from "@ysu/plugin-ui/plugin"
import { PERLICA_PLUGIN_ID } from "../constants"
import { PERLICA_TABS, type PerlicaTab } from "../extras/app-nav"

const TAB_META = {
  map: { icon: MapPin, key: "perlica.tabMap" },
  ride: { icon: Bike, key: "perlica.tabRide" },
  history: { icon: History, key: "perlica.tabHistory" },
  account: { icon: UserRound, key: "perlica.tabAccount" },
} as const

interface PerlicaSectionNavProps {
  active: PerlicaTab
  onSelect: (tab: PerlicaTab) => void
  onOpenSettings?: () => void
  onRefresh?: () => void
  refreshing?: boolean
}

/**
 * Mobile-only section switcher owned by the plugin.
 *
 * External plugins cannot inject host mobile chrome (`useMobileAppNav` is
 * host-private), so the same four sections and Settings entry are rendered as
 * a pinned strip inside the plugin page. Desktop keeps the original sidebar.
 */
export function PerlicaSectionNav({
  active,
  onSelect,
  onOpenSettings,
  onRefresh,
  refreshing = false,
}: PerlicaSectionNavProps) {
  const { t } = usePluginTranslation(PERLICA_PLUGIN_ID)

  return (
    <nav
      aria-label={t("perlica.nav")}
      className="toybox-glass relative mb-2 flex shrink-0 items-center gap-1 rounded-xl px-2 py-1.5 md:hidden"
    >
      <div role="tablist" aria-label={t("perlica.nav")} className="flex flex-1 items-stretch gap-1">
        {PERLICA_TABS.map((value) => {
          const { icon: Icon, key } = TAB_META[value]
          const selected = value === active
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`perlica-panel-${value}`}
              onClick={() => onSelect(value)}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[10px] font-medium transition-colors",
                selected
                  ? "bg-background/80 text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              )}
            >
              <Icon className="size-4" strokeWidth={selected ? 2.4 : 2} />
              <span className="max-w-full truncate">{t(key)}</span>
            </button>
          )
        })}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 border-l pl-1">
        {onRefresh ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={t("perlica.refresh")}
          >
            <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
          </Button>
        ) : null}
        {onOpenSettings ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onOpenSettings}
            aria-label={t("perlica.settingsTitle")}
          >
            <Settings className="size-4" />
          </Button>
        ) : null}
      </div>
    </nav>
  )
}
