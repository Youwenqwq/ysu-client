import { hasCapability } from "./capabilities"
import { ProviderError, ProviderErrorCode } from "./errors"
import type {
  AcademicCapabilities,
  AcademicCompletion,
  AcademicProvider,
  AcademicWarning,
  AuthStatus,
  ClassPeriod,
  ClassroomInfo,
  ClassroomQueryOptions,
  CodeItem,
  ComprehensiveIndicatorDetail,
  ComprehensiveQueryOptions,
  ComprehensiveRadarItem,
  ComprehensiveReportPage,
  ComprehensiveReportYears,
  ComprehensiveResult,
  ComprehensiveTerm,
  ComprehensiveYearScore,
  CatalogPage,
  CatalogQueryOptions,
  Competition,
  Course,
  CreditBatch,
  CreditDeclaration,
  CreditQueryOptions,
  CreditRecord,
  CreditSummary,
  Credential,
  CurrentWeek,
  CurrentWeekQueryOptions,
  EvaluationDetail,
  EvaluationDetailQuery,
  EvaluationScoreInput,
  EvaluationSubmitInput,
  EvaluationTask,
  EvaluationType,
  Exam,
  ExamQueryOptions,
  GPAQueryOptions,
  GPAStats,
  Grade,
  GradeAnalyticsQueryOptions,
  GradeDistribution,
  GradeQueryOptions,
  GradeRanking,
  GradeRankingQueryOptions,
  GradeStatistics,
  LoginStep1Input,
  LoginStep1Result,
  LaborRecord,
  LaborSummary,
  LibraryActivity,
  EnrollableActivity,
  MajorInfo,
  MakeupExamBatch,
  MakeupExamCourse,
  MakeupExamCourseQueryOptions,
  MakeupExamSignupInput,
  MfaChallenge,
  MfaRequestInput,
  MfaSubmitInput,
  PageQueryOptions,
  ProviderDiagnostics,
  ProviderMobile,
  ProviderNativeNotification,
  ScheduleQueryOptions,
  SchoolClassInfo,
  SchoolClassQueryOptions,
  StudentInfo,
  TermCalendar,
  TermCalendarQueryOptions,
  TermQueryOptions,
  TrainingPlan,
  UnscheduledCourseQueryOptions,
  WechatMfaContext,
  WechatQrPollResult,
} from "./types"

/**
 * Base class for academic providers.
 *
 * Auth-core methods (login/logout/status) stay abstract — the login page and
 * sdk-provider call them unconditionally, so every provider must implement them.
 *
 * Capability-gated methods default to throwing FEATURE_NOT_SUPPORTED: providers
 * only override what they support and declare it in `capabilities`. Declaring a
 * capability without overriding the method is an implementation bug and throws a
 * distinct message at call time.
 */
export abstract class BaseProvider implements AcademicProvider {
  abstract readonly id: string
  abstract readonly name: string
  abstract readonly capabilities: AcademicCapabilities

  readonly mobile?: ProviderMobile = undefined
  readonly diagnostics?: ProviderDiagnostics = undefined
  readonly nativeNotification?: ProviderNativeNotification = undefined

  private initialized = false

  async initialize(): Promise<void> {
    if (this.initialized) return
    await this.onInitialize()
    this.initialized = true
  }

  async reset(): Promise<void> {
    await this.onReset()
    this.initialized = false
  }

  protected async onInitialize(): Promise<void> {}

  protected async onReset(): Promise<void> {}

  private unsupported(capability: keyof AcademicCapabilities, method: string): never {
    if (hasCapability(this.capabilities, capability)) {
      throw new ProviderError(
        ProviderErrorCode.FEATURE_NOT_SUPPORTED,
        `Provider "${this.id}" declares capability "${capability}" but does not implement ${method}()`,
        undefined,
        501
      )
    }
    throw new ProviderError(
      ProviderErrorCode.FEATURE_NOT_SUPPORTED,
      `Provider "${this.id}" does not support ${method}()`,
      undefined,
      501
    )
  }

  // ─── Auth (core: abstract) ───────────────────────────────────────────── //

  abstract prepareLogin(): Promise<void>
  abstract resetLoginSession(): Promise<void> | void
  abstract login(credential: Credential): Promise<void>
  abstract loginStep1(input: LoginStep1Input): Promise<LoginStep1Result>
  abstract checkAuthStatus(): Promise<AuthStatus>
  abstract logout(): Promise<void>
  abstract isAuthenticated(): boolean

  // ─── Auth (capability-gated) ─────────────────────────────────────────── //

  async getCaptchaImage(): Promise<string | null> {
    this.unsupported("captcha", "getCaptchaImage")
  }

  async checkCaptchaNeeded(_username: string): Promise<boolean> {
    // Called unconditionally on login submit: no-captcha providers must answer false.
    if (!hasCapability(this.capabilities, "captcha")) return false
    this.unsupported("captcha", "checkCaptchaNeeded")
  }

