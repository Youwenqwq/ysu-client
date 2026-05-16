/**
 * API 调用层 —— 从 ``fetch`` 远程 ``ysu-api`` 迁移到本地 SDK 直连源站。
 *
 * 保持原有函数签名(``credential`` 参数在 JWXT 函数中变为可选,兼容现有调用方),
 * 内部通过 ``lib/cas.ts`` / ``lib/jwxt.ts`` 直接调用。
 */
import type {
  CalculateScoreRequest,
  Course,
  CurrentWeek,
  EvaluationDetail,
  EvaluationTask,
  EvaluationType,
  Exam,
  GPAStats,
  Grade,
  GradeDistribution,
  GradeRanking,
  GradeStatistics,
  LoginRequest,
  LoginResponse,
  MFAChallengeResponse,
  MFARequestCodeRequest,
  MFASubmitRequest,
  StatusResponse,
  Step1Request,
  Step1Response,
  StudentInfo,
  SubmitEvaluationRequest,
  TermCalendar,
  AcademicCompletion,
  AcademicWarning,
  TrainingPlan,
  ClassPeriod,
  CurrentLesson,
  SigninActivityDetail,
  StudentSigninStatus,
  StudentSignResult,
} from "./types";
import { useAuthStore } from "./auth-store";
import { resetSDK, persistJWXTSession } from "./sdk";
import {
  checkCaptchaNeeded as _checkCaptchaNeeded,
  loginStep1 as _loginStep1,
  requestMFACode as _requestMFACode,
  submitMFACode as _submitMFACode,
  isAuthenticated as _isAuthenticated,
  prepareLogin as _prepareLogin,
  CASCredential,
  getJar as getCasJar,
} from "./cas";
import {
  CASError,
  NeedCaptchaError,
  NotAuthenticatedError,
} from "./cas";
import {
  NotLoggedInError,
  JWXTBusinessError,
} from "./jwxt";
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
  queryTrainingPlan as _queryTrainingPlan,
  queryAcademicCompletion as _queryAcademicCompletion,
  queryAcademicWarnings as _queryAcademicWarnings,
  queryEvaluationTypes as _queryEvaluationTypes,
  queryPendingEvaluations as _queryPendingEvaluations,
  getEvaluationDetail as _getEvaluationDetail,
  calculateEvaluationScore as _calculateEvaluationScore,
  submitEvaluation as _submitEvaluation,
} from "./jwxt";
import {
  MobileNotLoggedInError,
  MobileBusinessError,
} from "./jwmobile";
import {
  checkRateLimit,
  recordLoginAttempt,
} from "./rate-limit";
import {
  queryCurrentLesson as _queryCurrentLesson,
  querySigninDetail as _querySigninDetail,
  queryStudentSigninStatus as _queryStudentSigninStatus,
  studentSign as _studentSign,
} from "./jwmobile";

function apiError(message: string, code?: string, status?: number): Error {
  const err = new Error(message);
  (err as Error & { code?: string; status?: number }).code = code;
  (err as Error & { code?: string; status?: number }).status = status;
  return err;
}

function mapSdkError(e: unknown): Error {
  if (
    e instanceof NotLoggedInError ||
    e instanceof NotAuthenticatedError ||
    e instanceof MobileNotLoggedInError
  ) {
    return apiError(e.message, "AUTH_REQUIRED", 401);
  }
  if (e instanceof JWXTBusinessError || e instanceof MobileBusinessError) {
    return apiError(
      e.msg ?? e.message,
      String(e.code ?? "JWXT_BUSINESS_ERROR"),
      400,
    );
  }
  if (
    e instanceof Error &&
    (e as Error & { code?: string }).code === "RATE_LIMITED"
  ) {
    return apiError(e.message, "RATE_LIMITED", 429);
  }
  if (e instanceof NeedCaptchaError) {
    return apiError(e.message, "NEED_CAPTCHA", 403);
  }
  if (e instanceof CASError) {
    return apiError(e.message, "CAS_ERROR", 500);
  }
  if (e instanceof Error) {
    return apiError(e.message, "SDK_ERROR", 500);
  }
  return apiError(String(e), "UNKNOWN_ERROR", 500);
}

