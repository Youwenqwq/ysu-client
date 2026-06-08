/**
 * @fileoverview AcademicProvider interface and unified domain models.
 *
 * The provider layer is the application-facing boundary for all school-specific
 * academic systems. UI code should consume these contracts (or provider hooks)
 * instead of importing CAS/JWXT implementation modules directly.
 */

/** Capability flags indicating which features a provider supports. */
export interface AcademicCapabilities {
  auth: boolean;
  captcha: boolean;
  mfa: boolean;
  wechatMfa: boolean;
  grades: boolean;
  gradeAnalytics: boolean;
  schedule: boolean;
  labSchedule: boolean;
  exams: boolean;
  gpa: boolean;
  evaluation: boolean;
  evaluationScorePreview: boolean;
  trainingPlan: boolean;
  studentInfo: boolean;
  currentWeek: boolean;
  classPeriods: boolean;
  termCalendar: boolean;
  mobileSignin: boolean;
}

/** Login credential supplied by the user. */
export interface Credential {
  username: string;
  password: string;
  metadata?: Record<string, unknown>;
}

export interface LoginStep1Input {
  username: string;
  password: string;
  captcha?: string;
  skipRateLimit?: boolean;
}

export interface LoginStep1Result {
  authenticated: boolean;
  needsMfa: boolean;
  username: string;
  credential?: string;
}

export type MfaMethod = string;

export interface MfaRequiredDetails {
  username?: string;
  methods?: string[];
  challenge?: Partial<MfaChallenge>;
}

export interface MfaChallenge {
  method: MfaMethod;
  methodCode: string;
  mobileHint: string;
  username: string;
}

export interface MfaRequestInput {
  username: string;
  method: MfaMethod;
}

export interface MfaSubmitInput {
  challenge: MfaChallenge;
  code: string;
}

export interface WechatMfaContext {
  uuid: string;
  state: string;
  qrImageUrl: string;
  oauthUrl: string;
}

export interface WechatQrPollResult {
  status: "waiting" | "scanned" | "confirmed";
  code?: string;
}

export interface AuthStatus {
  authenticated: boolean;
}

/** Options for querying grades. */
export interface GradeQueryOptions {
  semester?: string;
  courseName?: string;
  courseType?: string;
  pageSize?: number;
  pageNumber?: number;
}

export interface GPAQueryOptions {
  studentId?: string;
}

export interface GradeAnalyticsQueryOptions {
  semester?: string;
  classId?: string;
  courseCode?: string;
}

export interface GradeRankingQueryOptions extends GradeAnalyticsQueryOptions {
  studentId?: string;
}

/** Options for querying the class schedule. */
export interface ScheduleQueryOptions {
  week?: number;
  semester?: string;
  courseCategory?: string;
  includeLabSchedule?: boolean;
}

export interface UnscheduledCourseQueryOptions {
  semester?: string;
  courseCategory?: string;
}

export interface TermCalendarQueryOptions {
  semester?: string;
}

export interface CurrentWeekQueryOptions {
  semester?: string;
  date?: string;
}

/** Options for querying exam arrangements. */
export interface ExamQueryOptions {
  semester?: string;
}

export interface PageQueryOptions {
  pageSize?: number;
  pageNumber?: number;
}

export interface TermQueryOptions {
  semester?: string;
}

/** Basic student profile information. */
export interface StudentInfo {
  name: string;
  namePinyin?: string;
  studentId: string;
  gender?: string;
  nation?: string;
  nationality?: string;
  department?: string;
  major?: string;
  className?: string;
  gradeLevel?: string;
  enrollmentDate?: string;
  expectedGraduation?: string;
  educationLevel?: string;
  campus?: string;
  studentStatus?: string;
  discipline?: string;
  studyDuration?: string;
  foreignLanguage?: string;
}

/** A single grade / course score record. */
export interface Grade {
  courseName: string;
  courseCode?: string;
  classId?: string;
  score?: string;
  numericScore?: number;
  gradeLevel?: string;
  gradePoint?: string;
  numericGradePoint?: number;
  credit?: string;
  numericCredit?: number;
  hours?: string;
  semester?: string;
  courseType?: string;
  courseCategory?: string;
  examType?: string;
  studyMode?: string;
  isMajor: boolean;
  isRetake?: string;
  gradeLevelType?: string;
  department?: string;
  isPass: boolean;
  isValid: boolean;
  specialReason?: string;
  isDegreeCourse: boolean;
  projectName?: string;
  metadata?: Record<string, unknown>;
}

