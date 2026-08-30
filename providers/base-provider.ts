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

  abstract prepareLogin(): Promise<void>
  abstract resetLoginSession(): Promise<void> | void
  abstract getCaptchaUrl(): string | null
  abstract checkCaptchaNeeded(username: string): Promise<boolean>
  abstract login(credential: Credential): Promise<void>
  abstract loginStep1(input: LoginStep1Input): Promise<LoginStep1Result>
  abstract requestMfaCode(input: MfaRequestInput): Promise<MfaChallenge>
  abstract submitMfaCode(input: MfaSubmitInput): Promise<string>
  abstract initiateWechatMfa(): Promise<WechatMfaContext>
  abstract pollWechatMfaQr(
    uuid: string,
    lastErrcode?: number,
    signal?: AbortSignal
  ): Promise<WechatQrPollResult>
  abstract completeWechatMfa(code: string, state: string): Promise<string>
  abstract checkAuthStatus(): Promise<AuthStatus>
  abstract logout(): Promise<void>
  abstract isAuthenticated(): boolean
  abstract getStudentInfo(): Promise<StudentInfo>
  abstract getGrades(options?: GradeQueryOptions): Promise<Grade[]>
  abstract getGPAStats(options?: GPAQueryOptions): Promise<GPAStats>
  abstract getGradeStatistics(options?: GradeAnalyticsQueryOptions): Promise<GradeStatistics>
  abstract getGradeDistribution(options?: GradeAnalyticsQueryOptions): Promise<GradeDistribution[]>
  abstract getGradeRanking(options?: GradeRankingQueryOptions): Promise<GradeRanking>
  abstract getSchedule(options?: ScheduleQueryOptions): Promise<Course[]>
  abstract getUnscheduledCourses(options?: UnscheduledCourseQueryOptions): Promise<Course[]>
  abstract getClassPeriods(): Promise<ClassPeriod[]>
  abstract getTermCalendar(options?: TermCalendarQueryOptions): Promise<TermCalendar>
  abstract getCurrentWeek(options?: CurrentWeekQueryOptions): Promise<CurrentWeek>
  abstract getCurrentWeekNumber(options?: CurrentWeekQueryOptions): Promise<number>
  abstract getExams(options?: ExamQueryOptions): Promise<Exam[]>
  abstract getMakeupExamBatches(options?: ExamQueryOptions): Promise<MakeupExamBatch[]>
  abstract getMakeupExamCourses(options?: MakeupExamCourseQueryOptions): Promise<MakeupExamCourse[]>
  abstract signupMakeupExam(input: MakeupExamSignupInput): Promise<void>
  abstract getLaborRecords(): Promise<LaborRecord[]>
  abstract getLaborSummary(): Promise<LaborSummary>
  abstract getLaborActivities(): Promise<EnrollableActivity[]>
  abstract getCreditBatches(): Promise<CreditBatch[]>
  abstract getCreditDeclarations(options?: CreditQueryOptions): Promise<CreditDeclaration[]>
  abstract getCreditRecords(options?: CreditQueryOptions): Promise<CreditRecord[]>
  abstract getAllCreditRecords(): Promise<CreditRecord[]>
  abstract getCreditSummary(): Promise<CreditSummary>
  abstract getCreditCompetitions(options?: CatalogQueryOptions): Promise<CatalogPage<Competition>>
  abstract getCreditLibraryActivities(
    options?: CatalogQueryOptions
  ): Promise<CatalogPage<LibraryActivity>>
  abstract getComprehensiveTerms(): Promise<ComprehensiveTerm[]>
  abstract getComprehensiveResult(options?: ComprehensiveQueryOptions): Promise<ComprehensiveResult>
  abstract getComprehensiveIndicators(
    options?: ComprehensiveQueryOptions
  ): Promise<ComprehensiveIndicatorDetail[]>
  abstract getComprehensiveRadar(
    options?: ComprehensiveQueryOptions
  ): Promise<ComprehensiveRadarItem[]>
  abstract getComprehensiveYearScores(): Promise<ComprehensiveYearScore[]>
  abstract getComprehensiveReportYears(): Promise<ComprehensiveReportYears>
  abstract getComprehensiveReport(options?: { year?: string }): Promise<ComprehensiveReportPage>
  abstract getSchoolGradeYears(): Promise<CodeItem[]>
  abstract getSchoolDepartments(): Promise<CodeItem[]>
  abstract getSchoolMajors(department?: string): Promise<MajorInfo[]>
  abstract getSchoolClasses(options?: SchoolClassQueryOptions): Promise<SchoolClassInfo[]>
  abstract getSchoolClassSchedule(classId: string, options?: ExamQueryOptions): Promise<Course[]>
  abstract getSchoolCampuses(): Promise<CodeItem[]>
  abstract getSchoolBuildings(campus?: string): Promise<CodeItem[]>
  abstract getSchoolClassrooms(options?: ClassroomQueryOptions): Promise<ClassroomInfo[]>
  abstract getSchoolClassroomSchedule(code: string, options?: ExamQueryOptions): Promise<Course[]>
  abstract getTrainingPlan(options?: PageQueryOptions): Promise<TrainingPlan[]>
  abstract getAcademicCompletion(): Promise<AcademicCompletion>
  abstract getAcademicWarnings(): Promise<AcademicWarning[]>
  abstract getEvaluationTypes(options?: TermQueryOptions): Promise<EvaluationType[]>
  abstract getPendingEvaluations(
    evalType: string,
    options?: TermQueryOptions
  ): Promise<EvaluationTask[]>
  abstract getEvaluationTasks(options?: TermQueryOptions): Promise<EvaluationTask[]>
  abstract getEvaluationDetail(query: EvaluationDetailQuery): Promise<EvaluationDetail>
  abstract calculateEvaluationScore(input: EvaluationScoreInput): Promise<Record<string, unknown>>
  abstract submitEvaluation(input: EvaluationSubmitInput): Promise<void>
}