// ── Auth ────────────────────────────────────────────────

export async function prepareLogin(): Promise<void> {
  return _prepareLogin();
}

export async function checkCaptchaNeeded(username: string): Promise<boolean> {
  try {
    return await _checkCaptchaNeeded(username);
  } catch {
    return false;
  }
}

export async function loginStep1(payload: Step1Request): Promise<Step1Response> {
  try {
    if (!payload.skip_rate_limit) {
      const limit = checkRateLimit();
      if (!limit.allowed) {
        const err = new Error("RATE_LIMITED");
        (err as Error & { code?: string; retryAfterMs?: number; reason?: string }).code = "RATE_LIMITED";
        (err as Error & { code?: string; retryAfterMs?: number; reason?: string }).retryAfterMs = limit.retryAfterMs;
        (err as Error & { code?: string; retryAfterMs?: number; reason?: string }).reason = limit.reason ?? undefined;
        throw err;
      }
      recordLoginAttempt();
    }

    const result = await _loginStep1(
      payload.username,
      payload.password,
      { captcha: payload.captcha },
    );
    const credential =
      result.authenticated || result.needsMfa
        ? (await CASCredential.fromJar(getCasJar())).toJSON()
        : undefined;
    return {
      authenticated: result.authenticated,
      needs_mfa: result.needsMfa,
      username: result.username,
      credential,
    };
  } catch (e) {
    throw mapSdkError(e);
  }
}

export async function requestMFACode(
  payload: MFARequestCodeRequest,
  _credential?: string,
): Promise<MFAChallengeResponse> {
  try {
    const challenge = await _requestMFACode(
      payload.username,
      payload.method,
    );
    return {
      method: challenge.method,
      method_code: challenge.methodCode,
      mobile_hint: challenge.mobileHint,
      username: challenge.username,
    };
  } catch (e) {
    throw mapSdkError(e);
  }
}

export async function submitMFACode(
  payload: MFASubmitRequest,
  _credential?: string,
): Promise<LoginResponse> {
  try {
    const challenge = {
      method: payload.method as "sms" | "cpdaily",
      methodCode: payload.method_code,
      mobileHint: "",
      username: payload.username,
      raw: {},
    };
    const credential = await _submitMFACode(challenge, payload.code);
    const json = credential.toJSON();
    useAuthStore.getState().setCredential(json, payload.username);
    return { credential: json };
  } catch (e) {
    throw mapSdkError(e);
  }
}

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const step1 = await loginStep1({
    username: payload.username,
    password: payload.password,
    captcha: payload.captcha,
  });
  if (step1.authenticated) {
    const credential = await CASCredential.fromJar(getCasJar());
    const json = credential.toJSON();
    useAuthStore.getState().setCredential(json, payload.username);
    return { credential: json };
  }
  if (step1.needs_mfa && payload.mfa_code) {
    return submitMFACode({
      method: payload.mfa_method!,
      method_code: payload.mfa_method!,
      username: payload.username,
      code: payload.mfa_code,
    });
  }
  throw apiError("登录未完成,需要 MFA", "MFA_REQUIRED", 400);
}

export async function checkAuthStatus(_credential?: string): Promise<StatusResponse> {
  try {
    const authenticated = await _isAuthenticated();
    return { authenticated };
  } catch (e) {
    throw mapSdkError(e);
  }
}

// ── JWXT helper ─────────────────────────────────────────

/** JWXT 调用 wrapper:错误映射 + 成功后持久化会话。 */
async function withJWXT<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    // 异步持久化 JWXT 会话,不阻塞返回
    persistJWXTSession().catch(() => {
      // ignore persist failures
    });
    return result;
  } catch (e) {
    throw mapSdkError(e);
  }
}

