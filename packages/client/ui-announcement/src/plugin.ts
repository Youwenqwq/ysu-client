import { definePlugin, PLUGIN_API_VERSION, type PluginConfig } from "@orahako/sdk"
import { blurActiveElement } from "@orahako/ui-primitives"
import { AnnouncementDialog, type AnnouncementDialogInject } from "./dialog"
import { announcementDictionary } from "./dictionary"
import { ConfiguredAnnouncementService } from "./service"
import { announcementStore } from "./store"

export const ANNOUNCEMENT_PLUGIN_ID = "orahako.announcement"

export interface AnnouncementPluginConfig extends PluginConfig {
  readonly endpoint?: string
}

export const announcementConfigSchema = {
  type: "object",
  properties: {
    endpoint: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const

export const announcementPlugin = definePlugin({
  manifest: {
    id: ANNOUNCEMENT_PLUGIN_ID,
    name: "应用公告",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "runtime",
    provides: ["announcement"],
    providerIndependent: true,
    entry: "index.js",
    inject: ["slots", "i18n", "storage"],
  },
  inject: ["slots", "i18n", "storage"] as const,
  configSchema: announcementConfigSchema,
  apply(ctx, config: AnnouncementPluginConfig = {}) {
    const service = new ConfiguredAnnouncementService({
      endpoint: config.endpoint,
      storage: ctx.storage.local,
    })
    const storeInstance = announcementStore.create()
    let disposed = false

    ctx.effect(() => () => {
      disposed = true
      service.dispose()
      storeInstance.dispose()
    })

    ctx.i18n.register(announcementDictionary)
    ctx.set("announcement", service)

    ctx.slots.inject("shell.overlay", () =>
      ctx.slots.register(
        {
          id: "announcement-dialog",
          slot: "shell.overlay",
          dictionary: announcementDictionary,
          store: storeInstance,
          inject: (): AnnouncementDialogInject => ({
            dismiss: (id: string) => {
              service.dismiss(id)
            },
          }),
        },
        AnnouncementDialog
      )
    )

    if (service.endpoint) {
      void service.check().then((item) => {
        if (disposed || !item) return
        blurActiveElement()
        storeInstance.actions.present(item)
      })
    }
  },
})