  async requestMfaCode(_input: MfaRequestInput): Promise<MfaChallenge> {
    this.unsupported("mfa", "requestMfaCode")
  }

  async submitMfaCode(_input: MfaSubmitInput): Promise<string> {
    this.unsupported("mfa", "submitMfaCode")
  }

  async initiateWechatMfa(): Promise<WechatMfaContext> {
    this.unsupported("wechatMfa", "initiateWechatMfa")
  }

  async pollWechatMfaQr(
    _uuid: string,
    _lastErrcode?: number,
    _signal?: AbortSignal
  ): Promise<WechatQrPollResult> {
    this.unsupported("wechatMfa", "pollWechatMfaQr")
  }

  async completeWechatMfa(_code: string, _state: string): Promise<string> {
    this.unsupported("wechatMfa", "completeWechatMfa")
  }

  // ─── Academics ───────────────────────────────────────────────────────── //

  async getStudentInfo(): Promise<StudentInfo> {
    this.unsupported("studentInfo", "getStudentInfo")
  }

  async getGrades(_options?: GradeQueryOptions): Promise<Grade[]> {
    this.unsupported("grades", "getGrades")
  }

  async getGPAStats(_options?: GPAQueryOptions): Promise<GPAStats> {
    this.unsupported("gpa", "getGPAStats")
  }

  async getGradeStatistics(_options?: GradeAnalyticsQueryOptions): Promise<GradeStatistics> {
    this.unsupported("gradeAnalytics", "getGradeStatistics")
  }

  async getGradeDistribution(_options?: GradeAnalyticsQueryOptions): Promise<GradeDistribution[]> {
    this.unsupported("gradeAnalytics", "getGradeDistribution")
  }

  async getGradeRanking(_options?: GradeRankingQueryOptions): Promise<GradeRanking> {
    this.unsupported("gradeAnalytics", "getGradeRanking")
  }

  async getSchedule(_options?: ScheduleQueryOptions): Promise<Course[]> {
    this.unsupported("schedule", "getSchedule")
  }

  async getUnscheduledCourses(_options?: UnscheduledCourseQueryOptions): Promise<Course[]> {
    this.unsupported("schedule", "getUnscheduledCourses")
  }

  async getClassPeriods(): Promise<ClassPeriod[]> {
    this.unsupported("classPeriods", "getClassPeriods")
  }

  async getTermCalendar(_options?: TermCalendarQueryOptions): Promise<TermCalendar> {
    this.unsupported("termCalendar", "getTermCalendar")
  }

  async getCurrentWeek(_options?: CurrentWeekQueryOptions): Promise<CurrentWeek> {
    this.unsupported("currentWeek", "getCurrentWeek")
  }

  async getCurrentWeekNumber(_options?: CurrentWeekQueryOptions): Promise<number> {
    this.unsupported("currentWeek", "getCurrentWeekNumber")
  }

  async getExams(_options?: ExamQueryOptions): Promise<Exam[]> {
    this.unsupported("exams", "getExams")
  }

  async getMakeupExamBatches(_options?: ExamQueryOptions): Promise<MakeupExamBatch[]> {
    this.unsupported("makeupExams", "getMakeupExamBatches")
  }

  async getMakeupExamCourses(_options?: MakeupExamCourseQueryOptions): Promise<MakeupExamCourse[]> {
    this.unsupported("makeupExams", "getMakeupExamCourses")
  }

  async signupMakeupExam(_input: MakeupExamSignupInput): Promise<void> {
    this.unsupported("makeupExams", "signupMakeupExam")
  }

  async getLaborRecords(): Promise<LaborRecord[]> {
    this.unsupported("laborEducation", "getLaborRecords")
  }

  async getLaborSummary(): Promise<LaborSummary> {
    this.unsupported("laborEducation", "getLaborSummary")
  }

  async getLaborActivities(): Promise<EnrollableActivity[]> {
    this.unsupported("laborEducation", "getLaborActivities")
  }

  async getCreditBatches(): Promise<CreditBatch[]> {
    this.unsupported("innovationCredits", "getCreditBatches")
  }

  async getCreditDeclarations(_options?: CreditQueryOptions): Promise<CreditDeclaration[]> {
    this.unsupported("innovationCredits", "getCreditDeclarations")
  }

  async getCreditRecords(_options?: CreditQueryOptions): Promise<CreditRecord[]> {
    this.unsupported("innovationCredits", "getCreditRecords")
  }

  async getAllCreditRecords(): Promise<CreditRecord[]> {
    this.unsupported("innovationCredits", "getAllCreditRecords")
  }

  async getCreditSummary(): Promise<CreditSummary> {
    this.unsupported("innovationCredits", "getCreditSummary")
  }

