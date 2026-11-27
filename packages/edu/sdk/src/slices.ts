import type { NativeNotificationChannelSpec } from "@orahako/sdk"
import { ProviderError, ProviderErrorCode } from "./errors"
import type {
  AcademicCapabilities,
  AcademicCompletion,
  AcademicWarning,
  AuthStatus,
  CatalogPage,
  CatalogQueryOptions,
  ClassPeriod,
  ClassroomInfo,
  ClassroomQueryOptions,
  CodeItem,
  Competition,
  ComprehensiveIndicatorDetail,
  ComprehensiveQueryOptions,
  ComprehensiveRadarItem,
  ComprehensiveReportPage,
  ComprehensiveReportYears,
  ComprehensiveResult,
  ComprehensiveTerm,
  ComprehensiveYearScore,
  Course,
  Credential,
  CreditBatch,
  CreditDeclaration,
  CreditQueryOptions,
  CreditRecord,
  CreditSummary,
  CurrentWeek,
  CurrentWeekQueryOptions,
  EcardSessionStatus,
  EnrollableActivity,
  EpayRecord,
  EpayRecordStatus,
  EpaySessionStatus,
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
  LaborRecord,
  LaborSummary,
  LibraryActivity,
  LoginStep1Input,
  LoginStep1Result,
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
  ProviderGPAScale,
  ProviderGradeScale,
  ProviderMobile,
  ScheduleQueryOptions,
  SchoolClassInfo,
  SchoolClassQueryOptions,
  StudentInfo,
  TermCalendar,
  TermCalendarQueryOptions,
  TermQueryOptions,
  TrainingPlan,
  UnscheduledCourseQueryOptions,
  WechatMfaProvider,
} from "./entities"

export interface AuthSlice {
  prepareLogin(): Promise<void>
  resetLoginSession(): Promise<void> | void
  login(credential: Credential): Promise<void>
  loginStep1(input: LoginStep1Input): Promise<LoginStep1Result>
  checkAuthStatus(): Promise<AuthStatus>
  isAuthenticated(): boolean
  getCaptchaUrl?(): string | null
  checkCaptchaNeeded?(username: string): Promise<boolean>
  requestMfaCode?(input: MfaRequestInput): Promise<MfaChallenge>
  submitMfaCode?(input: MfaSubmitInput): Promise<string>
  readonly wechatMfa?: WechatMfaProvider
  readonly diagnostics?: ProviderDiagnostics
}

export interface AcademicScheduleRules {
  /** IANA school timezone used to interpret offset-less academic timestamps. */
  readonly timeZone: string
  /** Last section before the lunch break; breaks are off when not configured. */
  readonly lunchAfter: number
  /** Last section before the dinner break; breaks are off when not configured. */
  readonly dinnerAfter: number
}

export interface TimetableSlice {
  getSchedule(options?: ScheduleQueryOptions): Promise<Course[]>
  getUnscheduledCourses?(options?: UnscheduledCourseQueryOptions): Promise<Course[]>
  getClassPeriods?(): Promise<ClassPeriod[]>
  getTermCalendar?(options?: TermCalendarQueryOptions): Promise<TermCalendar>
  getCurrentWeek?(options?: CurrentWeekQueryOptions): Promise<CurrentWeek>
  getCurrentWeekNumber?(options?: CurrentWeekQueryOptions): Promise<number>
  readonly hasLabSchedule?: boolean
  readonly mobile?: ProviderMobile
  /** School-local timezone and break rows for schedule presentation. */
  readonly scheduleRules?: AcademicScheduleRules
}

export interface SchoolScheduleSlice {
  getSchoolGradeYears(): Promise<CodeItem[]>
  getSchoolDepartments(): Promise<CodeItem[]>
  getSchoolMajors(department?: string): Promise<MajorInfo[]>
  getSchoolClasses(options?: SchoolClassQueryOptions): Promise<SchoolClassInfo[]>
  getSchoolClassSchedule(classId: string, options?: ExamQueryOptions): Promise<Course[]>
  getSchoolCampuses(): Promise<CodeItem[]>
  getSchoolBuildings(campus?: string): Promise<CodeItem[]>
  getSchoolClassrooms(options?: ClassroomQueryOptions): Promise<ClassroomInfo[]>
  getSchoolClassroomSchedule(code: string, options?: ExamQueryOptions): Promise<Course[]>
}