// ── Student Info ────────────────────────────────────────

export async function getStudentInfo(_credential?: string): Promise<StudentInfo> {
  return withJWXT(async () => {
    const info = await _queryStudentInfo();
    return {
      name: info.name,
      name_pinyin: info.namePinyin,
      student_id: info.studentId,
      gender: info.gender,
      nation: info.nation,
      nationality: info.nationality,
      department: info.department,
      major: info.major,
      class_name: info.className,
      grade_level: info.gradeLevel,
      enrollment_date: info.enrollmentDate,
      expected_graduation: info.expectedGraduation,
      education_level: info.educationLevel,
      campus: info.campus,
      student_status: info.studentStatus,
      discipline: info.discipline,
      study_duration: info.studyDuration,
      foreign_language: info.foreignLanguage,
    };
  });
}

// ── Grades ──────────────────────────────────────────────

export async function getGrades(
  _credential: string,
  params?: {
    term?: string;
    course_name?: string;
    page_size?: number;
    page_number?: number;
  },
): Promise<Grade[]> {
  return withJWXT(async () => {
    const rows = await _queryGrades({
      term: params?.term,
      courseName: params?.course_name,
      pageSize: params?.page_size ?? 100,
      pageNumber: params?.page_number ?? 1,
    });
    return rows.map((r) => ({
      course_name: r.courseName,
      course_code: r.courseCode,
      class_id: r.classId,
      score: r.score,
      grade_level: r.gradeLevel,
      grade_point: r.gradePoint,
      credit: r.credit,
      hours: r.hours,
      term: r.term,
      course_type: r.courseType,
      course_category: r.courseCategory,
      exam_type: r.examType,
      study_mode: r.studyMode,
      is_major: r.isMajor,
      is_retake: r.isRetake,
      grade_level_type: r.gradeLevelType,
      department: r.department,
      is_pass: r.isPass,
      is_valid: r.isValid,
      special_reason: r.specialReason,
      is_degree_course: r.isDegreeCourse,
      project_name: r.projectName,
    }));
  });
}

export async function getGPAStats(
  _credential: string,
  student_id?: string,
): Promise<GPAStats> {
  return withJWXT(async () => {
    const stats = await _queryGpaStats({
      studentId: student_id,
    });
    return {
      plan_name: stats.planName,
      study_type: stats.studyType,
      required_credit_earned: stats.requiredCreditEarned,
      elective_credit_earned: stats.electiveCreditEarned,
      degree_credit_earned: stats.degreeCreditEarned,
      required_credit_failed: stats.requiredCreditFailed,
      gpa_initial: stats.gpaInitial,
      gpa_highest: stats.gpaHighest,
      required_gpa_highest: stats.requiredGpaHighest,
      degree_gpa_initial: stats.degreeGpaInitial,
      degree_gpa_highest: stats.degreeGpaHighest,
      weighted_avg: stats.weightedAvg,
      arithmetic_avg: stats.arithmeticAvg,
      degree_weighted_avg: stats.degreeWeightedAvg,
    };
  });
}

export async function getGradeStatistics(
  _credential: string,
  params?: { class_id?: string; course_code?: string; term?: string },
): Promise<GradeStatistics> {
  return withJWXT(async () => {
    const s = await _queryGradeStatistics({
      term: params?.term,
      classId: params?.class_id,
      courseCode: params?.course_code,
    });
    return {
      scope: s.scope,
      term: s.term,
      class_id: s.classId,
      course_code: s.courseCode,
      highest_score: s.highestScore,
      lowest_score: s.lowestScore,
      average_score: s.averageScore,
    };
  });
}

export async function getGradeDistribution(
  _credential: string,
  params?: { class_id?: string; course_code?: string; term?: string },
): Promise<GradeDistribution[]> {
  return withJWXT(async () => {
    const rows = await _queryGradeDistribution({
      term: params?.term,
      classId: params?.class_id,
      courseCode: params?.course_code,
    });
    return rows.map((r) => ({
      scope: r.scope,
      term: r.term,
      class_id: r.classId,
      course_code: r.courseCode,
      level_code: r.levelCode,
      level_name: r.levelName,
      count: r.count,
    }));
  });
}

