/**
 * EMAP data fetcher wrapper for YSU Provider.
 *
 * Wraps lib/jwxt.ts functions with withJWXT() helper that persists
 * JWXT session after successful calls and maps errors to ProviderError.
 */
import { persistJWXTSession } from "./session";
import {
  NotLoggedInError,
  JWXTBusinessError,
  JWXTProtocolError,
  JWXTError,
} from "./protocol/jwxt";
import { ProviderError, ProviderErrorCode, wrapError } from "../errors";
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
} from "./protocol/jwxt";
import {
  queryStudentInfo as _queryStudentInfo,
  queryGrades as _queryGrades,
  queryGpaStats as _queryGpaStats,
  queryGradeStatistics as _queryGradeStatistics,
  queryGradeDistribution as _queryGradeDistribution,
  queryGradeRanking as _queryGradeRanking,
  querySchedule as _querySchedule,
  queryScheduleExperimental as _queryScheduleExperimental,
  queryUnscheduledCourses as _queryUnscheduledCourses,
  queryClassPeriods as _queryClassPeriods,
  queryTermCalendar as _queryTermCalendar,
  queryCurrentWeek as _queryCurrentWeek,
  queryExams as _queryExams,
  queryMakeupExamBatches as _queryMakeupExamBatches,
  queryMakeupExamCourses as _queryMakeupExamCourses,
  queryGradeYears as _queryGradeYears,
  queryDepartments as _queryDepartments,
  queryMajors as _queryMajors,
  querySchoolClasses as _querySchoolClasses,
  queryClassSchedule as _queryClassSchedule,
  queryCampuses as _queryCampuses,
  queryTeachingBuildings as _queryTeachingBuildings,
  queryClassrooms as _queryClassrooms,
  queryClassroomSchedule as _queryClassroomSchedule,
  signupMakeupExam as _signupMakeupExam,
  queryTrainingPlan as _queryTrainingPlan,
  queryAcademicCompletion as _queryAcademicCompletion,
  queryAcademicWarnings as _queryAcademicWarnings,
  queryEvaluationTypes as _queryEvaluationTypes,
  queryPendingEvaluations as _queryPendingEvaluations,
  getEvaluationDetail as _getEvaluationDetail,
  calculateEvaluationScore as _calculateEvaluationScore,
  submitEvaluation as _submitEvaluation,
} from "./protocol/jwxt";

function mapJWXTError(e: unknown): ProviderError {
  if (e instanceof NotLoggedInError) {
    return new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, e.message, e, 401);
  }
  if (e instanceof JWXTBusinessError) {
    return new ProviderError(
      ProviderErrorCode.BACKEND_BUSINESS_ERROR,
      e.msg ?? e.message,
      e,
      400,
    );
  }
  if (e instanceof JWXTProtocolError) {
    return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500);
  }
  if (e instanceof JWXTError) {
    return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500);
  }
  return wrapError(e);
}

async function withJWXT<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    persistJWXTSession().catch((e) => {
      console.warn("Failed to persist JWXT session", e);
    });
    return result;
  } catch (e) {
    throw mapJWXTError(e);
  }
}

export async function queryStudentInfo(): Promise<JWXTStudentInfo> {
  return withJWXT(() => _queryStudentInfo());
}

export async function queryGrades(opts?: {
  term?: string;
  courseName?: string;
  pageSize?: number;
  pageNumber?: number;
}): Promise<JWXTGrade[]> {
  return withJWXT(() => _queryGrades(opts));
}

export async function queryGpaStats(opts?: { studentId?: string }): Promise<JWXTGPAStats> {
  return withJWXT(() => _queryGpaStats(opts));
}

export async function queryGradeStatistics(opts?: {
  term?: string;
  classId?: string;
  courseCode?: string;
}): Promise<JWXTGradeStatistics> {
  return withJWXT(() => _queryGradeStatistics(opts));
}

export async function queryGradeDistribution(opts?: {
  term?: string;
  classId?: string;
  courseCode?: string;
}): Promise<JWXTGradeDistribution[]> {
  return withJWXT(() => _queryGradeDistribution(opts));
}

export async function queryGradeRanking(opts?: {
  term?: string;
  studentId?: string;
  classId?: string;
  courseCode?: string;
}): Promise<JWXTGradeRanking> {
  return withJWXT(() => _queryGradeRanking(opts));
}

export async function querySchedule(opts?: { term?: string }): Promise<JWXTCourse[]> {
  return withJWXT(() => _querySchedule(opts));
}

export async function queryExperimentalSchedule(opts?: {
  term?: string;
  studentId?: string;
  courseCategory?: string;
}): Promise<JWXTCourse[]> {
  return withJWXT(() => _queryScheduleExperimental(opts));
}

export async function queryUnscheduledCourses(opts?: {
  term?: string;
  studentId?: string;
  courseCategory?: string;
}): Promise<JWXTCourse[]> {
  return withJWXT(() => _queryUnscheduledCourses(opts));
}

