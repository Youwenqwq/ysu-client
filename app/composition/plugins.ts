import { academicRuntimePlugins } from "@orahako/academic-runtime"
import comprehensivePlugin from "@orahako/plugin-comprehensive"
import creditsPlugin from "@orahako/plugin-credits"
import ecardPlugin from "@orahako/plugin-ecard"
import epayPlugin from "@orahako/plugin-epay"
import evaluationPlugin from "@orahako/plugin-evaluation"
import examsPlugin from "@orahako/plugin-exams"
import freeRoomsPlugin from "@orahako/plugin-free-rooms"
import gradesPlugin from "@orahako/plugin-grades"
import laborPlugin from "@orahako/plugin-labor"
import makeupExamsPlugin from "@orahako/plugin-makeup-exams"
import meterPlugin from "@orahako/plugin-meter"
import notificationsPlugin from "@orahako/plugin-notifications"
import onboardingPlugin from "@orahako/plugin-onboarding"
import overviewPlugin from "@orahako/plugin-overview"
import schedulePlugin from "@orahako/plugin-schedule"
import schoolSchedulePlugin from "@orahako/plugin-school-schedule"
import studentInfoPlugin from "@orahako/plugin-student-info"
import trainingPlanPlugin from "@orahako/plugin-training-plan"
import authUiPlugin from "@orahako/plugin-ui-auth"
import ysuProviderPlugin from "@orahako/plugin-ysu-provider"
import { httpRuntimePlugin } from "@orahako/runtime-http"
import { i18nRegistryPlugin } from "@orahako/runtime-i18n"
import {
  nativeLifecycleRuntimePlugin,
  nativeRuntimePlugin,
  widgetRuntimePlugin,
} from "@orahako/runtime-native"
import { assetsRuntimePlugin, installerRuntimePlugin } from "@orahako/runtime-packages"
import { navigationRuntimePlugin, routerRuntimePlugin } from "@orahako/runtime-router"
import { settingsRegistryPlugin } from "@orahako/runtime-settings"
import { slotRegistryPlugin } from "@orahako/runtime-slots"
import { storageRuntimePlugin } from "@orahako/runtime-storage"
import { appearanceRuntimePlugin, uiRegistryPlugin } from "@orahako/runtime-ui"
import type { AnyDefinedPlugin } from "@orahako/sdk"
import themeDefaultPlugin from "@orahako/theme-default"
import { activationPlugin } from "@orahako/ui-activation"
import { analyticsPlugin } from "@orahako/ui-analytics"
import { announcementPlugin } from "@orahako/ui-announcement"
import { mfaPlugin } from "@orahako/ui-mfa"
import networkActivityPlugin from "@orahako/ui-network-activity"
import pluginManagerPlugin from "@orahako/ui-plugin-manager"
import uiProfilePlugin from "@orahako/ui-profile"
import uiSettingsPlugin from "@orahako/ui-settings"
import uiShellPlugin from "@orahako/ui-shell"
import updaterPlugin from "@orahako/ui-updater"

export const platformPlugins = [
  slotRegistryPlugin,
  uiRegistryPlugin,
  i18nRegistryPlugin,
  storageRuntimePlugin,
  appearanceRuntimePlugin,
  routerRuntimePlugin,
  navigationRuntimePlugin,
  settingsRegistryPlugin,
  httpRuntimePlugin,
  nativeRuntimePlugin,
  nativeLifecycleRuntimePlugin,
  widgetRuntimePlugin,
  assetsRuntimePlugin,
  installerRuntimePlugin,
  themeDefaultPlugin,
  uiShellPlugin,
  uiSettingsPlugin,
  uiProfilePlugin,
  pluginManagerPlugin,
  mfaPlugin,
  updaterPlugin,
  announcementPlugin,
  analyticsPlugin,
  networkActivityPlugin,
] satisfies readonly AnyDefinedPlugin[]

export const officialPlugins = [
  ...platformPlugins,
  ...academicRuntimePlugins,
  authUiPlugin,
  onboardingPlugin,
  notificationsPlugin,
  overviewPlugin,
  schedulePlugin,
  freeRoomsPlugin,
  schoolSchedulePlugin,
  gradesPlugin,
  examsPlugin,
  makeupExamsPlugin,
  studentInfoPlugin,
  trainingPlanPlugin,
  evaluationPlugin,
  ecardPlugin,
  epayPlugin,
  laborPlugin,
  creditsPlugin,
  comprehensivePlugin,
  meterPlugin,
  ysuProviderPlugin,
] satisfies readonly AnyDefinedPlugin[]

export interface OfficialPluginOptions {
  /** EdgeOne PWA deployments are the only composition that installs activation. */
  readonly activation?: boolean
}

export function createOfficialPlugins(
  options: OfficialPluginOptions = {}
): readonly AnyDefinedPlugin[] {
  return options.activation ? [...officialPlugins, activationPlugin] : officialPlugins
}
