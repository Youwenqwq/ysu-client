/**
 * EMAP data fetcher wrapper for YSU Provider.
 *
 * Wraps lib/jwxt.ts functions with withJWXT() helper that persists
 * JWXT session after successful calls and maps errors to ProviderError.
 */
import { NotLoggedInError, JWXTBusinessError, JWXTProtocolError, JWXTError } from "./protocol/jwxt"
import type { JWXTProtocol } from "./protocol/jwxt"
import type {
  StudentInfo as JWXTStudentInfo,
  Grade as JWXTGrade,
  GradeStatistics as JWXTGradeStatistics,
  GradeDistribution as JWXTGradeDistribution,
  GradeRanking as JWXTGradeRanking,
  GPAStats as JWXTGPAStats,
  Course as JWXTCourse,
  ClassPeriod as JWXTClassPeriod,
  TermCalendar as JWXTTermCalendar,
  CurrentWeek as JWXTCurrentWeek,
  Exam as JWXTExam,
  MakeupExamBatch as JWXTMakeupExamBatch,
  MakeupExamCourse as JWXTMakeupExamCourse,
  CodeItem as JWXTCodeItem,
  MajorInfo as JWXTMajorInfo,
  SchoolClassInfo as JWXTSchoolClassInfo,
  ClassroomInfo as JWXTClassroomInfo,
  TrainingPlan as JWXTTrainingPlan,
  AcademicCompletion as JWXTAcademicCompletion,
  AcademicWarning as JWXTAcademicWarning,
  EvaluationType as JWXTEvaluationType,
  EvaluationTask as JWXTEvaluationTask,
  EvaluationDetail as JWXTEvaluationDetail,
  EvaluationAnswer as JWXTEvaluationAnswer,
} from "./protocol/jwxt"
import { ProviderError, ProviderErrorCode, wrapError } from "@orahako/plugin-sdk/provider-errors"

export type EmapFetcher = Pick<
  JWXTProtocol,
  | "queryStudentInfo"
  | "queryGrades"
  | "queryGpaStats"
  | "queryGradeStatistics"
  | "queryGradeDistribution"
  | "queryGradeRanking"
  | "querySchedule"
  | "queryUnscheduledCourses"
  | "queryClassPeriods"
  | "queryTermCalendar"
  | "queryCurrentWeek"
  | "queryExams"
  | "queryMakeupExamBatches"
  | "queryMakeupExamCourses"
  | "signupMakeupExam"
  | "queryGradeYears"
  | "queryDepartments"
  | "queryMajors"
  | "querySchoolClasses"
  | "queryClassSchedule"
  | "queryCampuses"
  | "queryTeachingBuildings"
  | "queryClassrooms"
  | "queryClassroomSchedule"
  | "queryTrainingPlan"
  | "queryAcademicCompletion"
  | "queryAcademicWarnings"
  | "queryEvaluationTypes"
  | "queryPendingEvaluations"
  | "calculateEvaluationScore"
  | "submitEvaluation"
> & {
  queryExperimentalSchedule(opts?: {
    term?: string
    studentId?: string
    courseCategory?: string
  }): Promise<JWXTCourse[]>
  queryEvaluationDetail(
    groupNo: string,
    evalType: string,
    opts?: { sequence?: number }
  ): Promise<JWXTEvaluationDetail>
  recalculateAcademicCompletion(): Promise<JWXTAcademicCompletion>
}

