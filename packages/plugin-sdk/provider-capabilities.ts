/**
 * @fileoverview Capability declaration utilities for AcademicProvider.
 */

import { ProviderError, ProviderErrorCode } from "./provider-errors"
import type { AcademicCapabilities, AcademicProvider } from "./academic"

export const ALL_CAPABILITIES: AcademicCapabilities = {
  auth: true,
  captcha: true,
  mfa: true,
  wechatMfa: true,
  grades: true,
  gradeAnalytics: true,
  schedule: true,
  labSchedule: true,
  exams: true,
  makeupExams: true,
  laborEducation: true,
  innovationCredits: true,
  comprehensiveEval: true,
  schoolSchedule: true,
  gpa: true,
  evaluation: true,
  evaluationScorePreview: true,
  trainingPlan: true,
  studentInfo: true,
  currentWeek: true,
  classPeriods: true,
  termCalendar: true,
  mobileSignin: true,
  ecard: true,
  meter: true,
  epay: true,
}

export const NO_CAPABILITIES: AcademicCapabilities = {
  auth: false,
  captcha: false,
  mfa: false,
  wechatMfa: false,
  grades: false,
  gradeAnalytics: false,
  schedule: false,
  labSchedule: false,
  exams: false,
  makeupExams: false,
  laborEducation: false,
  innovationCredits: false,
  comprehensiveEval: false,
  schoolSchedule: false,
  gpa: false,
  evaluation: false,
  evaluationScorePreview: false,
  trainingPlan: false,
  studentInfo: false,
  currentWeek: false,
  classPeriods: false,
  termCalendar: false,
  mobileSignin: false,
  ecard: false,
  meter: false,
  epay: false,
}

export function hasCapability(
  capabilities: AcademicCapabilities,
  key: keyof AcademicCapabilities
): boolean {
  return capabilities[key] === true
}

/**
 * Whether a provider allows the plugin with `pluginId`.
 *
 * `supportedPlugins` is an explicit allowlist: `undefined` allows every plugin
 * (the historical behaviour) while an array — including an empty one — only
 * allows the listed manifest ids.
 */
export function supportsPlugin(
  supportedPlugins: readonly string[] | undefined,
  pluginId: string
): boolean {
  return supportedPlugins === undefined || supportedPlugins.includes(pluginId)
}

export function assertCapability(
  provider: Pick<AcademicProvider, "id" | "capabilities">,
  key: keyof AcademicCapabilities
): void {
  if (!hasCapability(provider.capabilities, key)) {
    throw new ProviderError(
      ProviderErrorCode.FEATURE_NOT_SUPPORTED,
      `Provider "${provider.id}" does not support ${key}`,
      undefined,
      501
    )
  }
}

export function getEnabledCapabilities(capabilities: AcademicCapabilities): string[] {
  return (Object.keys(capabilities) as (keyof AcademicCapabilities)[]).filter(
    (key) => capabilities[key] === true
  )
}
