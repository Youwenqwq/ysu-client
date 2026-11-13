import type {
  AcademicCapabilities,
  AuthStatus,
  ClassPeriod,
  Course,
  Credential,
  CurrentWeek,
  CurrentWeekQueryOptions,
  Exam,
  ExamQueryOptions,
  GPAStats,
  Grade,
  GradeQueryOptions,
  LoginStep1Input,
  LoginStep1Result,
  ScheduleQueryOptions,
  StudentInfo,
  TermCalendar,
  TermCalendarQueryOptions,
  UnscheduledCourseQueryOptions,
} from "@orahako/plugin-sdk/academic"
import { BaseProvider } from "@orahako/plugin-sdk/provider-base"
import { ProviderError, ProviderErrorCode } from "@orahako/plugin-sdk/provider-errors"
import { clearAllCache, useAuthStore, useRefreshStore } from "@orahako/plugin-sdk/host"
import { currentWeekFromContext } from "./protocol/mappers"
import { ZMUClient } from "./protocol/client"

const capabilities: AcademicCapabilities = {
  auth: true,
  captcha: true,
  mfa: false,
  wechatMfa: false,
  grades: true,
  gradeAnalytics: false,
  schedule: true,
  labSchedule: false,
  exams: true,
  makeupExams: false,
  laborEducation: false,
  innovationCredits: false,
  comprehensiveEval: false,
  schoolSchedule: false,
  gpa: true,
  evaluation: false,
  evaluationScorePreview: false,
  trainingPlan: false,
  studentInfo: true,
  currentWeek: true,
  classPeriods: true,
  termCalendar: true,
  mobileSignin: false,
  ecard: false,
  meter: false,
  epay: false,
}

function rounded(value: number): { text: string; value: number } | undefined {
  if (!Number.isFinite(value)) return undefined
  const normalized = Math.round(value * 100) / 100
  return { text: normalized.toFixed(2), value: normalized }
}

export class ZMUProvider extends BaseProvider {
  readonly id = "zmu"
  readonly name = "遵义医科大学"
  readonly capabilities = capabilities
  readonly supportedPlugins = [
    "orahako.overview",
    "orahako.schedule",
    "orahako.grades",
    "orahako.exams",
    "orahako.student-info",
    "orahako.skbird",
  ] as const
  private readonly client: ZMUClient

  constructor(client = new ZMUClient()) {
    super()
    this.client = client
  }

  protected async onInitialize(): Promise<void> {
    const state = useAuthStore.getState()
    const credential = state.credentialsBySchool[this.id]?.credential ?? state.credential
    if (!credential) return
    try {
      this.client.restore(credential)
      if (!(await this.client.hasSession())) useAuthStore.getState().clearCredential(this.id)
    } catch {
      this.client.reset()
      useAuthStore.getState().clearCredential(this.id)
    }
  }

  protected async onReset(): Promise<void> {
    this.client.reset()
    clearAllCache()
    useRefreshStore.setState({ count: 0, stale: 0 })
  }

  async prepareLogin(): Promise<void> {
    await this.client.prepareLogin()
  }

  resetLoginSession(): void {
    this.client.reset()
  }

  getCaptchaUrl(): string | null {
    return this.client.captchaUrl
  }

  async checkCaptchaNeeded(_username: string): Promise<boolean> {
    await this.client.refreshCaptcha()
    return true
  }

  async login(credential: Credential): Promise<void> {
    if (!this.client.captchaUrl) {
      this.resetLoginSession()
      await this.prepareLogin()
      await this.client.refreshCaptcha()
      throw new ProviderError(
        ProviderErrorCode.AUTH_CAPTCHA_REQUIRED,
        "Captcha required",
        undefined,
        403
      )
    }
    const captcha = credential.metadata?.captcha
    if (typeof captcha !== "string" || !captcha) {
      throw new ProviderError(
        ProviderErrorCode.AUTH_CAPTCHA_REQUIRED,
        "Captcha required",
        undefined,
        403
      )
    }
    const result = await this.loginStep1({
      username: credential.username,
      password: credential.password,
      captcha,
    })
    if (result.credential) {
      useAuthStore.getState().setCredential(result.credential, result.username, this.id)
    }
  }

