import type {
  AcademicCapabilities,
  AcademicCompletion,
  AcademicProvider,
  AcademicWarning,
  AuthStatus,
  ClassPeriod,
  Course,
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
  MakeupExamBatch,
  MakeupExamCourse,
  MakeupExamCourseQueryOptions,
  MfaChallenge,
  MfaRequestInput,
  MfaSubmitInput,
  PageQueryOptions,
  ProviderDiagnostics,
  ProviderMobile,
  ProviderNativeNotification,
  ScheduleQueryOptions,
  StudentInfo,
  TermCalendar,
  TermCalendarQueryOptions,
  TermQueryOptions,
  TrainingPlan,
  UnscheduledCourseQueryOptions,
  WechatMfaContext,
  WechatQrPollResult,
} from "./types";

export abstract class BaseProvider implements AcademicProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly capabilities: AcademicCapabilities;

  readonly mobile?: ProviderMobile = undefined;
  readonly diagnostics?: ProviderDiagnostics = undefined;
  readonly nativeNotification?: ProviderNativeNotification = undefined;

  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.onInitialize();
    this.initialized = true;
  }

  async reset(): Promise<void> {
    await this.onReset();
    this.initialized = false;
  }

  protected async onInitialize(): Promise<void> {}

  protected async onReset(): Promise<void> {}

  abstract prepareLogin(): Promise<void>;
  abstract resetLoginSession(): Promise<void> | void;
  abstract getCaptchaUrl(): string | null;
  abstract checkCaptchaNeeded(username: string): Promise<boolean>;
  abstract login(credential: Credential): Promise<void>;
  abstract loginStep1(input: LoginStep1Input): Promise<LoginStep1Result>;
  abstract requestMfaCode(input: MfaRequestInput): Promise<MfaChallenge>;
  abstract submitMfaCode(input: MfaSubmitInput): Promise<string>;
  abstract initiateWechatMfa(): Promise<WechatMfaContext>;
  abstract pollWechatMfaQr(uuid: string, lastErrcode?: number): Promise<WechatQrPollResult>;
  abstract completeWechatMfa(code: string, state: string): Promise<string>;
  abstract checkAuthStatus(): Promise<AuthStatus>;
  abstract logout(): Promise<void>;
  abstract isAuthenticated(): boolean;
  abstract getStudentInfo(): Promise<StudentInfo>;
  abstract getGrades(options?: GradeQueryOptions): Promise<Grade[]>;
  abstract getGPAStats(options?: GPAQueryOptions): Promise<GPAStats>;
  abstract getGradeStatistics(options?: GradeAnalyticsQueryOptions): Promise<GradeStatistics>;
  abstract getGradeDistribution(options?: GradeAnalyticsQueryOptions): Promise<GradeDistribution[]>;
  abstract getGradeRanking(options?: GradeRankingQueryOptions): Promise<GradeRanking>;
  abstract getSchedule(options?: ScheduleQueryOptions): Promise<Course[]>;
  abstract getUnscheduledCourses(options?: UnscheduledCourseQueryOptions): Promise<Course[]>;
  abstract getClassPeriods(): Promise<ClassPeriod[]>;
  abstract getTermCalendar(options?: TermCalendarQueryOptions): Promise<TermCalendar>;
  abstract getCurrentWeek(options?: CurrentWeekQueryOptions): Promise<CurrentWeek>;
  abstract getCurrentWeekNumber(options?: CurrentWeekQueryOptions): Promise<number>;
  abstract getExams(options?: ExamQueryOptions): Promise<Exam[]>;
  abstract getMakeupExamBatches(options?: ExamQueryOptions): Promise<MakeupExamBatch[]>;
  abstract getMakeupExamCourses(
    options?: MakeupExamCourseQueryOptions,
  ): Promise<MakeupExamCourse[]>;
  abstract getTrainingPlan(options?: PageQueryOptions): Promise<TrainingPlan[]>;
  abstract getAcademicCompletion(): Promise<AcademicCompletion>;
  abstract getAcademicWarnings(): Promise<AcademicWarning[]>;
  abstract getEvaluationTypes(options?: TermQueryOptions): Promise<EvaluationType[]>;
  abstract getPendingEvaluations(
    evalType: string,
    options?: TermQueryOptions,
  ): Promise<EvaluationTask[]>;
  abstract getEvaluationTasks(options?: TermQueryOptions): Promise<EvaluationTask[]>;
  abstract getEvaluationDetail(query: EvaluationDetailQuery): Promise<EvaluationDetail>;
  abstract calculateEvaluationScore(input: EvaluationScoreInput): Promise<Record<string, unknown>>;
  abstract submitEvaluation(input: EvaluationSubmitInput): Promise<void>;
}
