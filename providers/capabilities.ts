/**
 * @fileoverview Capability declaration utilities for AcademicProvider.
 */

import { ProviderError, ProviderErrorCode } from "./errors";
import type { AcademicCapabilities, AcademicProvider } from "./types";

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
  gpa: true,
  evaluation: true,
  evaluationScorePreview: true,
  trainingPlan: true,
  studentInfo: true,
  currentWeek: true,
  classPeriods: true,
  termCalendar: true,
  mobileSignin: true,
};

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
  gpa: false,
  evaluation: false,
  evaluationScorePreview: false,
  trainingPlan: false,
  studentInfo: false,
  currentWeek: false,
  classPeriods: false,
  termCalendar: false,
  mobileSignin: false,
};

export function hasCapability(
  capabilities: AcademicCapabilities,
  key: keyof AcademicCapabilities,
): boolean {
  return capabilities[key] === true;
}

export function assertCapability(
  provider: Pick<AcademicProvider, "id" | "capabilities">,
  key: keyof AcademicCapabilities,
): void {
  if (!hasCapability(provider.capabilities, key)) {
    throw new ProviderError(
      ProviderErrorCode.FEATURE_NOT_SUPPORTED,
      `Provider "${provider.id}" does not support ${key}`,
      undefined,
      501,
    );
  }
}

export function getEnabledCapabilities(
  capabilities: AcademicCapabilities,
): string[] {
  return (Object.keys(capabilities) as (keyof AcademicCapabilities)[]).filter(
    (key) => capabilities[key] === true,
  );
}