export interface GradesSlice {
  getGrades(options?: GradeQueryOptions): Promise<Grade[]>
  getGPAStats?(options?: GPAQueryOptions): Promise<GPAStats>
  getGradeStatistics?(options?: GradeAnalyticsQueryOptions): Promise<GradeStatistics>
  getGradeDistribution?(options?: GradeAnalyticsQueryOptions): Promise<GradeDistribution[]>
  getGradeRanking?(options?: GradeRankingQueryOptions): Promise<GradeRanking>
  readonly gradeScale?: ProviderGradeScale
  readonly gpaScale?: ProviderGPAScale
}

export interface ExamsSlice {
  getExams(options?: ExamQueryOptions): Promise<Exam[]>
}

export interface MakeupExamsSlice {
  getMakeupExamBatches(options?: ExamQueryOptions): Promise<MakeupExamBatch[]>
  getMakeupExamCourses(options?: MakeupExamCourseQueryOptions): Promise<MakeupExamCourse[]>
  signupMakeupExam(input: MakeupExamSignupInput): Promise<void>
}

export interface EvaluationSlice {
  getEvaluationTypes(options?: TermQueryOptions): Promise<EvaluationType[]>
  getPendingEvaluations(evalType: string, options?: TermQueryOptions): Promise<EvaluationTask[]>
  getEvaluationTasks(options?: TermQueryOptions): Promise<EvaluationTask[]>
  getEvaluationDetail(query: EvaluationDetailQuery): Promise<EvaluationDetail>
  calculateEvaluationScore?(input: EvaluationScoreInput): Promise<Record<string, unknown>>
  submitEvaluation(input: EvaluationSubmitInput): Promise<void>
}

export interface StudentProfileSlice {
  getStudentInfo(): Promise<StudentInfo>
}

export interface TrainingPlanSlice {
  getTrainingPlan(options?: PageQueryOptions): Promise<TrainingPlan[]>
  getAcademicCompletion?(): Promise<AcademicCompletion>
  recalculateAcademicCompletion?(): Promise<AcademicCompletion>
  getAcademicWarnings?(): Promise<AcademicWarning[]>
}

export interface EcardSlice {
  fetchBalance(): Promise<EcardSessionStatus>
}

export interface EpaySlice {
  fetchPayments(): Promise<EpaySessionStatus>
  recordStatus(record: EpayRecord): EpayRecordStatus
}

export interface LaborSlice {
  getLaborRecords(): Promise<LaborRecord[]>
  getLaborSummary(): Promise<LaborSummary>
  getLaborActivities(): Promise<EnrollableActivity[]>
}

export interface CreditsSlice {
  getCreditBatches(): Promise<CreditBatch[]>
  getCreditDeclarations(options?: CreditQueryOptions): Promise<CreditDeclaration[]>
  getCreditRecords(options?: CreditQueryOptions): Promise<CreditRecord[]>
  getAllCreditRecords(): Promise<CreditRecord[]>
  getCreditSummary(): Promise<CreditSummary>
  getCreditCompetitions(options?: CatalogQueryOptions): Promise<CatalogPage<Competition>>
  getCreditLibraryActivities(options?: CatalogQueryOptions): Promise<CatalogPage<LibraryActivity>>
}

export interface ComprehensiveSlice {
  getComprehensiveTerms(): Promise<ComprehensiveTerm[]>
  getComprehensiveResult(options?: ComprehensiveQueryOptions): Promise<ComprehensiveResult>
  getComprehensiveIndicators(
    options?: ComprehensiveQueryOptions
  ): Promise<ComprehensiveIndicatorDetail[]>
  getComprehensiveRadar(options?: ComprehensiveQueryOptions): Promise<ComprehensiveRadarItem[]>
  getComprehensiveYearScores(): Promise<ComprehensiveYearScore[]>
  getComprehensiveReportYears(): Promise<ComprehensiveReportYears>
  getComprehensiveReport(options?: { year?: string }): Promise<ComprehensiveReportPage>
}