export function createEmapFetcher(
  jwxt: JWXTProtocol,
  persistJWXTSession: () => Promise<void>,
  mapCASSessionError: (error: unknown) => ProviderError | undefined
): EmapFetcher {
  const {
    queryStudentInfo: _queryStudentInfo,
    queryGrades: _queryGrades,
    queryGpaStats: _queryGpaStats,
    queryGradeStatistics: _queryGradeStatistics,
    queryGradeDistribution: _queryGradeDistribution,
    queryGradeRanking: _queryGradeRanking,
    querySchedule: _querySchedule,
    queryScheduleExperimental: _queryScheduleExperimental,
    queryUnscheduledCourses: _queryUnscheduledCourses,
    queryClassPeriods: _queryClassPeriods,
    queryTermCalendar: _queryTermCalendar,
    queryCurrentWeek: _queryCurrentWeek,
    queryExams: _queryExams,
    queryMakeupExamBatches: _queryMakeupExamBatches,
    queryMakeupExamCourses: _queryMakeupExamCourses,
    queryGradeYears: _queryGradeYears,
    queryDepartments: _queryDepartments,
    queryMajors: _queryMajors,
    querySchoolClasses: _querySchoolClasses,
    queryClassSchedule: _queryClassSchedule,
    queryCampuses: _queryCampuses,
    queryTeachingBuildings: _queryTeachingBuildings,
    queryClassrooms: _queryClassrooms,
    queryClassroomSchedule: _queryClassroomSchedule,
    signupMakeupExam: _signupMakeupExam,
    queryTrainingPlan: _queryTrainingPlan,
    queryAcademicCompletion: _queryAcademicCompletion,
    recalculateAcademicCompletion: _recalculateAcademicCompletion,
    queryAcademicWarnings: _queryAcademicWarnings,
    queryEvaluationTypes: _queryEvaluationTypes,
    queryPendingEvaluations: _queryPendingEvaluations,
    getEvaluationDetail: _getEvaluationDetail,
    calculateEvaluationScore: _calculateEvaluationScore,
    submitEvaluation: _submitEvaluation,
  } = jwxt

function mapJWXTError(e: unknown): ProviderError {
  const sessionError = mapCASSessionError(e)
  if (sessionError) return sessionError

  if (e instanceof NotLoggedInError) {
    return new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, e.message, e, 401)
  }
  if (e instanceof JWXTBusinessError) {
    return new ProviderError(ProviderErrorCode.BACKEND_BUSINESS_ERROR, e.msg ?? e.message, e, 400)
  }
  if (e instanceof JWXTProtocolError) {
    return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500)
  }
  if (e instanceof JWXTError) {
    return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500)
  }
  return wrapError(e)
}

async function withJWXT<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn()
    persistJWXTSession().catch((e) => {
      console.warn("Failed to persist JWXT session", e)
    })
    return result
  } catch (e) {
    throw mapJWXTError(e)
  }
}

async function queryStudentInfo(): Promise<JWXTStudentInfo> {
  return withJWXT(() => _queryStudentInfo())
}

async function queryGrades(opts?: {
  term?: string
  courseName?: string
  pageSize?: number
  pageNumber?: number
}): Promise<JWXTGrade[]> {
  return withJWXT(() => _queryGrades(opts))
}

async function queryGpaStats(opts?: { studentId?: string }): Promise<JWXTGPAStats> {
  return withJWXT(() => _queryGpaStats(opts))
}

async function queryGradeStatistics(opts?: {
  term?: string
  classId?: string
  courseCode?: string
}): Promise<JWXTGradeStatistics> {
  return withJWXT(() => _queryGradeStatistics(opts))
}

async function queryGradeDistribution(opts?: {
  term?: string
  classId?: string
  courseCode?: string
}): Promise<JWXTGradeDistribution[]> {
  return withJWXT(() => _queryGradeDistribution(opts))
}

async function queryGradeRanking(opts?: {
  term?: string
  studentId?: string
  classId?: string
  courseCode?: string
}): Promise<JWXTGradeRanking> {
  return withJWXT(() => _queryGradeRanking(opts))
}

async function querySchedule(opts?: { term?: string }): Promise<JWXTCourse[]> {
  return withJWXT(() => _querySchedule(opts))
}

async function queryExperimentalSchedule(opts?: {
  term?: string
  studentId?: string
  courseCategory?: string
}): Promise<JWXTCourse[]> {
  return withJWXT(() => _queryScheduleExperimental(opts))
}

async function queryUnscheduledCourses(opts?: {
  term?: string
  studentId?: string
  courseCategory?: string
}): Promise<JWXTCourse[]> {
  return withJWXT(() => _queryUnscheduledCourses(opts))
}

async function queryClassPeriods(): Promise<JWXTClassPeriod[]> {
  return withJWXT(() => _queryClassPeriods())
}

async function queryTermCalendar(opts?: { term?: string }): Promise<JWXTTermCalendar> {
  return withJWXT(() => _queryTermCalendar(opts))
}

async function queryCurrentWeek(opts?: {
  term?: string
  date?: string
}): Promise<JWXTCurrentWeek> {
  return withJWXT(() => _queryCurrentWeek(opts))
}

async function queryExams(opts?: { term?: string }): Promise<JWXTExam[]> {
  return withJWXT(() => _queryExams(opts))
}

async function queryMakeupExamBatches(opts?: {
  term?: string
}): Promise<JWXTMakeupExamBatch[]> {
  return withJWXT(() => _queryMakeupExamBatches(opts))
}

async function queryMakeupExamCourses(opts?: {
  term?: string
  batchId?: string
  registered?: boolean
  pageSize?: number
}): Promise<JWXTMakeupExamCourse[]> {
  return withJWXT(() => _queryMakeupExamCourses(opts))
}

async function signupMakeupExam(args: {
  taskId: string
  batchId: string
  studentId?: string
}): Promise<void> {
  return withJWXT(() => _signupMakeupExam(args))
}