export interface GradeStatistics {
  scope?: string;
  semester?: string;
  classId?: string;
  courseCode?: string;
  highestScore: number;
  lowestScore: number;
  averageScore: number;
  metadata?: Record<string, unknown>;
}

export interface GradeDistribution {
  scope?: string;
  semester?: string;
  classId?: string;
  courseCode?: string;
  levelCode?: string;
  levelName?: string;
  count: number;
  metadata?: Record<string, unknown>;
}

export interface GradeRanking {
  scope?: string;
  semester?: string;
  studentId?: string;
  classId?: string;
  courseCode?: string;
  score: number;
  rank: number;
  total: number;
  rankingType?: string;
  metadata?: Record<string, unknown>;
}

/** GPA and credit statistics. */
export interface GPAStats {
  planName?: string;
  studyType?: string;
  requiredCreditEarned?: string;
  numericRequiredCreditEarned?: number;
  electiveCreditEarned?: string;
  numericElectiveCreditEarned?: number;
  degreeCreditEarned?: string;
  numericDegreeCreditEarned?: number;
  requiredCreditFailed?: string;
  numericRequiredCreditFailed?: number;
  gpaInitial?: string;
  numericGpaInitial?: number;
  gpaHighest?: string;
  numericGpaHighest?: number;
  requiredGpaHighest?: string;
  numericRequiredGpaHighest?: number;
  degreeGpaInitial?: string;
  numericDegreeGpaInitial?: number;
  degreeGpaHighest?: string;
  numericDegreeGpaHighest?: number;
  weightedAvg?: string;
  numericWeightedAvg?: number;
  arithmeticAvg?: string;
  numericArithmeticAvg?: number;
  degreeWeightedAvg?: string;
  numericDegreeWeightedAvg?: number;
}

/** A single scheduled course session (one time slot). */
export interface Course {
  name: string;
  code?: string;
  teacher?: string;
  classroom?: string;
  weekDay: number;
  startSection: number;
  endSection: number;
  weeks?: string;
  weekList?: number[];
  credit?: string;
  courseType?: string;
  classId?: string;
  syxzdm?: string;
  scheduleId?: string;
  classType?: string;
  raw?: Record<string, unknown>;
}

export interface ClassPeriod {
  name?: string;
  section: number;
  startTime?: string;
  endTime?: string;
  startMinute?: number;
  endMinute?: number;
  isInUse: boolean;
  raw?: Record<string, unknown>;
}

export interface TermCalendar {
  semester?: string;
  startDate?: string;
  totalWeeks: number;
  teachingWeeks: number;
  isInUse: boolean;
  raw?: Record<string, unknown>;
}

export interface CurrentWeek {
  week: number;
  weekday: number;
  semester?: string;
  date?: string;
  weekStartDate?: string;
  weekEndDate?: string;
  weekDates?: string[];
  raw?: Record<string, unknown>;
}

/** An exam arrangement entry. */
export type ExamStatus = "upcoming" | "completed" | "unknown";

export interface Exam {
  name: string;
  examName?: string;
  /** Local academic-system datetime, formatted as YYYY-MM-DDTHH:mm:ss. */
  startAt?: string;
  /** Local academic-system datetime, formatted as YYYY-MM-DDTHH:mm:ss. */
  endAt?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  status?: ExamStatus;
  /** Provider-normalized display text for non-logic UI surfaces. */
  timeText?: string;
  examLocation?: string;
  seatNumber?: string;
  raw?: Record<string, unknown>;
}

export interface EvaluationType {
  name: string;
  code?: string;
  count: number;
}

export type EvaluationTaskStatus = "not_started" | "active" | "ended" | "unknown";

/** A teaching-evaluation task header. */
export interface EvaluationTask {
  wid: string;
  wjid?: string;
  name?: string;
  courseName?: string;
  teacherName?: string;
  teacherId?: string;
  term?: string;
  termName?: string;
  evalType?: string;
  evalTypeName?: string;
  category?: string;
  categoryName?: string;
  startTime?: string;
  endTime?: string;
  /** Local academic-system datetime, formatted as YYYY-MM-DDTHH:mm:ss. */
  startAt?: string;
  /** Local academic-system datetime, formatted as YYYY-MM-DDTHH:mm:ss. */
  endAt?: string;
  startTimestamp?: number;
  endTimestamp?: number;
  status?: EvaluationTaskStatus;
  sequence: number;
  className?: string;
  groupNo?: string;
  providerTaskId?: string;
}