export interface NativePollingSlice {
  readonly handlerId?: string
  readonly pluginId?: string
  getServerConfig(): object
  getAuthToken(): Promise<string | null>
  /** Self-contained QuickJS background worker script executed by `background.tasks@1`. */
  getBackgroundScript?(): string
  /** Notification channels published by this provider's background worker. */
  getNotificationChannels?(): readonly NativeNotificationChannelSpec[]
}

/**
 * Orthogonal academic domain slice map, extensible by third-party plugins via
 * `declare module "@orahako/academic-sdk" { interface AcademicSliceMap { ... } }`.
 */
export interface AcademicSliceMap {
  auth: AuthSlice
  timetable: TimetableSlice
  schoolSchedule: SchoolScheduleSlice
  grades: GradesSlice
  exams: ExamsSlice
  makeupExams: MakeupExamsSlice
  evaluation: EvaluationSlice
  studentProfile: StudentProfileSlice
  trainingPlan: TrainingPlanSlice
  ecard: EcardSlice
  epay: EpaySlice
  labor: LaborSlice
  credits: CreditsSlice
  comprehensive: ComprehensiveSlice
  nativePolling: NativePollingSlice
}

export type AcademicSliceKey = keyof AcademicSliceMap & string

export const BUILT_IN_ACADEMIC_SLICES = [
  "auth",
  "timetable",
  "schoolSchedule",
  "grades",
  "exams",
  "makeupExams",
  "evaluation",
  "studentProfile",
  "trainingPlan",
  "ecard",
  "epay",
  "labor",
  "credits",
  "comprehensive",
  "nativePolling",
] as const satisfies readonly AcademicSliceKey[]

/**
 * Composable school provider contract replacing legacy monolithic
 * `AcademicProvider` / `BaseProvider`.
 */
export interface SchoolProvider {
  readonly id: string
  readonly name: string
  /** IANA school wall-clock timezone used by academic date/time presentations. */
  readonly timeZone: string
  readonly supportedPlugins?: readonly string[]
  readonly slices: Partial<AcademicSliceMap>
  readonly diagnostics?: ProviderDiagnostics
  warmup?(): Promise<void>
  initialize(): Promise<void>
  /**
   * User-requested academic reset. May perform remote session termination and
   * clear school-wide caches, so it must only run on explicit reset actions.
   */
  reset(): Promise<void>
  /** User-requested logout. Clears the stored credential after resetting. */
  logout(): Promise<void>
  /**
   * Instance retirement used for school switches, plugin hot replacement, and
   * runtime shutdown. Must release only this instance's local resources: never
   * log out remotely or clear shared query/session/native state.
   */
  dispose(): Promise<void>
  relogin(): Promise<boolean>
}

export function defineSchoolProvider<T extends SchoolProvider>(provider: T): T {
  return provider
}

export function hasSlice<K extends AcademicSliceKey>(
  provider: Pick<SchoolProvider, "slices"> | null | undefined,
  key: K
): boolean {
  return provider?.slices[key] !== undefined
}

export function getSlice<K extends AcademicSliceKey>(
  provider: Pick<SchoolProvider, "slices"> | null | undefined,
  key: K
): AcademicSliceMap[K] | undefined {
  return provider?.slices[key]
}

export function requireSlice<K extends AcademicSliceKey>(
  provider: Pick<SchoolProvider, "id" | "slices">,
  key: K
): AcademicSliceMap[K] {
  const slice = provider.slices[key]
  if (!slice) {
    throw new ProviderError(
      ProviderErrorCode.FEATURE_NOT_SUPPORTED,
      `Provider "${provider.id}" does not support slice "${key}"`,
      undefined,
      501
    )
  }
  return slice
}

export function getEnabledSlices(
  provider: Pick<SchoolProvider, "slices"> | null | undefined
): AcademicSliceKey[] {
  if (!provider) return []
  const keys: AcademicSliceKey[] = []
  for (const key of Object.keys(provider.slices)) {
    const typedKey = key as AcademicSliceKey
    if (provider.slices[typedKey] !== undefined) {
      keys.push(typedKey)
    }
  }
  return keys
}

export function supportsPlugin(
  supportedPlugins: readonly string[] | undefined,
  pluginId: string
): boolean {
  return supportedPlugins === undefined || supportedPlugins.includes(pluginId)
}

export function hasCapability(
  capabilities: AcademicCapabilities | undefined,
  key: string
): boolean {
  return capabilities?.[key] === true
}
