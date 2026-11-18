/**
 * EMAP data fetcher wrapper for YSU Provider.
 */
import { ProviderError, ProviderErrorCode, wrapError } from "@orahako/academic-sdk"
import {
  JWXTBusinessError,
  JWXTError,
  JWXTProtocolError,
  NotLoggedInError,
  type AcademicCompletion as JWXTAcademicCompletion,
  type AcademicWarning as JWXTAcademicWarning,
  type ClassPeriod as JWXTClassPeriod,
  type ClassroomInfo as JWXTClassroomInfo,
  type CodeItem as JWXTCodeItem,
  type Course as JWXTCourse,
  type CurrentWeek as JWXTCurrentWeek,
  type EvaluationAnswer as JWXTEvaluationAnswer,
  type EvaluationDetail as JWXTEvaluationDetail,
  type EvaluationTask as JWXTEvaluationTask,
  type EvaluationType as JWXTEvaluationType,
  type Exam as JWXTExam,
  type GPAStats as JWXTGPAStats,
  type Grade as JWXTGrade,
  type GradeDistribution as JWXTGradeDistribution,
  type GradeRanking as JWXTGradeRanking,
  type GradeStatistics as JWXTGradeStatistics,
  type JWXTProtocol,
  type MajorInfo as JWXTMajorInfo,
  type MakeupExamBatch as JWXTMakeupExamBatch,
  type MakeupExamCourse as JWXTMakeupExamCourse,
  type SchoolClassInfo as JWXTSchoolClassInfo,
  type StudentInfo as JWXTStudentInfo,
  type TermCalendar as JWXTTermCalendar,
  type TrainingPlan as JWXTTrainingPlan,
} from "./protocol/jwxt"

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
      persistJWXTSession().catch(() => {
        /* ignore session artifact write failure */
      })
      return result
    } catch (e) {
      throw mapJWXTError(e)
    }
  }

  return {
    queryStudentInfo: (): Promise<JWXTStudentInfo> => withJWXT(() => jwxt.queryStudentInfo()),
    queryGrades: (opts): Promise<JWXTGrade[]> => withJWXT(() => jwxt.queryGrades(opts)),
    queryGpaStats: (opts): Promise<JWXTGPAStats> => withJWXT(() => jwxt.queryGpaStats(opts)),
    queryGradeStatistics: (opts): Promise<JWXTGradeStatistics> =>
      withJWXT(() => jwxt.queryGradeStatistics(opts)),
    queryGradeDistribution: (opts): Promise<JWXTGradeDistribution[]> =>
      withJWXT(() => jwxt.queryGradeDistribution(opts)),
    queryGradeRanking: (opts): Promise<JWXTGradeRanking> =>
      withJWXT(() => jwxt.queryGradeRanking(opts)),
    querySchedule: (opts): Promise<JWXTCourse[]> => withJWXT(() => jwxt.querySchedule(opts)),
    queryExperimentalSchedule: (opts): Promise<JWXTCourse[]> =>
      withJWXT(() => jwxt.queryScheduleExperimental(opts)),
    queryUnscheduledCourses: (opts): Promise<JWXTCourse[]> =>
      withJWXT(() => jwxt.queryUnscheduledCourses(opts)),
    queryClassPeriods: (): Promise<JWXTClassPeriod[]> => withJWXT(() => jwxt.queryClassPeriods()),
    queryTermCalendar: (opts): Promise<JWXTTermCalendar> =>
      withJWXT(() => jwxt.queryTermCalendar(opts)),
    queryCurrentWeek: (opts): Promise<JWXTCurrentWeek> =>
      withJWXT(() => jwxt.queryCurrentWeek(opts)),
    queryExams: (opts): Promise<JWXTExam[]> => withJWXT(() => jwxt.queryExams(opts)),
    queryMakeupExamBatches: (opts): Promise<JWXTMakeupExamBatch[]> =>
      withJWXT(() => jwxt.queryMakeupExamBatches(opts)),
    queryMakeupExamCourses: (opts): Promise<JWXTMakeupExamCourse[]> =>
      withJWXT(() => jwxt.queryMakeupExamCourses(opts)),
    signupMakeupExam: (args): Promise<void> => withJWXT(() => jwxt.signupMakeupExam(args)),
    queryGradeYears: (): Promise<JWXTCodeItem[]> => withJWXT(() => jwxt.queryGradeYears()),
    queryDepartments: (): Promise<JWXTCodeItem[]> => withJWXT(() => jwxt.queryDepartments()),
    queryMajors: (department): Promise<JWXTMajorInfo[]> =>
      withJWXT(() => jwxt.queryMajors(department)),
    querySchoolClasses: (opts): Promise<JWXTSchoolClassInfo[]> =>
      withJWXT(() => jwxt.querySchoolClasses(opts)),
    queryClassSchedule: (classId, opts): Promise<JWXTCourse[]> =>
      withJWXT(() => jwxt.queryClassSchedule(classId, opts)),
    queryCampuses: (): Promise<JWXTCodeItem[]> => withJWXT(() => jwxt.queryCampuses()),
    queryTeachingBuildings: (campus): Promise<JWXTCodeItem[]> =>
      withJWXT(() => jwxt.queryTeachingBuildings(campus)),
    queryClassrooms: (opts): Promise<JWXTClassroomInfo[]> =>
      withJWXT(() => jwxt.queryClassrooms(opts)),
    queryClassroomSchedule: (code, opts): Promise<JWXTCourse[]> =>
      withJWXT(() => jwxt.queryClassroomSchedule(code, opts)),
    queryTrainingPlan: (opts): Promise<JWXTTrainingPlan[]> =>
      withJWXT(() => jwxt.queryTrainingPlan(opts)),
    queryAcademicCompletion: (): Promise<JWXTAcademicCompletion> =>
      withJWXT(() => jwxt.queryAcademicCompletion()),
    recalculateAcademicCompletion: (): Promise<JWXTAcademicCompletion> =>
      withJWXT(() => jwxt.recalculateAcademicCompletion()),
    queryAcademicWarnings: (): Promise<JWXTAcademicWarning[]> =>
      withJWXT(() => jwxt.queryAcademicWarnings()),
    queryEvaluationTypes: (opts): Promise<JWXTEvaluationType[]> =>
      withJWXT(() => jwxt.queryEvaluationTypes(opts)),
    queryPendingEvaluations: (evalType, opts): Promise<JWXTEvaluationTask[]> =>
      withJWXT(() => jwxt.queryPendingEvaluations(evalType, opts)),
    queryEvaluationDetail: (groupNo, evalType, opts): Promise<JWXTEvaluationDetail> =>
      withJWXT(() => jwxt.getEvaluationDetail(groupNo, evalType, opts)),
    calculateEvaluationScore: (
      groupNo: string,
      wjid: string,
      evalType: string,
      answers: readonly JWXTEvaluationAnswer[],
      opts
    ): Promise<Record<string, unknown>> =>
      withJWXT(() => jwxt.calculateEvaluationScore(groupNo, wjid, evalType, answers, opts)),
    submitEvaluation: (
      groupNo: string,
      wjid: string,
      evalType: string,
      answers: readonly JWXTEvaluationAnswer[],
      opts
    ): Promise<void> =>
      withJWXT(() => jwxt.submitEvaluation(groupNo, wjid, evalType, answers, opts)),
  }
}