export async function queryClassPeriods(): Promise<JWXTClassPeriod[]> {
  return withJWXT(() => _queryClassPeriods());
}

export async function queryTermCalendar(opts?: { term?: string }): Promise<JWXTTermCalendar> {
  return withJWXT(() => _queryTermCalendar(opts));
}

export async function queryCurrentWeek(opts?: {
  term?: string;
  date?: string;
}): Promise<JWXTCurrentWeek> {
  return withJWXT(() => _queryCurrentWeek(opts));
}

export async function queryExams(opts?: { term?: string }): Promise<JWXTExam[]> {
  return withJWXT(() => _queryExams(opts));
}

export async function queryMakeupExamBatches(opts?: {
  term?: string;
}): Promise<JWXTMakeupExamBatch[]> {
  return withJWXT(() => _queryMakeupExamBatches(opts));
}

export async function queryMakeupExamCourses(opts?: {
  term?: string;
  batchId?: string;
  registered?: boolean;
  pageSize?: number;
}): Promise<JWXTMakeupExamCourse[]> {
  return withJWXT(() => _queryMakeupExamCourses(opts));
}

export async function signupMakeupExam(args: {
  taskId: string;
  batchId: string;
  studentId?: string;
}): Promise<void> {
  return withJWXT(() => _signupMakeupExam(args));
}

export async function queryGradeYears(): Promise<JWXTCodeItem[]> {
  return withJWXT(() => _queryGradeYears());
}

export async function queryDepartments(): Promise<JWXTCodeItem[]> {
  return withJWXT(() => _queryDepartments());
}

export async function queryMajors(department?: string): Promise<JWXTMajorInfo[]> {
  return withJWXT(() => _queryMajors(department));
}

export async function querySchoolClasses(opts?: {
  term?: string;
  grade?: string;
  department?: string;
  major?: string;
}): Promise<JWXTSchoolClassInfo[]> {
  return withJWXT(() => _querySchoolClasses(opts));
}

export async function queryClassSchedule(
  classId: string,
  opts?: { term?: string },
): Promise<JWXTCourse[]> {
  return withJWXT(() => _queryClassSchedule(classId, opts));
}

export async function queryCampuses(): Promise<JWXTCodeItem[]> {
  return withJWXT(() => _queryCampuses());
}

export async function queryTeachingBuildings(campus?: string): Promise<JWXTCodeItem[]> {
  return withJWXT(() => _queryTeachingBuildings(campus));
}

export async function queryClassrooms(opts?: {
  term?: string;
  name?: string;
  campus?: string;
  building?: string;
}): Promise<JWXTClassroomInfo[]> {
  return withJWXT(() => _queryClassrooms(opts));
}

export async function queryClassroomSchedule(
  code: string,
  opts?: { term?: string },
): Promise<JWXTCourse[]> {
  return withJWXT(() => _queryClassroomSchedule(code, opts));
}

export async function queryTrainingPlan(opts?: {
  pageSize?: number;
  pageNumber?: number;
}): Promise<JWXTTrainingPlan[]> {
  return withJWXT(() => _queryTrainingPlan(opts));
}

export async function queryAcademicCompletion(): Promise<JWXTAcademicCompletion> {
  return withJWXT(() => _queryAcademicCompletion());
}

export async function queryAcademicWarnings(): Promise<JWXTAcademicWarning[]> {
  return withJWXT(() => _queryAcademicWarnings());
}

export async function queryEvaluationTypes(opts?: { term?: string }): Promise<JWXTEvaluationType[]> {
  return withJWXT(() => _queryEvaluationTypes(opts));
}

export async function queryPendingEvaluations(
  evalType: string,
  opts?: { term?: string },
): Promise<JWXTEvaluationTask[]> {
  return withJWXT(() => _queryPendingEvaluations(evalType, opts));
}

export async function queryEvaluationDetail(
  groupNo: string,
  evalType: string,
  opts?: { sequence?: number },
): Promise<JWXTEvaluationDetail> {
  return withJWXT(() => _getEvaluationDetail(groupNo, evalType, opts));
}

export async function calculateEvaluationScore(
  groupNo: string,
  wjid: string,
  evalType: string,
  answers: readonly JWXTEvaluationAnswer[],
  opts?: {
    teacherRelationId?: string;
    courseName?: string;
    teacherName?: string;
    sequence?: number;
  },
): Promise<Record<string, unknown>> {
  return withJWXT(() =>
    _calculateEvaluationScore(groupNo, wjid, evalType, answers, opts),
  );
}

export async function submitEvaluation(
  groupNo: string,
  wjid: string,
  evalType: string,
  answers: readonly JWXTEvaluationAnswer[],
  opts?: {
    teacherRelationId?: string;
    courseName?: string;
    teacherName?: string;
    sequence?: number;
  },
): Promise<void> {
  return withJWXT(() => _submitEvaluation(groupNo, wjid, evalType, answers, opts));
}
