/**
 * @fileoverview Capability declaration utilities for AcademicProvider.
 */

import { ProviderError, ProviderErrorCode } from "./provider-errors"
import type { AcademicCapabilities, AcademicProvider } from "./academic"

/** Known built-in capability keys; the provider record itself stays open. */
const BUILT_IN_CAPABILITIES = [
  "auth",
  "captcha",
  "mfa",
  "wechatMfa",
  "grades",
  "gradeAnalytics",
  "schedule",
  "labSchedule",
  "exams",
  "makeupExams",
  "laborEducation",
  "innovationCredits",
  "comprehensiveEval",
  "schoolSchedule",
  "gpa",
  "evaluation",
  "evaluationScorePreview",
  "trainingPlan",
  "studentInfo",
  "currentWeek",
  "classPeriods",
  "termCalendar",
  "mobileSignin",
  "ecard",
  "meter",
  "epay",
] as const

/** Every built-in capability enabled. Unknown/open keys stay disabled. */
export const ALL_CAPABILITIES: AcademicCapabilities = Object.fromEntries(
  BUILT_IN_CAPABILITIES.map((capability) => [capability, true])
)

/** No capability enabled; absence is the canonical "unsupported" state. */
export const NO_CAPABILITIES: AcademicCapabilities = {}

export function hasCapability(
  capabilities: AcademicCapabilities | undefined,
  key: string
): boolean {
  return capabilities?.[key] === true
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
  key: string
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

/** Method names contributed by the optional provider modules. */
type ProviderMethod = ({
  [K in keyof AcademicProvider]: NonNullable<AcademicProvider[K]> extends (
    ...args: never[]
  ) => unknown
    ? K
    : never
}[keyof AcademicProvider]) &
  keyof AcademicProvider

/** Whether a provider implements an optional module method at runtime. */
export function hasProviderMethod<K extends ProviderMethod>(
  provider: AcademicProvider,
  method: K
): boolean {
  return typeof provider[method] === "function"
}

/**
 * Narrows an optional module method to a callable function.
 *
 * Consumers that need a module method without a capability gate use this
 * instead of scattering non-null assertions; missing modules fail with the
 * same `FEATURE_NOT_SUPPORTED` contract as capability-gated base defaults.
 */
export function requireProviderMethod<K extends ProviderMethod>(
  provider: AcademicProvider,
  method: K
): NonNullable<AcademicProvider[K]> {
  const value = provider[method]
  if (typeof value !== "function") {
    throw new ProviderError(
      ProviderErrorCode.FEATURE_NOT_SUPPORTED,
      `Provider "${provider.id}" does not implement ${String(method)}()`,
      undefined,
      501
    )
  }
  return value as NonNullable<AcademicProvider[K]>
}

export function getEnabledCapabilities(capabilities: AcademicCapabilities): string[] {
  return Object.keys(capabilities).filter((key) => capabilities[key] === true)
}
