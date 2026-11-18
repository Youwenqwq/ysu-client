import { hasSlice, supportsPlugin, type AcademicSliceKey } from "@orahako/academic-sdk"
import { definePlugin, PLUGIN_API_VERSION, type NavigationFilterContext } from "@orahako/sdk"

export const providerSupportRuntimePlugin = definePlugin({
  manifest: {
    id: "orahako.runtime.provider-support",
    name: "Academic provider support policy",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    entry: "index.js",
    description:
      "Reconciles feature plugin lifecycle and navigation visibility against school provider support.",
    inject: ["provider", "pluginManager", "navigation"],
  },
  inject: ["provider", "pluginManager", "navigation"],
  apply(ctx) {
    const providerDisabledIds = new Set<string>()
    let supportedPlugins = ctx.provider.getSnapshot().provider?.supportedPlugins
    let revision = 0
    let disposed = false
    let queue = Promise.resolve()

    const navigationPredicate = (entry: NavigationFilterContext): boolean => {
      const activeProvider = ctx.provider.getSnapshot().provider
      if (!supportsPlugin(activeProvider?.supportedPlugins, entry.pluginId)) {
        return false
      }
      if (entry.requiresProvider !== false && entry.capability) {
        return (
          activeProvider !== null && hasSlice(activeProvider, entry.capability as AcademicSliceKey)
        )
      }
      return true
    }

    let disposeFilter = ctx.navigation.registerFilter(navigationPredicate)

    const refreshNavigationFilter = (): void => {
      if (disposed) return
      disposeFilter()
      disposeFilter = ctx.navigation.registerFilter(navigationPredicate)
    }

    const reconcile = async (): Promise<void> => {
      if (disposed) return
      const current = ++revision
      const states = ctx.pluginManager.getSnapshot()
      const registered = new Set(states.map((state) => state.manifest.id))
      for (const id of Array.from(providerDisabledIds)) {
        if (!registered.has(id)) {
          providerDisabledIds.delete(id)
        }
      }

      for (const state of states) {
        if (disposed || current !== revision) return
        const { manifest } = state
        if (
          manifest.kind !== "feature" ||
          manifest.providerIndependent ||
          ctx.pluginManager.isProtected(manifest.id)
        ) {
          continue
        }

        const id = manifest.id
        if (!supportsPlugin(supportedPlugins, id)) {
          if (state.status !== "disabled") {
            providerDisabledIds.add(id)
            ctx.pluginManager.suspend(id)
          }
          continue
        }

        if (!providerDisabledIds.has(id) || ctx.pluginManager.isUserDisabled(id)) {
          continue
        }

        if (state.status === "active") {
          providerDisabledIds.delete(id)
          continue
        }

        try {
          await ctx.pluginManager.enable(id)
          if (!disposed && current === revision) {
            providerDisabledIds.delete(id)
          }
        } catch {
          // Leave failed plugin state visible in pluginManager without blocking other features.
        }
      }
    }

    const schedule = (): void => {
      if (disposed) return
      queue = queue.then(reconcile).catch(() => undefined)
    }

    ctx.on("provider/changed", (snapshot) => {
      supportedPlugins = snapshot.provider?.supportedPlugins
      refreshNavigationFilter()
      schedule()
    })

    const unsubscribeManager = ctx.pluginManager.state.subscribe(schedule)

    ctx.effect(() => () => {
      disposed = true
      revision += 1
      unsubscribeManager()
      disposeFilter()
    })

    schedule()
  },
})
