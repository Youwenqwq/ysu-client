"use client"

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import type {
  PluginProviderRuntimeService,
  ProviderRuntimeSnapshot,
} from "@orahako/plugin-sdk"
import type { AcademicProviderRuntime } from "@orahako/plugin-sdk/academic"
import { usePluginHost, usePluginServices } from "@/components/plugin-context"
import type { AcademicPluginContext } from "@orahako/plugin-sdk"
import { useSettingsStore } from "@/plugins/official/shell/stores/settings"
import { useTranslation } from "@/plugins/official/runtime/i18n/use-translation"

export interface ProviderContextValue {
  /** Host UI requires the built-in academic modules; capabilities gate each feature. */
  provider: AcademicProviderRuntime
  snapshot: ProviderRuntimeSnapshot
  isReady: boolean
  error: Error | null
}

const ProviderContext = createContext<ProviderContextValue | null>(null)

interface ProviderProviderProps {
  children: React.ReactNode
  schoolId?: string
}

/**
 * React adapter over the root provider runtime. The runtime owns selection,
 * initialization, retries and generation checks; this component only mirrors
 * its snapshot and requests the user's configured school. No provider is
 * constructed or selected at module scope, and an unregistered school leaves
 * the runtime unavailable instead of substituting another school.
 */
export function ProviderProvider({ children, schoolId }: ProviderProviderProps) {
  const { provider: runtime } = usePluginServices<AcademicPluginContext>()
  if (!runtime) throw new Error("ProviderProvider requires the provider runtime service")
  return (
    <ProviderRuntimeBridge runtime={runtime} schoolId={schoolId}>
      {children}
    </ProviderRuntimeBridge>
  )
}

function ProviderRuntimeBridge({
  runtime,
  schoolId,
  children,
}: ProviderProviderProps & { runtime: PluginProviderRuntimeService }) {
  const { providers } = usePluginServices<AcademicPluginContext>()
  const { t } = useTranslation()
  const snapshot = useSyncExternalStore(
    runtime.subscribe,
    runtime.getSnapshot,
    runtime.getSnapshot
  )
  const hasHydrated = useSettingsStore((state) => state.hasHydrated)
  const configuredSchoolId = useSettingsStore((state) => state.schoolId)
  const requestedSchoolId = schoolId ?? (hasHydrated ? configuredSchoolId : undefined)
  const [registryRevision, setRegistryRevision] = useState(0)

  useEffect(
    () => providers.subscribe(() => setRegistryRevision((revision) => revision + 1)),
    [providers]
  )

  useEffect(() => {
    try {
      if (requestedSchoolId) runtime.selectSchool(requestedSchoolId)
      else runtime.getActive()
    } catch {
      // The runtime is unavailable for this school; never fall back to another.
      return
    }
    void runtime.initialize().catch(() => undefined)
  }, [runtime, requestedSchoolId, registryRevision])

  const value = useMemo<ProviderContextValue | null>(() => {
    if (!snapshot.provider) return null
    return {
      // The runtime only guarantees lifecycle; this UI boundary serves the
      // academic providers registered by the official composition. Optional
      // modules stay guarded by capabilities and extension presence.
      provider: snapshot.provider as AcademicProviderRuntime,
      snapshot,
      isReady: snapshot.status === "ready",
      error: snapshot.error,
    }
  }, [snapshot])

  if (!value) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-lg font-semibold">{t("app.providerUnavailable")}</h1>
          <p className="text-sm text-muted-foreground">{t("app.providerUnavailableDesc")}</p>
          <DefaultSchoolButton runtime={runtime} />
        </div>
      </main>
    )
  }
  return <ProviderContext.Provider value={value}>{children}</ProviderContext.Provider>
}

function DefaultSchoolButton({ runtime }: { runtime: PluginProviderRuntimeService }) {
  const { host } = usePluginHost()
  const { providers } = usePluginServices<AcademicPluginContext>()
  const { t } = useTranslation()
  const schoolId = host.composition.defaults.schoolId
  const setSchoolId = useSettingsStore((state) => state.setSchoolId)
  if (!schoolId || !providers.hasProvider(schoolId)) return null
  return (
    <button
      type="button"
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      onClick={() => {
        setSchoolId(schoolId)
        runtime.selectSchool(schoolId)
        void runtime.initialize().catch(() => undefined)
      }}
    >
      {t("app.useDefaultSchool")}
    </button>
  )
}

export function useProviderContext(): ProviderContextValue {
  const value = useContext(ProviderContext)
  if (value === null) {
    throw new Error("useProviderContext must be used within a ProviderProvider")
  }
  return value
}