async function queryGradeYears(): Promise<JWXTCodeItem[]> {
  return withJWXT(() => _queryGradeYears())
}

async function queryDepartments(): Promise<JWXTCodeItem[]> {
  return withJWXT(() => _queryDepartments())
}

async function queryMajors(department?: string): Promise<JWXTMajorInfo[]> {
  return withJWXT(() => _queryMajors(department))
}

async function querySchoolClasses(opts?: {
  term?: string
  grade?: string
  department?: string
  major?: string
}): Promise<JWXTSchoolClassInfo[]> {
  return withJWXT(() => _querySchoolClasses(opts))
}

async function queryClassSchedule(
  classId: string,
  opts?: { term?: string }
): Promise<JWXTCourse[]> {
  return withJWXT(() => _queryClassSchedule(classId, opts))
}

async function queryCampuses(): Promise<JWXTCodeItem[]> {
  return withJWXT(() => _queryCampuses())
}

async function queryTeachingBuildings(campus?: string): Promise<JWXTCodeItem[]> {
  return withJWXT(() => _queryTeachingBuildings(campus))
}

async function queryClassrooms(opts?: {
  term?: string
  name?: string
  campus?: string
  building?: string
}): Promise<JWXTClassroomInfo[]> {
  return withJWXT(() => _queryClassrooms(opts))
}

async function queryClassroomSchedule(
  code: string,
  opts?: { term?: string }
): Promise<JWXTCourse[]> {
  return withJWXT(() => _queryClassroomSchedule(code, opts))
}

async function queryTrainingPlan(opts?: {
  pageSize?: number
  pageNumber?: number
}): Promise<JWXTTrainingPlan[]> {
  return withJWXT(() => _queryTrainingPlan(opts))
}

async function queryAcademicCompletion(): Promise<JWXTAcademicCompletion> {
  return withJWXT(() => _queryAcademicCompletion())
}

async function recalculateAcademicCompletion(): Promise<JWXTAcademicCompletion> {
  return withJWXT(() => _recalculateAcademicCompletion())
}

async function queryAcademicWarnings(): Promise<JWXTAcademicWarning[]> {
  return withJWXT(() => _queryAcademicWarnings())
}

async function queryEvaluationTypes(opts?: {
  term?: string
}): Promise<JWXTEvaluationType[]> {
  return withJWXT(() => _queryEvaluationTypes(opts))
}

async function queryPendingEvaluations(
  evalType: string,
  opts?: { term?: string }
): Promise<JWXTEvaluationTask[]> {
  return withJWXT(() => _queryPendingEvaluations(evalType, opts))
}

async function queryEvaluationDetail(
  groupNo: string,
  evalType: string,
  opts?: { sequence?: number }
): Promise<JWXTEvaluationDetail> {
  return withJWXT(() => _getEvaluationDetail(groupNo, evalType, opts))
}

async function calculateEvaluationScore(
  groupNo: string,
  wjid: string,
  evalType: string,
  answers: readonly JWXTEvaluationAnswer[],
  opts?: {
    teacherRelationId?: string
    courseName?: string
    teacherName?: string
    sequence?: number
  }
): Promise<Record<string, unknown>> {
  return withJWXT(() => _calculateEvaluationScore(groupNo, wjid, evalType, answers, opts))
}

async function submitEvaluation(
  groupNo: string,
  wjid: string,
  evalType: string,
  answers: readonly JWXTEvaluationAnswer[],
  opts?: {
    teacherRelationId?: string
    courseName?: string
    teacherName?: string
    sequence?: number
  }
): Promise<void> {
  return withJWXT(() => _submitEvaluation(groupNo, wjid, evalType, answers, opts))
}

  return {
    queryStudentInfo,
    queryGrades,
    queryGpaStats,
    queryGradeStatistics,
    queryGradeDistribution,
    queryGradeRanking,
    querySchedule,
    queryExperimentalSchedule,
    queryUnscheduledCourses,
    queryClassPeriods,
    queryTermCalendar,
    queryCurrentWeek,
    queryExams,
    queryMakeupExamBatches,
    queryMakeupExamCourses,
    signupMakeupExam,
    queryGradeYears,
    queryDepartments,
    queryMajors,
    querySchoolClasses,
    queryClassSchedule,
    queryCampuses,
    queryTeachingBuildings,
    queryClassrooms,
    queryClassroomSchedule,
    queryTrainingPlan,
    queryAcademicCompletion,
    recalculateAcademicCompletion,
    queryAcademicWarnings,
    queryEvaluationTypes,
    queryPendingEvaluations,
    queryEvaluationDetail,
    calculateEvaluationScore,
    submitEvaluation,
  }
}