export async function getGradeRanking(
  _credential: string,
  params?: {
    class_id?: string;
    course_code?: string;
    term?: string;
    student_id?: string;
  },
): Promise<GradeRanking> {
  return withJWXT(async () => {
    const r = await _queryGradeRanking({
      term: params?.term,
      studentId: params?.student_id,
      classId: params?.class_id,
      courseCode: params?.course_code,
    });
    return {
      scope: r.scope,
      term: r.term,
      student_id: r.studentId,
      class_id: r.classId,
      course_code: r.courseCode,
      score: r.score,
      rank: r.rank,
      total: r.total,
      ranking_type: r.rankingType,
    };
  });
}

// ── Schedule ────────────────────────────────────────────

export async function getSchedule(
  _credential: string,
  term?: string,
): Promise<Course[]> {
  return withJWXT(async () => {
    const rows = await _querySchedule({ term });
    return rows.map(mapCourse);
  });
}

export async function getExperimentalSchedule(
  _credential: string,
  term?: string,
  course_category = "all",
): Promise<Course[]> {
  return withJWXT(async () => {
    const rows = await _queryScheduleExperimental({
      term,
      courseCategory: course_category,
    });
    return rows.map(mapCourse);
  });
}

export async function getUnscheduledCourses(
  _credential: string,
  term?: string,
  course_category = "all",
): Promise<Course[]> {
  return withJWXT(async () => {
    const rows = await _queryUnscheduledCourses({
      term,
      courseCategory: course_category,
    });
    return rows.map(mapCourse);
  });
}

function mapCourse(r: {
  name?: string;
  code?: string;
  teacher?: string;
  classroom?: string;
  weekDay?: number;
  startSection?: number;
  endSection?: number;
  weeks?: string;
  credit?: string;
  courseType?: string;
  classId?: string;
  syxzdm?: string;
  scheduleId?: string;
  classType?: string;
  raw?: Record<string, unknown>;
}): Course {
  return {
    name: r.name ?? "",
    code: r.code,
    teacher: r.teacher,
    classroom: r.classroom,
    week_day: r.weekDay ?? 0,
    start_section: r.startSection ?? 0,
    end_section: r.endSection ?? 0,
    weeks: r.weeks,
    credit: r.credit,
    course_type: r.courseType,
    class_id: r.classId,
    syxzdm: r.syxzdm,
    schedule_id: r.scheduleId,
    class_type: r.classType,
    raw: r.raw,
  };
}

export async function getClassPeriods(_credential?: string): Promise<ClassPeriod[]> {
  return withJWXT(async () => {
    const rows = await _queryClassPeriods();
    return rows.map((r) => ({
      name: r.name,
      section: r.section,
      start_time: r.startTime,
      end_time: r.endTime,
      is_in_use: r.isInUse,
    }));
  });
}

export async function getTermCalendar(
  _credential: string,
  term?: string,
): Promise<TermCalendar> {
  return withJWXT(async () => {
    const c = await _queryTermCalendar({ term });
    return {
      term: c.term,
      start_date: c.startDate,
      total_weeks: c.totalWeeks,
      teaching_weeks: c.teachingWeeks,
      is_in_use: c.isInUse,
    };
  });
}

export async function getCurrentWeek(
  _credential: string,
  term?: string,
  date?: string,
): Promise<CurrentWeek> {
  return withJWXT(async () => {
    const w = await _queryCurrentWeek({ term, date });
    return {
      week: w.week,
      weekday: w.weekday,
      term: w.term,
      date: w.date,
    };
  });
}

// ── Exams ───────────────────────────────────────────────

