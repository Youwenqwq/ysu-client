import {
  definePlugin,
  supportsPlugin,
  type AcademicProvider,
  type CompositionPlugin,
  type PluginManagerService,
  type PluginProviderRuntimeService,
} from "@orahako/plugin-sdk"

export const providerSupportRuntimePlugin: CompositionPlugin = {
  manifest: {
    id: "orahako.runtime.provider-support",
    name: "Academic provider support policy",
    version: "1.0.0",
    apiVersion: 2,
    kind: "runtime",
    entry: "index.js",
    inject: ["provider", "pluginManager"],
  },
  definition: definePlugin((ctx) => {
    const provider = ctx.get("provider") as PluginProviderRuntimeService
    const manager = ctx.get("pluginManager") as PluginManagerService
    const providerDisabledIds = new Set<string>()
    let supportedPlugins: AcademicProvider["supportedPlugins"] = (
      provider.getSnapshot().provider as AcademicProvider | null
    )?.supportedPlugins
    let revision = 0
    let queue = Promise.resolve()

    const reconcile = async (): Promise<void> => {
      const current = ++revision
      const states = manager.getSnapshot()
      const registered = new Set(states.map((state) => state.manifest.id))
      for (const id of providerDisabledIds) {
        if (!registered.has(id)) providerDisabledIds.delete(id)
      }
      for (const state of states) {
        if (current !== revision) return
        const { manifest } = state
        if (
          manifest.kind !== "feature" ||
          manifest.providerIndependent ||
          manager.isProtected(manifest.id)
        ) {
          continue
        }
        const id = manifest.id
        if (!supportsPlugin(supportedPlugins, id)) {
          if (state.status !== "disabled") {
            providerDisabledIds.add(id)
            manager.suspend(id)
          }
          continue
        }
        if (!providerDisabledIds.has(id) || manager.isUserDisabled(id)) {
          continue
        }
        try {
          await manager.enable(id)
          if (current === revision) providerDisabledIds.delete(id)
        } catch {
          // The runtime exposes the failed state; other features remain usable.
        }
      }
    }

    const schedule = (): void => {
      queue = queue.then(reconcile).catch(() => undefined)
    }
    ctx.on("provider/changed", (snapshot) => {
      supportedPlugins = (snapshot.provider as AcademicProvider | null)?.supportedPlugins
      schedule()
    })
    const unsubscribe = manager.subscribe(schedule)
    ctx.on("dispose", () => {
      revision += 1
      unsubscribe()
    })
    schedule()
  }),
}
