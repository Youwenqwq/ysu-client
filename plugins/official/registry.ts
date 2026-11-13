import type { PluginDefinition, PluginManifest } from "@orahako/plugin-sdk"
import { definition as officialShell, manifest as officialShellManifest } from "./shell"
import { definition as onboarding, manifest as onboardingManifest } from "./onboarding"
import { definition as ysuProvider, manifest as ysuProviderManifest } from "./ysu"
import { definition as defaultTheme, manifest as defaultThemeManifest } from "./theme-default"
import { definition as notifications, manifest as notificationsManifest } from "./notifications"
import { definition as meter, manifest as meterManifest } from "./meter"
import { definition as evaluation, manifest as evaluationManifest } from "./evaluation"
import { definition as trainingPlan, manifest as trainingPlanManifest } from "./training-plan"
import { definition as labor, manifest as laborManifest } from "./labor"
import { definition as credits, manifest as creditsManifest } from "./credits"
import { definition as comprehensive, manifest as comprehensiveManifest } from "./comprehensive"
import { definition as studentInfo, manifest as studentInfoManifest } from "./student-info"
import { definition as exams, manifest as examsManifest } from "./exams"
import { definition as makeupExams, manifest as makeupExamsManifest } from "./makeup-exams"
import { definition as grades, manifest as gradesManifest } from "./grades"
import { definition as ecard, manifest as ecardManifest } from "./ecard"
import { definition as epay, manifest as epayManifest } from "./epay"
import { definition as schedule, manifest as scheduleManifest } from "./schedule"
import { definition as schoolSchedule, manifest as schoolScheduleManifest } from "./school-schedule"
import { definition as overview, manifest as overviewManifest } from "./overview"

export interface OfficialPlugin {
  manifest: PluginManifest
  definition: PluginDefinition
}

export const OFFICIAL_PLUGINS: readonly OfficialPlugin[] = [
  { manifest: officialShellManifest, definition: officialShell },
  { manifest: onboardingManifest, definition: onboarding },
  { manifest: ysuProviderManifest, definition: ysuProvider },
  { manifest: notificationsManifest, definition: notifications },
  { manifest: defaultThemeManifest, definition: defaultTheme },
  { manifest: meterManifest, definition: meter },
  { manifest: evaluationManifest, definition: evaluation },
  { manifest: trainingPlanManifest, definition: trainingPlan },
  { manifest: laborManifest, definition: labor },
  { manifest: creditsManifest, definition: credits },
  { manifest: comprehensiveManifest, definition: comprehensive },
  { manifest: studentInfoManifest, definition: studentInfo },
  { manifest: examsManifest, definition: exams },
  { manifest: makeupExamsManifest, definition: makeupExams },
  { manifest: gradesManifest, definition: grades },
  { manifest: ecardManifest, definition: ecard },
  { manifest: epayManifest, definition: epay },
  { manifest: scheduleManifest, definition: schedule },
  { manifest: schoolScheduleManifest, definition: schoolSchedule },
  { manifest: overviewManifest, definition: overview },
]