export async function getExams(
  _credential: string,
  term?: string,
): Promise<Exam[]> {
  return withJWXT(async () => {
    const rows = await _queryExams({ term });
    return rows.map((r) => ({
      name: r.name,
      exam_name: r.examName,
      exam_date: r.examDate,
      exam_time: r.examTime,
      exam_location: r.examLocation,
      seat_number: r.seatNumber,
    }));
  });
}

// ── Training Plan / Academic ────────────────────────────

export async function getTrainingPlan(
  _credential: string,
  params?: { page_size?: number; page_number?: number },
): Promise<TrainingPlan[]> {
  return withJWXT(async () => {
    const rows = await _queryTrainingPlan({
      pageSize: params?.page_size ?? 500,
      pageNumber: params?.page_number ?? 1,
    });
    return rows.map((r) => ({
      course_name: r.courseName,
      course_code: r.courseCode,
      credit: r.credit,
      course_type: r.courseType,
      required: r.required,
      term: r.term,
      course_group: r.courseGroup,
    }));
  });
}

export async function getAcademicCompletion(
  _credential: string,
): Promise<AcademicCompletion> {
  return withJWXT(async () => {
    const c = await _queryAcademicCompletion();
    return {
      plan_name: c.planName,
      total_required: c.totalRequired,
      completed: c.completed,
      elective: c.elective,
      passed: c.passed,
    };
  });
}

export async function getAcademicWarnings(
  _credential: string,
): Promise<AcademicWarning[]> {
  return withJWXT(async () => {
    const rows = await _queryAcademicWarnings();
    return rows.map((r) => ({
      warning_type: r.warningType,
      warning_level: r.warningLevel,
      description: r.description,
      term: r.term,
    }));
  });
}

// ── Evaluation ──────────────────────────────────────────

export async function getEvaluationTypes(
  _credential: string,
  term?: string,
): Promise<EvaluationType[]> {
  return withJWXT(async () => {
    const rows = await _queryEvaluationTypes({ term });
    return rows.map((r) => ({
      name: r.name,
      code: r.code,
      count: r.count,
    }));
  });
}

export async function getPendingEvaluations(
  _credential: string,
  eval_type: string,
  term?: string,
): Promise<EvaluationTask[]> {
  return withJWXT(async () => {
    const rows = await _queryPendingEvaluations(eval_type, { term });
    return rows.map((r) => ({
      wid: r.wid,
      wjid: r.wjid,
      name: r.name,
      course_name: r.courseName,
      teacher_name: r.teacherName,
      teacher_id: r.teacherId,
      term: r.term,
      term_name: r.termName,
      eval_type: r.evalType,
      eval_type_name: r.evalTypeName,
      category: r.category,
      category_name: r.categoryName,
      start_time: r.startTime,
      end_time: r.endTime,
      sequence: r.sequence,
      class_name: r.className,
      group_no: r.groupNo,
    }));
  });
}

export async function getEvaluationDetail(
  _credential: string,
  group_no: string,
  eval_type: string,
  sequence = 1,
): Promise<EvaluationDetail> {
  return withJWXT(async () => {
    const d = await _getEvaluationDetail(group_no, eval_type, { sequence });
    return {
      wjid: d.wjid,
      name: d.name,
      deadline: d.deadline,
      questions:
        d.questions?.map((q) => ({
          tmid: q.tmid,
          wjid: q.wjid,
          text: q.text,
          question_type: q.questionType,
          max_score: q.maxScore,
          order: q.order,
          options:
            q.options?.map((o) => ({
              wid: o.wid,
              text: o.text,
              score: o.score,
              score_ratio: o.scoreRatio,
              question_id: o.questionId,
            })) ?? [],
        })) ?? [],
      teachers: d.teachers as Record<string, unknown>[],
    };
  });
}

