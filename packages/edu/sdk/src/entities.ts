export type AcademicCapabilities = Readonly<Record<string, boolean>>

export interface Credential {
  username: string
  password: string
  metadata?: Record<string, unknown>
}

export interface LoginStep1Input {
  username: string
  password: string
  captcha?: string
  skipRateLimit?: boolean
}

export interface LoginStep1Result {
  authenticated: boolean
  needsMfa: boolean
  username: string
  credential?: string
}

export type MfaMethod = string

export interface MfaRequiredDetails {
  username?: string
  methods?: string[]
  challenge?: Partial<MfaChallenge>
}

export interface MfaChallenge {
  method: MfaMethod
  methodCode: string
  mobileHint: string
  username: string
}

export interface MfaRequestInput {
  username: string
  method: MfaMethod
}

export interface MfaSubmitInput {
  challenge: MfaChallenge
  code: string
}

export interface WechatMfaContext {
  uuid: string
  state: string
  qrImageUrl: string
  oauthUrl: string
}

export interface WechatQrPollResult {
  status: "waiting" | "scanned" | "confirmed" | "expired"
  code?: string
  errcode?: number
}

export interface WechatMfaProvider {
  initiateWechatMfa(): Promise<WechatMfaContext>
  pollWechatMfaQr(
    uuid: string,
    lastErrcode?: number,
    signal?: AbortSignal
  ): Promise<WechatQrPollResult>
  completeWechatMfa(code: string, state: string): Promise<string>
}

export interface AuthStatus {
  authenticated: boolean
}

export interface GradeQueryOptions {
  semester?: string
  courseName?: string
  courseType?: string
  pageSize?: number
  pageNumber?: number
}

export interface GPAQueryOptions {
  studentId?: string
}

export interface GradeAnalyticsQueryOptions {
  semester?: string
  classId?: string
  courseCode?: string
}

export interface GradeRankingQueryOptions extends GradeAnalyticsQueryOptions {
  studentId?: string
}

export interface ScheduleQueryOptions {
  week?: number
  semester?: string
  courseCategory?: string
  includeLabSchedule?: boolean
}

export interface UnscheduledCourseQueryOptions {
  semester?: string
  courseCategory?: string
}

export interface TermCalendarQueryOptions {
  semester?: string
}

export interface CurrentWeekQueryOptions {
  semester?: string
  date?: string
}

export interface ExamQueryOptions {
  semester?: string
}

export interface MakeupExamSignupInput {
  taskId: string
  batchId: string
}

export interface MakeupExamCourseQueryOptions {
  semester?: string
  batchId?: string
  registered?: boolean
}

export interface PageQueryOptions {
  pageSize?: number
  pageNumber?: number
}

export interface TermQueryOptions {
  semester?: string
}

export interface StudentInfo {
  name: string
  namePinyin?: string
  studentId: string
  gender?: string
  nation?: string
  nationality?: string
  department?: string
  major?: string
  className?: string
  gradeLevel?: string
  enrollmentDate?: string
  expectedGraduation?: string
  educationLevel?: string
  campus?: string
  studentStatus?: string
  discipline?: string
  studyDuration?: string
  foreignLanguage?: string
}

export interface Grade {
  courseName: string
  courseCode?: string
  classId?: string
  score?: string
  numericScore?: number
  gradeLevel?: string
  gradePoint?: string
  numericGradePoint?: number
  credit?: string
  numericCredit?: number
  hours?: string
  semester?: string
  courseType?: string
  courseCategory?: string
  examType?: string
  studyMode?: string
  isMajor: boolean
  isRetake?: string
  gradeLevelType?: string
  department?: string
  isPass: boolean
  isValid: boolean
  specialReason?: string
  isDegreeCourse: boolean
  projectName?: string
  metadata?: Record<string, unknown>
}

export interface GradeStatistics {
  scope?: string
  semester?: string
  classId?: string
  courseCode?: string
  highestScore: number
  lowestScore: number
  averageScore: number
  metadata?: Record<string, unknown>
}

export interface GradeDistribution {
  scope?: string
  semester?: string
  classId?: string
  courseCode?: string
  levelCode?: string
  levelName?: string
  count: number
  metadata?: Record<string, unknown>
}

export interface GradeRanking {
  scope?: string
  semester?: string
  studentId?: string
  classId?: string
  courseCode?: string
  score: number
  rank: number
  total: number
  rankingType?: string
  metadata?: Record<string, unknown>
}