  async getCreditCompetitions(_options?: CatalogQueryOptions): Promise<CatalogPage<Competition>> {
    this.unsupported("innovationCredits", "getCreditCompetitions")
  }

  async getCreditLibraryActivities(
    _options?: CatalogQueryOptions
  ): Promise<CatalogPage<LibraryActivity>> {
    this.unsupported("innovationCredits", "getCreditLibraryActivities")
  }

  async getComprehensiveTerms(): Promise<ComprehensiveTerm[]> {
    this.unsupported("comprehensiveEval", "getComprehensiveTerms")
  }

  async getComprehensiveResult(_options?: ComprehensiveQueryOptions): Promise<ComprehensiveResult> {
    this.unsupported("comprehensiveEval", "getComprehensiveResult")
  }

  async getComprehensiveIndicators(
    _options?: ComprehensiveQueryOptions
  ): Promise<ComprehensiveIndicatorDetail[]> {
    this.unsupported("comprehensiveEval", "getComprehensiveIndicators")
  }

  async getComprehensiveRadar(
    _options?: ComprehensiveQueryOptions
  ): Promise<ComprehensiveRadarItem[]> {
    this.unsupported("comprehensiveEval", "getComprehensiveRadar")
  }

  async getComprehensiveYearScores(): Promise<ComprehensiveYearScore[]> {
    this.unsupported("comprehensiveEval", "getComprehensiveYearScores")
  }

  async getComprehensiveReportYears(): Promise<ComprehensiveReportYears> {
    this.unsupported("comprehensiveEval", "getComprehensiveReportYears")
  }

  async getComprehensiveReport(_options?: { year?: string }): Promise<ComprehensiveReportPage> {
    this.unsupported("comprehensiveEval", "getComprehensiveReport")
  }

  async getSchoolGradeYears(): Promise<CodeItem[]> {
    this.unsupported("schoolSchedule", "getSchoolGradeYears")
  }

  async getSchoolDepartments(): Promise<CodeItem[]> {
    this.unsupported("schoolSchedule", "getSchoolDepartments")
  }

  async getSchoolMajors(_department?: string): Promise<MajorInfo[]> {
    this.unsupported("schoolSchedule", "getSchoolMajors")
  }

  async getSchoolClasses(_options?: SchoolClassQueryOptions): Promise<SchoolClassInfo[]> {
    this.unsupported("schoolSchedule", "getSchoolClasses")
  }

  async getSchoolClassSchedule(_classId: string, _options?: ExamQueryOptions): Promise<Course[]> {
    this.unsupported("schoolSchedule", "getSchoolClassSchedule")
  }

  async getSchoolCampuses(): Promise<CodeItem[]> {
    this.unsupported("schoolSchedule", "getSchoolCampuses")
  }

  async getSchoolBuildings(_campus?: string): Promise<CodeItem[]> {
    this.unsupported("schoolSchedule", "getSchoolBuildings")
  }

  async getSchoolClassrooms(_options?: ClassroomQueryOptions): Promise<ClassroomInfo[]> {
    this.unsupported("schoolSchedule", "getSchoolClassrooms")
  }

  async getSchoolClassroomSchedule(_code: string, _options?: ExamQueryOptions): Promise<Course[]> {
    this.unsupported("schoolSchedule", "getSchoolClassroomSchedule")
  }

  async getTrainingPlan(_options?: PageQueryOptions): Promise<TrainingPlan[]> {
    this.unsupported("trainingPlan", "getTrainingPlan")
  }

  async getAcademicCompletion(): Promise<AcademicCompletion> {
    this.unsupported("trainingPlan", "getAcademicCompletion")
  }

  async getAcademicWarnings(): Promise<AcademicWarning[]> {
    this.unsupported("trainingPlan", "getAcademicWarnings")
  }

  // ─── Evaluation ──────────────────────────────────────────────────────── //

  async getEvaluationTypes(_options?: TermQueryOptions): Promise<EvaluationType[]> {
    this.unsupported("evaluation", "getEvaluationTypes")
  }

  async getPendingEvaluations(
    _evalType: string,
    _options?: TermQueryOptions
  ): Promise<EvaluationTask[]> {
    this.unsupported("evaluation", "getPendingEvaluations")
  }

  async getEvaluationTasks(_options?: TermQueryOptions): Promise<EvaluationTask[]> {
    this.unsupported("evaluation", "getEvaluationTasks")
  }

  async getEvaluationDetail(_query: EvaluationDetailQuery): Promise<EvaluationDetail> {
    this.unsupported("evaluation", "getEvaluationDetail")
  }

  async calculateEvaluationScore(_input: EvaluationScoreInput): Promise<Record<string, unknown>> {
    this.unsupported("evaluationScorePreview", "calculateEvaluationScore")
  }

  async submitEvaluation(_input: EvaluationSubmitInput): Promise<void> {
    this.unsupported("evaluation", "submitEvaluation")
  }
}