export async function calculateScore(
  _credential: string,
  payload: CalculateScoreRequest,
): Promise<Record<string, unknown>> {
  return withJWXT(async () => {
    return _calculateEvaluationScore(
      payload.group_no,
      payload.wjid,
      payload.eval_type,
      payload.answers.map((a) => ({
        tmid: a.tmid,
        questionType: a.question_type ?? "",
        optionIds: a.option_ids ?? [],
        text: a.text ?? "",
      })),
      {
        teacherRelationId: payload.teacher_relation_id,
        courseName: payload.course_name,
        teacherName: payload.teacher_name,
        sequence: payload.sequence,
      },
    );
  });
}

export async function submitEvaluation(
  _credential: string,
  payload: SubmitEvaluationRequest,
): Promise<{ detail: string }> {
  return withJWXT(async () => {
    await _submitEvaluation(
      payload.group_no,
      payload.wjid,
      payload.eval_type,
      payload.answers.map((a) => ({
        tmid: a.tmid,
        questionType: a.question_type ?? "",
        optionIds: a.option_ids ?? [],
        text: a.text ?? "",
      })),
      {
        teacherRelationId: payload.teacher_relation_id,
        courseName: payload.course_name,
        teacherName: payload.teacher_name,
        sequence: payload.sequence,
      },
    );
    return { detail: "ok" };
  });
}

// ── Lesson / Activity ────────────────────────────────────

export async function getCurrentLesson(
  _credential: string,
  params: {
    teach_class_id: string;
    teach_class_type: string;
    schedule_id: string;
    week: number;
    week_day: number;
    start_node: number;
    end_node: number;
  },
): Promise<CurrentLesson> {
  try {
    const result = await _queryCurrentLesson({
      teachClassId: params.teach_class_id,
      teachClassType: params.teach_class_type,
      scheduleId: params.schedule_id,
      week: params.week,
      weekDay: params.week_day,
      startNode: params.start_node,
      endNode: params.end_node,
    });
    return {
      lesson_id: result.lessonId,
      activity_list: result.activityList.map((a) => ({
        activity_id: a.activityId,
        type: a.type,
        status: a.status,
        title: a.title,
        icon: a.icon,
        sign_type: a.signType,
        sign_clazz: a.signClazz,
        is_end: a.isEnd,
        is_creator: a.isCreator,
        create_time: a.createTime,
        raw: a.raw,
      })),
      raw: result.raw,
    };
  } catch (e) {
    throw mapSdkError(e);
  }
}

export async function getSigninDetail(
  _credential: string,
  params: {
    activity_id: string;
    title?: string;
  },
): Promise<SigninActivityDetail> {
  try {
    const result = await _querySigninDetail({
      activityId: params.activity_id,
      title: params.title,
    });
    return {
      activity_id: result.activityId,
      duration: result.duration,
      end_time: result.endTime,
      left_seconds: result.leftSeconds,
      signin_type: result.signinType,
      start_time: result.startTime,
      raw: result.raw,
    };
  } catch (e) {
    throw mapSdkError(e);
  }
}

export async function getStudentSigninStatus(
  _credential: string,
  params: {
    activity_id: string;
    title?: string;
  },
): Promise<StudentSigninStatus> {
  try {
    const result = await _queryStudentSigninStatus({
      activityId: params.activity_id,
      title: params.title,
    });
    return {
      sign_status: result.signStatus,
      attendance_status: result.attendanceStatus,
      sign_order: result.signOrder,
      signin_type: result.signinType,
      raw: result.raw,
    };
  } catch (e) {
    throw mapSdkError(e);
  }
}

export async function doStudentSign(
  _credential: string,
  params: {
    activity_id: string;
    accuracy?: number;
    latitude?: number;
    longitude?: number;
    code?: string;
  },
): Promise<StudentSignResult> {
  try {
    const result = await _studentSign({
      activityId: params.activity_id,
      accuracy: params.accuracy,
      latitude: params.latitude,
      longitude: params.longitude,
      code: params.code,
    });
    return {
      sign_status: result.signStatus,
      attendance_status: result.attendanceStatus,
      sign_order: result.signOrder,
      signin_type: result.signinType,
      raw: result.raw,
    };
  } catch (e) {
    throw mapSdkError(e);
  }
}