/** A single option inside an evaluation question. */
export interface QuestionOption {
  wid: string;
  text?: string;
  score: number;
  scoreRatio: number;
  questionId?: string;
}

/** A question inside an evaluation form. */
export interface Question {
  tmid: string;
  wjid?: string;
  text?: string;
  questionType?: string;
  maxScore: number;
  order: number;
  options: QuestionOption[];
}

/** Detailed evaluation form definition. */
export interface EvaluationDetail {
  wjid?: string;
  name?: string;
  deadline?: string;
  questions: Question[];
  teachers?: Record<string, unknown>[];
}

/** A single answer to an evaluation question. */
export interface EvaluationAnswer {
  tmid: string;
  questionType?: string;
  optionIds?: string[];
  text?: string;
}

export interface EvaluationDetailQuery {
  groupNo: string;
  evalType: string;
  sequence?: number;
}

export interface EvaluationScoreInput {
  groupNo: string;
  wjid: string;
  evalType: string;
  answers: EvaluationAnswer[];
  teacherRelationId?: string;
  courseName?: string;
  teacherName?: string;
  sequence?: number;
}

export type EvaluationSubmitInput = EvaluationScoreInput;

/** A course entry in the training plan / curriculum. */
export interface TrainingPlan {
  courseName: string;
  courseCode?: string;
  credit?: string;
  courseType?: string;
  required: boolean;
  term?: string;
  courseGroup?: string;
}

/** An academic warning / probation record. */
export interface AcademicWarning {
  warningType: string;
  warningLevel?: string;
  description?: string;
  term?: string;
}

/** Academic completion / graduation audit summary. */
export interface AcademicCompletion {
  planName?: string;
  totalRequired?: string;
  numericTotalRequired?: number;
  completed?: string;
  numericCompleted?: number;
  elective?: string;
  numericElective?: number;
  passed: boolean;
}

export interface LessonActivity {
  activityId: string;
  type: number | null;
  status: number | null;
  title: string | null;
  icon: string | null;
  signType: string | null;
  signClazz: string | null;
  isEnd: boolean;
  isCreator: boolean;
  createTime: string | null;
  /** Local mobile-system datetime, formatted as YYYY-MM-DDTHH:mm:ss when parseable. */
  createAt?: string;
  createTimestamp?: number;
  raw?: Record<string, unknown>;
}

export interface CurrentLesson {
  lessonId: string | null;
  activityList: LessonActivity[];
  raw?: Record<string, unknown>;
}

export interface CurrentLessonQuery {
  teachClassId: string;
  teachClassType: string;
  scheduleId: string;
  week: number;
  weekDay: number;
  startNode: number;
  endNode: number;
}

export interface SigninDetailQuery {
  activityId: string;
  title?: string;
}

export interface SigninActivityDetail {
  activityId: string;
  duration: number;
  endTime: string;
  /** Local mobile-system datetime, formatted as YYYY-MM-DDTHH:mm:ss when parseable. */
  endAt?: string;
  endTimestamp?: number;
  leftSeconds: number;
  signinType: number;
  startTime: string;
  /** Local mobile-system datetime, formatted as YYYY-MM-DDTHH:mm:ss when parseable. */
  startAt?: string;
  startTimestamp?: number;
  raw?: Record<string, unknown>;
}

export interface StudentSigninStatus {
  signStatus: number;
  attendanceStatus: number;
  signOrder: number;
  signinType: number;
  raw?: Record<string, unknown>;
}

export interface StudentSignInput {
  activityId: string;
  accuracy?: number;
  latitude?: number;
  longitude?: number;
  code?: string;
}

export interface StudentSignResult {
  signStatus: number;
  attendanceStatus: number;
  signOrder: number;
  signinType: number;
  raw?: Record<string, unknown>;
}

export interface ProviderLifecycle {
  initialize(): Promise<void>;
  warmup?(): Promise<void>;
  reset(): Promise<void>;
}