  async loginStep1(input: LoginStep1Input): Promise<LoginStep1Result> {
    if (!input.captcha) {
      throw new ProviderError(
        ProviderErrorCode.AUTH_CAPTCHA_REQUIRED,
        "Captcha required",
        undefined,
        403
      )
    }
    const result = await this.client.login(input.username, input.password, input.captcha)
    if (result.code >= 0) {
      return {
        authenticated: true,
        needsMfa: false,
        username: input.username,
        credential: this.client.credential,
      }
    }
    if (result.code === -302) {
      throw new ProviderError(
        ProviderErrorCode.AUTH_MFA_REQUIRED,
        "遵医教务要求微信扫码二次认证，当前最小适配不支持该步骤",
        result,
        403
      )
    }
    if (result.message.includes("验证码")) {
      throw new ProviderError(ProviderErrorCode.AUTH_CAPTCHA_REQUIRED, result.message, result, 403)
    }
    throw new ProviderError(
      ProviderErrorCode.AUTH_INVALID_CREDENTIAL,
      result.message || "遵医教务登录失败",
      result,
      401
    )
  }

  async checkAuthStatus(): Promise<AuthStatus> {
    if (!useAuthStore.getState().credential) return { authenticated: false }
    return { authenticated: await this.client.checkAuthStatus() }
  }

  async logout(): Promise<void> {
    try {
      await this.client.logout()
    } catch {
      // 本地登出不因服务端会话已失效而阻塞。
    } finally {
      await this.reset()
      useAuthStore.getState().clearCredential(this.id)
    }
  }

  isAuthenticated(): boolean {
    return useAuthStore.getState().isAuthenticated
  }

  async getStudentInfo(): Promise<StudentInfo> {
    return this.client.getStudentInfo()
  }

  async getGrades(options?: GradeQueryOptions): Promise<Grade[]> {
    return this.client.getGrades(options)
  }

  async getGPAStats(): Promise<GPAStats> {
    const grades = (await this.getGrades()).filter(
      (grade) => grade.isValid && grade.numericCredit !== undefined
    )
    const creditSum = (rows: Grade[]) =>
      rows.reduce((sum, grade) => sum + (grade.numericCredit ?? 0), 0)
    const scored = grades.filter((grade) => grade.numericScore !== undefined)
    const withPoints = grades.filter((grade) => grade.numericGradePoint !== undefined)
    const weightedAvg = rounded(
      scored.reduce((sum, grade) => sum + grade.numericScore! * grade.numericCredit!, 0) /
        creditSum(scored)
    )
    const arithmeticAvg = rounded(
      scored.reduce((sum, grade) => sum + grade.numericScore!, 0) / scored.length
    )
    const gpa = rounded(
      withPoints.reduce((sum, grade) => sum + grade.numericGradePoint! * grade.numericCredit!, 0) /
        creditSum(withPoints)
    )
    return {
      gpaInitial: gpa?.text,
      numericGpaInitial: gpa?.value,
      gpaHighest: gpa?.text,
      numericGpaHighest: gpa?.value,
      weightedAvg: weightedAvg?.text,
      numericWeightedAvg: weightedAvg?.value,
      arithmeticAvg: arithmeticAvg?.text,
      numericArithmeticAvg: arithmeticAvg?.value,
    }
  }

  async getSchedule(options?: ScheduleQueryOptions): Promise<Course[]> {
    return this.client.getSchedule(options)
  }

  async getUnscheduledCourses(_options?: UnscheduledCourseQueryOptions): Promise<Course[]> {
    throw new ProviderError(
      ProviderErrorCode.FEATURE_NOT_SUPPORTED,
      "ZMU does not expose an unscheduled-course query"
    )
  }

  async getClassPeriods(): Promise<ClassPeriod[]> {
    return Array.from({ length: 12 }, (_, index) => ({
      name: `第${String(index + 1).padStart(2, "0")}节`,
      section: index + 1,
      isInUse: true,
    }))
  }

  async getTermCalendar(options?: TermCalendarQueryOptions): Promise<TermCalendar> {
    const current = await this.getCurrentWeek(options)
    const start = new Date(`${current.weekStartDate}T12:00:00Z`)
    start.setUTCDate(start.getUTCDate() - (current.week - 1) * 7)
    return {
      semester: current.semester,
      startDate: start.toISOString().slice(0, 10),
      totalWeeks: 24,
      teachingWeeks: 24,
      isInUse: true,
      raw: current.raw,
    }
  }

  async getCurrentWeek(options?: CurrentWeekQueryOptions): Promise<CurrentWeek> {
    const context = await this.client.getTermContext(options?.semester)
    const date =
      options?.date ??
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date())
    return currentWeekFromContext(context, date)
  }

  async getCurrentWeekNumber(options?: CurrentWeekQueryOptions): Promise<number> {
    return (await this.getCurrentWeek(options)).week
  }

  async getExams(options?: ExamQueryOptions): Promise<Exam[]> {
    return this.client.getExams(options)
  }
}
