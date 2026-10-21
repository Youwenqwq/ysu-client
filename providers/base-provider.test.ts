import { describe, expect, it } from "vitest"
import { BaseProvider } from "./base-provider"
import { ALL_CAPABILITIES, NO_CAPABILITIES } from "./capabilities"
import { ProviderError, ProviderErrorCode } from "./errors"
import type {
  AcademicCapabilities,
  AuthStatus,
  Credential,
  LoginStep1Input,
  LoginStep1Result,
} from "./types"

function makeProvider(capabilities: AcademicCapabilities) {
  return new (class extends BaseProvider {
    readonly id = "test"
    readonly name = "Test University"
    readonly capabilities = capabilities

    async prepareLogin(): Promise<void> {}
    resetLoginSession(): void {}
    async login(_credential: Credential): Promise<void> {}
    async loginStep1(_input: LoginStep1Input): Promise<LoginStep1Result> {
      throw new Error("unused")
    }
    async checkAuthStatus(): Promise<AuthStatus> {
      return { authenticated: false }
    }
    async logout(): Promise<void> {}
    isAuthenticated(): boolean {
      return false
    }
  })()
}

/** One representative defaulted method per gated capability. */
const REPRESENTATIVE_CALLS = {
  captcha: (p: BaseProvider) => p.getCaptchaImage(),
  mfa: (p: BaseProvider) => p.requestMfaCode({ username: "u", method: "sms" }),
  wechatMfa: (p: BaseProvider) => p.initiateWechatMfa(),
  studentInfo: (p: BaseProvider) => p.getStudentInfo(),
  grades: (p: BaseProvider) => p.getGrades(),
  gpa: (p: BaseProvider) => p.getGPAStats(),
  gradeAnalytics: (p: BaseProvider) => p.getGradeStatistics(),
  schedule: (p: BaseProvider) => p.getSchedule(),
  classPeriods: (p: BaseProvider) => p.getClassPeriods(),
  termCalendar: (p: BaseProvider) => p.getTermCalendar(),
  currentWeek: (p: BaseProvider) => p.getCurrentWeek(),
  exams: (p: BaseProvider) => p.getExams(),
  makeupExams: (p: BaseProvider) => p.getMakeupExamBatches(),
  laborEducation: (p: BaseProvider) => p.getLaborRecords(),
  innovationCredits: (p: BaseProvider) => p.getCreditBatches(),
  comprehensiveEval: (p: BaseProvider) => p.getComprehensiveTerms(),
  schoolSchedule: (p: BaseProvider) => p.getSchoolGradeYears(),
  trainingPlan: (p: BaseProvider) => p.getTrainingPlan(),
  evaluation: (p: BaseProvider) => p.getEvaluationTypes(),
  evaluationScorePreview: (p: BaseProvider) =>
    p.calculateEvaluationScore({ groupNo: "g", wjid: "w", evalType: "e", answers: [] }),
} as const

async function expectProviderError(invoke: () => unknown, messagePattern: RegExp): Promise<void> {
  try {
    await invoke()
    expect.unreachable("expected FEATURE_NOT_SUPPORTED")
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError)
    expect((error as ProviderError).code).toBe(ProviderErrorCode.FEATURE_NOT_SUPPORTED)
    expect((error as ProviderError).message).toMatch(messagePattern)
  }
}

describe("BaseProvider capability-gated defaults", () => {
  it.each(Object.entries(REPRESENTATIVE_CALLS))(
    "rejects %s with FEATURE_NOT_SUPPORTED when the capability is off",
    async (_capability, invoke) => {
      await expectProviderError(() => invoke(makeProvider(NO_CAPABILITIES)), /does not support/)
    }
  )

  it.each(Object.entries(REPRESENTATIVE_CALLS))(
    "flags %s as declared-but-unimplemented when the capability is on",
    async (_capability, invoke) => {
      await expectProviderError(
        () => invoke(makeProvider(ALL_CAPABILITIES)),
        /declares capability .* but does not implement/
      )
    }
  )

  it("answers checkCaptchaNeeded=false without a captcha capability", async () => {
    await expect(makeProvider(NO_CAPABILITIES).checkCaptchaNeeded("u")).resolves.toBe(false)
  })

  it("rejects checkCaptchaNeeded when captcha is declared but unimplemented", async () => {
    await expectProviderError(
      () => makeProvider(ALL_CAPABILITIES).checkCaptchaNeeded("u"),
      /declares capability .* but does not implement/
    )
  })
})
