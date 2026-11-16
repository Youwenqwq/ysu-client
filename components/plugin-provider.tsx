"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import type { CompositionSource, PluginI18nRegistryService, PluginLocale } from "@orahako/plugin-sdk"
import { getPluginHost } from "@/lib/plugins/host"
import { PluginSlotRuntimeProvider } from "./plugin-slot-runtime"
import { PluginReactContext, usePluginHost } from "./plugin-context"

export { usePluginHost }

/**
 * The kernel mounts whatever composition the application entry passes in.
 * `PluginProvider` never imports an official implementation; the concrete
 * source is selected by `app/composition`.
 */
export function PluginProvider({
  source,
  children,
}: {
  source: CompositionSource
  children: React.ReactNode
}) {

  const host = getPluginHost(source)
  const [isReady, setReady] = useState(false)

  useEffect(() => {
    let active = true

    void host.bootstrap().then(
      () => {

        if (active) setReady(true)
      },
      (error) => {

        host.bootstrapError = error instanceof Error ? error.message : String(error)
        if (active) setReady(true)
      }
    )
    return () => {
      active = false
    }
  }, [host])

  const value = useMemo(() => ({ host, isReady }), [host, isReady])
  return (
    <PluginReactContext.Provider value={value}>
      <PluginSlotRuntimeProvider registry={host.slots}>
        {isReady ? children : <div className="min-h-svh bg-background" />}
      </PluginSlotRuntimeProvider>
    </PluginReactContext.Provider>
  )
}

export function usePluginStates() {
  const { host } = usePluginHost()
  return useSyncExternalStore(
    host.runtime.subscribe,
    host.runtime.getSnapshot.bind(host.runtime),
    host.runtime.getSnapshot.bind(host.runtime)
  )
}

const NO_I18N_SUBSCRIBE = () => () => {}
const NO_I18N_REVISION = () => 0

/**
 * Kernel translation over the active i18n service.
 *
 * Generic route hosts and kernel surfaces translate through the replaceable
 * service snapshot instead of importing the official dictionary/provider.
 * An empty contributor id makes the registry fall back to the shared
 * application dictionary while still honoring the active locale. A composition
 * without an i18n service still renders: keys pass through unchanged.
 */
export function useAppTranslation() {
  const { host } = usePluginHost()
  const i18n: PluginI18nRegistryService | undefined = host.i18n
  const revision = useSyncExternalStore(
    i18n?.subscribe ?? NO_I18N_SUBSCRIBE,
    i18n?.getSnapshot ?? NO_I18N_REVISION,
    i18n?.getSnapshot ?? NO_I18N_REVISION
  )
  return useMemo(() => {
    void revision
    if (!i18n) {
      return {
        locale: "zh" as const,
        t: (key: string, _params?: Record<string, string | number>) => key,
        translate: (
          _pluginId: string,
          key: string,
          _locale: string,
          _params?: Record<string, string | number>
        ) => key,
      }
    }
    const locale = i18n.getLocale()
    return {
      locale,
      t: (key: string, params?: Record<string, string | number>) =>
        i18n.translate("", key, locale, params),
      translate: (
        pluginId: string,
        key: string,
        targetLocale: PluginLocale,
        params?: Record<string, string | number>
      ) => i18n.translate(pluginId, key, targetLocale, params),
    }
  }, [i18n, revision])
}