export interface GPAStats {
  planName?: string
  studyType?: string
  requiredCreditEarned?: string
  numericRequiredCreditEarned?: number
  electiveCreditEarned?: string
  numericElectiveCreditEarned?: number
  degreeCreditEarned?: string
  numericDegreeCreditEarned?: number
  requiredCreditFailed?: string
  numericRequiredCreditFailed?: number
  gpaInitial?: string
  numericGpaInitial?: number
  gpaHighest?: string
  numericGpaHighest?: number
  requiredGpaHighest?: string
  numericRequiredGpaHighest?: number
  degreeGpaInitial?: string
  numericDegreeGpaInitial?: number
  degreeGpaHighest?: string
  numericDegreeGpaHighest?: number
  weightedAvg?: string
  numericWeightedAvg?: number
  arithmeticAvg?: string
  numericArithmeticAvg?: number
  degreeWeightedAvg?: string
  numericDegreeWeightedAvg?: number
}

export type GPAInfo = GPAStats

export interface Course {
  name: string
  code?: string
  teacher?: string
  classroom?: string
  weekDay: number
  startSection: number
  endSection: number
  weeks?: string
  weekList?: number[]
  credit?: string
  courseType?: string
  classId?: string
  syxzdm?: string
  scheduleId?: string
  classType?: string
  raw?: Record<string, unknown>
}

export type LabCourse = Course

export interface ClassPeriod {
  name?: string
  section: number
  startTime?: string
  endTime?: string
  startMinute?: number
  endMinute?: number
  isInUse: boolean
  raw?: Record<string, unknown>
}

export interface TermCalendar {
  semester?: string
  startDate?: string
  totalWeeks: number
  teachingWeeks: number
  isInUse: boolean
  raw?: Record<string, unknown>
}

export interface CurrentWeek {
  week: number
  weekday: number
  semester?: string
  date?: string
  weekStartDate?: string
  weekEndDate?: string
  weekDates?: string[]
  raw?: Record<string, unknown>
}

export type ExamStatus = "upcoming" | "completed" | "unknown"

export interface Exam {
  name: string
  examName?: string
  /** Local academic-system datetime, formatted as YYYY-MM-DDTHH:mm:ss. */
  startAt?: string
  /** Local academic-system datetime, formatted as YYYY-MM-DDTHH:mm:ss. */
  endAt?: string
  startTimestamp?: number
  endTimestamp?: number
  status?: ExamStatus
  /** Provider-normalized display text for non-logic UI surfaces. */
  timeText?: string
  examLocation?: string
  seatNumber?: string
  raw?: Record<string, unknown>
}

export interface MakeupExamBatch {
  name: string
  batchId: string
  term: string
  /** Local academic-system datetime, formatted as YYYY-MM-DDTHH:mm:ss. */
  signupStart?: string
  /** Local academic-system datetime, formatted as YYYY-MM-DDTHH:mm:ss. */
  signupEnd?: string
  availableCount: number
  registeredCount: number
  raw?: Record<string, unknown>
}

export interface MakeupExamCourse {
  name: string
  code?: string
  credit?: string
  hours?: string
  examSeq?: string
  department?: string
  status?: string
  isAvailable?: boolean
  /** Local academic-system datetime, formatted as YYYY-MM-DDTHH:mm:ss. */
  signupStart?: string
  /** Local academic-system datetime, formatted as YYYY-MM-DDTHH:mm:ss. */
  signupEnd?: string
  batchId?: string
  taskId?: string
  note?: string
  raw?: Record<string, unknown>
}

export type MakeupExam = MakeupExamCourse

export interface LaborRecord {
  term: string
  name: string
  enrollType?: string
  category?: string
  department?: string
  timeStart?: string
  timeEnd?: string
  teacher?: string
  hours?: number
  status?: string
  raw?: Record<string, unknown>
}

export interface LaborSummary {
  studentId?: string
  name?: string
  department?: string
  major?: string
  className?: string
  grade?: string
  schooling?: string
  totalHours?: number
  totalCredits?: number
  raw?: Record<string, unknown>
}

export interface EnrollableActivity {
  name: string
  category?: string
  timeStart?: string
  timeEnd?: string
  location?: string
  hours?: number
  description?: string
  department?: string
  enrollStart?: string
  enrollEnd?: string
  isEnrolled?: boolean
  operation?: string
  raw?: Record<string, unknown>
}

export interface CatalogPage<T> {
  items: T[]
  pageIndex: number
  totalPages: number
  totalRecords: number
}

export interface CreditBatch {
  batchId: string
  name: string
}

export interface CreditDeclaration {
  itemName: string
  categoryMajor?: string
  categoryMinor?: string
  awardLevel?: string
  score?: number
  batch?: string
  status?: string
  operation?: string
  raw?: Record<string, unknown>
}

export interface CreditRecord {
  itemName: string
  year?: string
  categoryMajor?: string
  categoryMinor?: string
  awardLevel?: string
  referenceScore?: number
  actualScore?: number
  grade?: string
  batch?: string
  status?: string
  raw?: Record<string, unknown>
}