export interface ProviderAuth {
  prepareLogin(): Promise<void>;
  resetLoginSession(): Promise<void> | void;
  getCaptchaUrl(): string | null;
  checkCaptchaNeeded(username: string): Promise<boolean>;
  login(credential: Credential): Promise<void>;
  loginStep1(input: LoginStep1Input): Promise<LoginStep1Result>;
  requestMfaCode(input: MfaRequestInput): Promise<MfaChallenge>;
  submitMfaCode(input: MfaSubmitInput): Promise<string>;
  initiateWechatMfa(): Promise<WechatMfaContext>;
  pollWechatMfaQr(uuid: string, lastErrcode?: number): Promise<WechatQrPollResult>;
  completeWechatMfa(code: string, state: string): Promise<string>;
  checkAuthStatus(): Promise<AuthStatus>;
  logout(): Promise<void>;
  isAuthenticated(): boolean;
}

export interface ProviderAcademics {
  getStudentInfo(): Promise<StudentInfo>;
  getGrades(options?: GradeQueryOptions): Promise<Grade[]>;
  getGPAStats(options?: GPAQueryOptions): Promise<GPAStats>;
  getGradeStatistics(options?: GradeAnalyticsQueryOptions): Promise<GradeStatistics>;
  getGradeDistribution(options?: GradeAnalyticsQueryOptions): Promise<GradeDistribution[]>;
  getGradeRanking(options?: GradeRankingQueryOptions): Promise<GradeRanking>;
  getSchedule(options?: ScheduleQueryOptions): Promise<Course[]>;
  getUnscheduledCourses(options?: UnscheduledCourseQueryOptions): Promise<Course[]>;
  getClassPeriods(): Promise<ClassPeriod[]>;
  getTermCalendar(options?: TermCalendarQueryOptions): Promise<TermCalendar>;
  getCurrentWeek(options?: CurrentWeekQueryOptions): Promise<CurrentWeek>;
  getCurrentWeekNumber(options?: CurrentWeekQueryOptions): Promise<number>;
  getExams(options?: ExamQueryOptions): Promise<Exam[]>;
  getTrainingPlan(options?: PageQueryOptions): Promise<TrainingPlan[]>;
  getAcademicCompletion(): Promise<AcademicCompletion>;
  getAcademicWarnings(): Promise<AcademicWarning[]>;
}

export interface ProviderEvaluation {
  getEvaluationTypes(options?: TermQueryOptions): Promise<EvaluationType[]>;
  getPendingEvaluations(evalType: string, options?: TermQueryOptions): Promise<EvaluationTask[]>;
  getEvaluationTasks(options?: TermQueryOptions): Promise<EvaluationTask[]>;
  getEvaluationDetail(query: EvaluationDetailQuery): Promise<EvaluationDetail>;
  calculateEvaluationScore(input: EvaluationScoreInput): Promise<Record<string, unknown>>;
  submitEvaluation(input: EvaluationSubmitInput): Promise<void>;
}

export interface ProviderMobile {
  getCurrentLesson(input: CurrentLessonQuery): Promise<CurrentLesson>;
  getSigninDetail(input: SigninDetailQuery): Promise<SigninActivityDetail>;
  getStudentSigninStatus(input: SigninDetailQuery): Promise<StudentSigninStatus>;
  doStudentSign(input: StudentSignInput): Promise<StudentSignResult>;
}

export interface ProviderRelogin {
  relogin?(): Promise<boolean>;
}

export interface ProviderDiagnosticCookie {
  name: string;
  domain: string;
  path: string;
  value?: string;
}

export interface ProviderDiagnosticLabels {
  authSystem: string;
  academicSystem: string;
  authToken: string;
  authCookies: string;
  academicCookies: string;
  authSession: string;
  academicSession: string;
  mobileAuth: string;
}

export interface ProviderDiagnostics {
  readonly labels: ProviderDiagnosticLabels;
  getAuthCookies(): Promise<ProviderDiagnosticCookie[]>;
  getAcademicCookies(): Promise<ProviderDiagnosticCookie[]>;
  getAuthCookieUrl?(): string;
  checkAuth(): Promise<boolean>;
  resetAcademicSession(): void;
  ensureMobileAuthorized?(): Promise<void>;
}

export interface ProviderNativeNotification {
  getServerConfig(): object;
  getAuthToken(): Promise<string | null>;
  getAuthCookieUrl?(): string;
}

/**
 * Abstract contract for an academic data provider.
 */
export interface AcademicProvider
  extends ProviderLifecycle,
    ProviderAuth,
    ProviderAcademics,
    ProviderEvaluation,
    ProviderRelogin {
  readonly id: string;
  readonly name: string;
  readonly capabilities: AcademicCapabilities;
  readonly mobile?: ProviderMobile;
  readonly diagnostics?: ProviderDiagnostics;
  readonly nativeNotification?: ProviderNativeNotification;
}
