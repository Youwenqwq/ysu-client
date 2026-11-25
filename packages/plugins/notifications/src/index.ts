import { Bell } from "lucide-react"
import { definePlugin, PLUGIN_API_VERSION } from "@orahako/sdk"
import {
  ACADEMIC_POLLING_CAPABILITY,
  AcademicPollingController,
  evaluateNotificationChannels,
  hashNotifyAccount,
  NOTIFICATIONS_CORE_CAPABILITY,
  type AcademicPollingControllerOptions,
  type ComputedPollingPlan,
  type EvaluatedNotificationChannel,
} from "./controller"
import { NotificationDebugPanel } from "./debug-panel"
import {
  NOTIFICATION_CATEGORY_CHILDREN,
  NotificationSettingsPanel,
  type NotificationSettingsInject,
} from "./settings-panel"
import "./slots"
import {
  notificationsDictionary,
  notificationSettingsStore,
  type NotificationsDictionary,
  type NotificationSettingsState,
  type NotificationSettingsStoreInstance,
} from "./store"

export const NOTIFICATIONS_PLUGIN_ID = "orahako.notifications"

export {
  ACADEMIC_POLLING_CAPABILITY,
  AcademicPollingController,
  evaluateNotificationChannels,
  hashNotifyAccount,
  NOTIFICATION_CATEGORY_CHILDREN,
  NotificationDebugPanel,
  notificationsDictionary,
  NotificationSettingsPanel,
  notificationSettingsStore,
  NOTIFICATIONS_CORE_CAPABILITY,
  type AcademicPollingControllerOptions,
  type ComputedPollingPlan,
  type EvaluatedNotificationChannel,
  type NotificationsDictionary,
  type NotificationSettingsState,
  type NotificationSettingsStoreInstance,
}

export const notificationsPlugin = definePlugin({
  manifest: {
    id: NOTIFICATIONS_PLUGIN_ID,
    name: "通知",
    version: "1.0.0",
    apiVersion: PLUGIN_API_VERSION,
    kind: "feature",
    required: true,
    entry: "index.js",
    description: "系统通知权限、动态通道后台轮询与提醒设置",
    nativeCapabilities: [NOTIFICATIONS_CORE_CAPABILITY, ACADEMIC_POLLING_CAPABILITY],
    inject: [
      "slots",
      "settings",
      "i18n",
      "storage",
      "provider",
      "session",
      "notifications",
      "native",
      "widgets",
    ],
  },
  inject: [
    "slots",
    "settings",
    "i18n",
    "storage",
    "provider",
    "session",
    "notifications",
    "native",
    "widgets",
  ] as const,
  apply(ctx) {
    const { slots, settings, i18n, storage, provider, session, notifications, native, widgets } =
      ctx
    i18n.register(notificationsDictionary)
    const store = notificationSettingsStore.create(storage)
    const controller = new AcademicPollingController({
      store,
      notifications,
      provider,
      session,
      native,
      widgets,
    })

    settings.registerCategory(
      {
        id: "notifications",
        order: 20,
        title: "通知设置",
        titleKey: "category.title",
        description: "管理通知权限、后台轮询与各类提醒",
        descriptionKey: "category.description",
        icon: Bell,
        dictionary: notificationsDictionary,
        children: NOTIFICATION_CATEGORY_CHILDREN,
        store,
        inject: (): NotificationSettingsInject => ({
          hooks: {
            provider: provider.state,
            channels: notifications.state,
            slotsSnapshot: slots.state,
          },
          isNative: () => native.isNative,
          checkBatteryOptimization: () => controller.checkBatteryOptimization(),
          requestBatteryOptimizationExemption: () => native.requestBatteryOptimizationExemption(),
          requestNotificationPermission: () => native.requestNotificationPermission(),
          togglePollingEnabled: (enabled: boolean) => controller.setPollingEnabled(enabled),
        }),
      },
      NotificationSettingsPanel
    )

    slots.inject("debug.panels", () =>
      slots.register(
        {
          id: "notification-polling-debug",
          slot: "debug.panels",
          order: 30,
          dictionary: notificationsDictionary,
          store,
          inject: () => ({
            hooks: {
              provider: provider.state,
              channels: notifications.state,
            },
            isNative: () => native.isNative,
            checkPermission: () => controller.checkNotificationPermission(),
            requestPermission: () => controller.requestNotificationPermission(),
            startPolling: () => controller.start(),
            stopPolling: () => controller.stop(),
            checkNow: () => controller.checkNow(),
            inspectPolling: () => controller.inspect(),
          }),
        },
        NotificationDebugPanel
      )
    )

    ctx.effect(() => () => {
      void controller.dispose()
      store.dispose()
    })
  },
})

export default notificationsPlugin