export interface CreditSummary {
  studentId?: string
  name?: string
  department?: string
  major?: string
  className?: string
  gradeYear?: string
  grade?: string
  totalCredits?: number
  raw?: Record<string, unknown>
}

export interface Competition {
  code: string
  name: string
  categoryMajor?: string
  categoryMinor?: string
  isEnabled?: boolean
  status?: string
  raw?: Record<string, unknown>
}

export interface LibraryActivity {
  name: string
  organizer?: string
  category?: string
  detail?: string
  raw?: Record<string, unknown>
}

export interface CreditQueryOptions {
  batchId?: string
  itemName?: string
}

export interface CatalogQueryOptions {
  keyword?: string
  pageIndex?: number
}

export interface ComprehensiveTerm {
  year: string
  term: string
  yearDisplay: string
  termDisplay: string
}

export interface ComprehensiveIndicator {
  name: string
  score: string
  rank: number
  maxScore?: string
}

export interface ComprehensiveResult {
  totalScore: string
  classRank: number
  classSize: number
  gradeRank: number
  gradeSize: number
  year: string
  term: string
  yearDisplay?: string
  termDisplay?: string
  indicators: ComprehensiveIndicator[]
}

export interface ComprehensiveIndicatorDetail {
  name: string
  score: string
  maxScore?: string
  rangeText?: string
  proportion?: string
  categoryDisplay?: string
  description?: string
}

export interface ComprehensiveRadarItem {
  name: string
  personal: string
  average: string
  maxScore: string
}

export interface ComprehensiveYearScore {
  year: string
  term: string
  yearDisplay?: string
  termDisplay?: string
  score: string
}

export interface ComprehensiveReportYears {
  years: Array<{ year: string; yearDisplay: string }>
  defaultYear: string
}

export interface ComprehensiveReportPage {
  entries: Array<{
    courseName: string
    score: string
    credit?: string
    year?: string
    term?: string
  }>
  totalSize: number
  pageNumber: number
  pageSize: number
}

export interface ComprehensiveQueryOptions {
  year?: string
  term?: string
}

export interface SchoolClassInfo {
  classId: string
  className: string
  grade?: string
  gradeDisplay?: string
  department?: string
  departmentDisplay?: string
  major?: string
  majorDisplay?: string
  isScheduled?: boolean
  studentCount?: number
}

export interface ClassroomInfo {
  name: string
  code: string
  campusDisplay?: string
  building?: string
  buildingDisplay?: string
  examSeats?: number
  classSeats?: number
  typeDisplay?: string
  floor?: number
  isScheduled?: boolean
}

export interface CodeItem {
  id: string
  name: string
}

export interface MajorInfo {
  id: string
  name: string
  department?: string
}

export interface SchoolClassQueryOptions {
  semester?: string
  grade?: string
  department?: string
  major?: string
}

export interface ClassroomQueryOptions {
  semester?: string
  name?: string
  campus?: string
  building?: string
}

export interface EvaluationType {
  name: string
  code?: string
  count: number
}

export type EvaluationTaskStatus = "not_started" | "active" | "ended" | "unknown"

export interface EvaluationTask {
  wid: string
  wjid?: string
  name?: string
  courseName?: string
  teacherName?: string
  teacherId?: string
  term?: string
  termName?: string
  evalType?: string
  evalTypeName?: string
  category?: string
  categoryName?: string
  startTime?: string
  endTime?: string
  startAt?: string
  endAt?: string
  startTimestamp?: number
  endTimestamp?: number
  status?: EvaluationTaskStatus
  sequence: number
  className?: string
  groupNo?: string
  providerTaskId?: string
}

export type EvaluationItem = EvaluationTask

export interface QuestionOption {
  wid: string
  text?: string
  score: number
  scoreRatio: number
  questionId?: string
}

export interface Question {
  tmid: string
  wjid?: string
  text?: string
  questionType?: string
  maxScore: number
  order: number
  options: QuestionOption[]
}

export interface EvaluationDetail {
  wjid?: string
  name?: string
  deadline?: string
  questions: Question[]
  teachers?: Record<string, unknown>[]
}

export interface EvaluationAnswer {
  tmid: string
  questionType?: string
  optionIds?: string[]
  text?: string
}

export interface EvaluationDetailQuery {
  groupNo: string
  evalType: string
  sequence?: number
}

export interface EvaluationScoreInput {
  groupNo: string
  wjid: string
  evalType: string
  answers: EvaluationAnswer[]
  teacherRelationId?: string
  courseName?: string
  teacherName?: string
  sequence?: number
}

export type EvaluationSubmitInput = EvaluationScoreInput

export interface TrainingPlan {
  courseName: string
  courseCode?: string
  credit?: string
  courseType?: string
  required: boolean
  term?: string
  courseGroup?: string
}

export interface AcademicWarning {
  warningType: string
  warningLevel?: string
  description?: string
  term?: string
}

export interface AcademicCompletion {
  planName?: string
  totalRequired?: string
  numericTotalRequired?: number
  completed?: string
  numericCompleted?: number
  elective?: string
  numericElective?: number
  passed: boolean
  lastCalculatedAt?: string
}

export interface LessonActivity {
  activityId: string
  type: number | null
  status: number | null
  title: string | null
  icon: string | null
  signType: string | null
  signClazz: string | null
  isEnd: boolean
  isCreator: boolean
  createTime: string | null
  createAt?: string
  createTimestamp?: number
  raw?: Record<string, unknown>
}

export interface CurrentLesson {
  lessonId: string | null
  activityList: LessonActivity[]
  raw?: Record<string, unknown>
}

export interface CurrentLessonQuery {
  teachClassId: string
  teachClassType: string
  scheduleId: string
  week: number
  weekDay: number
  startNode: number
  endNode: number
}

export interface SigninDetailQuery {
  activityId: string
  title?: string
}

export interface SigninActivityDetail {
  activityId: string
  duration: number
  endTime: string
  endAt?: string
  endTimestamp?: number
  leftSeconds: number
  signinType: number
  startTime: string
  startAt?: string
  startTimestamp?: number
  raw?: Record<string, unknown>
}

export interface StudentSigninStatus {
  signStatus: number
  attendanceStatus: number
  signOrder: number
  signinType: number
  raw?: Record<string, unknown>
}

export interface StudentSignInput {
  activityId: string
  accuracy?: number
  latitude?: number
  longitude?: number
  code?: string
}

export interface StudentSignResult {
  signStatus: number
  attendanceStatus: number
  signOrder: number
  signinType: number
  raw?: Record<string, unknown>
}

export interface ProviderMobile {
  getCurrentLesson(input: CurrentLessonQuery): Promise<CurrentLesson>
  getSigninDetail(input: SigninDetailQuery): Promise<SigninActivityDetail>
  getStudentSigninStatus(input: SigninDetailQuery): Promise<StudentSigninStatus>
  doStudentSign(input: StudentSignInput): Promise<StudentSignResult>
}

export interface ProviderDiagnosticCookie {
  name: string
  domain: string
  path: string
  value?: string
}

export interface ProviderDiagnosticLabels {
  authSystem: string
  academicSystem: string
  authToken: string
  authCookies: string
  academicCookies: string
  authSession: string
  academicSession: string
  mobileAuth: string
}

export interface ProviderDiagnostics {
  readonly labels: ProviderDiagnosticLabels
  getAuthCookies(): Promise<ProviderDiagnosticCookie[]>
  getAcademicCookies(): Promise<ProviderDiagnosticCookie[]>
  checkAuth(): Promise<boolean>
  resetAcademicSession(): void
  ensureMobileAuthorized?(): Promise<void>
}

export interface EcardBalance {
  balance: number
  cardNum: string
  availableDate: string
  cardStatusName: string
  months: string[]
}

export type EcardProfile = EcardBalance

export interface EcardSessionStatus {
  ready: boolean
  balance: EcardBalance | null
}

export interface EpayRecord {
  id: string
  payName: string
  chargeYear: string
  currencyTypeShow: string
  amountN: number
  amount: string
  payAmount: string
  refundAmount: string
  status: string
  expired: string
  startTime: string
  overTime: string
}

export type FeeItem = EpayRecord

export type EpayRecordStatus = "paid" | "unpaid" | "closed" | "expired" | "unknown"

export interface EpaySessionStatus {
  ready: boolean
  records: EpayRecord[]
  unpaid: EpayRecord[]
}

export interface MeterRoom {
  roomFullName: string
  roomverify: string
  accountNum: string
}

export interface MeterDevice {
  deviceName: string
  remaining: number
  todayUse: number
  price: number
  monthUse: { month: string; use: number }[]
  lineDesc: string
}

export interface MeterOverview {
  roomFullName: string
  roomNum: string
  meters: MeterDevice[]
}

export interface DayUse {
  date: string
  use: number
}

export interface RechargeRecord {
  time: string
  name: string
  amount: number
  fare: number
}

export type GradeLetter =
  | "A+"
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C+"
  | "C"
  | "C-"
  | "D+"
  | "D"
  | "F"
  | "F-"

export interface GPAGradeBand {
  readonly min: number
  readonly letter: GradeLetter
}

export interface ProviderGPAScale {
  readonly max: number
  readonly bands: readonly [GPAGradeBand, ...GPAGradeBand[]]
}

export interface ProviderGradeScale {
  letterOfScore(score: number, semester?: string): GradeLetter
  letterOfGradeLevel(gradeLevel?: string): GradeLetter | undefined
}
