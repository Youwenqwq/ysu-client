import type { AcademicCompletion as ProtocolAcademicCompletion } from "./protocol/jwxt";
import { useAuthStore } from "@/lib/stores/auth";
import { getSchoolConfig, isFeatureAvailable } from "@/lib/server-config";
import { BaseProvider } from "../base-provider";
import { ProviderError, ProviderErrorCode } from "../errors";
import type {
  AcademicCapabilities,
  AcademicCompletion,
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
  Course,
  CatalogPage,
  CatalogQueryOptions,
  Competition,
  CreditBatch,
  CreditDeclaration,
  CreditQueryOptions,
  CreditRecord,
  CreditSummary,
  Credential,
  CurrentWeek,
  EvaluationAnswer,
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
  EnrollableActivity,
  LoginStep1Input,
  LoginStep1Result,
  MfaChallenge,
  MfaRequestInput,
  MfaSubmitInput,
  MajorInfo,
  MakeupExamBatch,
  MakeupExamCourse,
  MakeupExamCourseQueryOptions,
  MakeupExamSignupInput,
  PageQueryOptions,
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
  WechatMfaContext,
  WechatQrPollResult,
} from "../types";
import {
  checkCaptchaNeeded,
  completeWechatMFA,
  getCaptchaUrl,
  initiateWechatMFA,
  isAuthenticated as checkCASAuthenticated,
  loginStep1,
  pollWechatQR,
  prepareLogin,
  requestMFACode,
  resetLoginSession,
  saveCredential,
  submitMFACode,
} from "./cas-auth";
import {
  calculateEvaluationScore as _calculateEvaluationScore,
  queryAcademicCompletion,
  recalculateAcademicCompletion as recalculateAcademicCompletionImpl,
  queryAcademicWarnings,
  queryClassPeriods,
  queryCurrentWeek,
  queryEvaluationDetail,
  queryEvaluationTypes,
  queryExams,
  queryMakeupExamBatches,
  queryMakeupExamCourses,
  queryGradeYears,
  queryDepartments,
  queryMajors,
  querySchoolClasses,
  queryClassSchedule,
  queryCampuses,
  queryTeachingBuildings,
  queryClassrooms,
  queryClassroomSchedule,
  signupMakeupExam,
  queryExperimentalSchedule,
  queryGpaStats,
  queryGradeDistribution,
  queryGradeRanking,
  queryGradeStatistics,
  queryGrades,
  queryPendingEvaluations,
  querySchedule,
  queryStudentInfo,
  queryTermCalendar,
  queryTrainingPlan,
  queryUnscheduledCourses,
  submitEvaluation as _submitEvaluation,
} from "./emap-fetcher";
import {
  queryEnrollableActivities,
  queryLaborRecords,
  queryLaborSummary,
} from "./ldxt-fetcher";
import {
  queryAllCreditRecords,
  queryCompetitions,
  queryCreditBatches,
  queryCreditDeclarations,
  queryCreditRecords,
  queryCreditSummary,
  queryLibraryActivities,
} from "./scxt-fetcher";
import {
  queryAcademicReport,
  queryAcademicReportYears,
  queryEvaluationIndicators,
  queryEvaluationRadar,
  queryEvaluationResult,
  queryEvaluationTerms,
  queryYearScoreStatics,
} from "./xgxt-fetcher";
import type { CreditRecord as ScxtCreditRecord } from "./protocol/scxt";
import {
  initializeSession,
  resetSession,
  warmupSession,
} from "./adapters/session-adapter";
import { YSUMobileAdapter } from "./adapters/mobile-adapter";
import { ysuDiagnostics } from "./diagnostics";
import { ysuNativeNotification } from "./native-notification";
import { reloginYSU } from "./relogin";
import { getYSUMfaMethods, isYSUMfaMethod } from "./types";

function ysuCapabilities(): AcademicCapabilities {
  return {
    auth: true,
    captcha: true,
    mfa: isFeatureAvailable("hasMfa"),
    wechatMfa: isFeatureAvailable("hasMfa"),
    grades: true,
    gradeAnalytics: true,
    schedule: true,
    labSchedule: isFeatureAvailable("hasLabSchedule"),
    exams: true,
    makeupExams: true,
    laborEducation: getSchoolConfig().ldxt !== undefined,
    innovationCredits: getSchoolConfig().scxt !== undefined,
    comprehensiveEval: getSchoolConfig().xgxt !== undefined,
    schoolSchedule: true,
    gpa: true,
    evaluation: true,
    evaluationScorePreview: true,
    trainingPlan: true,
    studentInfo: true,
    currentWeek: true,
    classPeriods: true,
    termCalendar: true,
    mobileSignin: isFeatureAvailable("hasMobile"),
  };
}

function providerTaskId(task: { groupNo?: string; evalType?: string; sequence?: number }): string | undefined {
  if (!task.groupNo || !task.evalType) return undefined;
  return `${task.groupNo}|${task.evalType}|${task.sequence ?? 1}`;
}

function mapStudentInfo(info: Awaited<ReturnType<typeof queryStudentInfo>>): StudentInfo {
  return {
    name: info.name ?? "",
    namePinyin: info.namePinyin ?? undefined,
    studentId: info.studentId ?? "",
    gender: info.gender ?? undefined,
    nation: info.nation ?? undefined,
    nationality: info.nationality ?? undefined,
    department: info.department ?? undefined,
    major: info.major ?? undefined,
    className: info.className ?? undefined,
    gradeLevel: info.gradeLevel ?? undefined,
    enrollmentDate: info.enrollmentDate ?? undefined,
    expectedGraduation: info.expectedGraduation ?? undefined,
    educationLevel: info.educationLevel ?? undefined,
    campus: info.campus ?? undefined,
    studentStatus: info.studentStatus ?? undefined,
    discipline: info.discipline ?? undefined,
    studyDuration: info.studyDuration ?? undefined,
    foreignLanguage: info.foreignLanguage ?? undefined,
  };
}

function mapGrade(row: Awaited<ReturnType<typeof queryGrades>>[number]): Grade {
  return {
    courseName: row.courseName ?? "",
    courseCode: row.courseCode ?? undefined,
    classId: row.classId ?? undefined,
    score: row.score ?? undefined,
    numericScore: row.numericScore,
    gradeLevel: row.gradeLevel ?? undefined,
    gradePoint: row.gradePoint ?? undefined,
    numericGradePoint: row.numericGradePoint,
    credit: row.credit ?? undefined,
    numericCredit: row.numericCredit,
    hours: row.hours ?? undefined,
    semester: row.term ?? undefined,
    courseType: row.courseType ?? undefined,
    courseCategory: row.courseCategory ?? undefined,
    examType: row.examType ?? undefined,
    studyMode: row.studyMode ?? undefined,
    isMajor: row.isMajor ?? false,
    isRetake: row.isRetake ?? undefined,
    gradeLevelType: row.gradeLevelType ?? undefined,
    department: row.department ?? undefined,
    isPass: row.isPass ?? false,
    isValid: row.isValid ?? false,
    specialReason: row.specialReason ?? undefined,
    isDegreeCourse: row.isDegreeCourse ?? false,
    projectName: row.projectName ?? undefined,
    metadata: row.raw ?? undefined,
  };
}

function mapCourse(row: Awaited<ReturnType<typeof querySchedule>>[number]): Course {
  return {
    name: row.name ?? "",
    code: row.code ?? undefined,
    teacher: row.teacher ?? undefined,
    classroom: row.classroom ?? undefined,
    weekDay: row.weekDay ?? 0,
    startSection: row.startSection ?? 0,
    endSection: row.endSection ?? 0,
    weeks: row.weeks ?? undefined,
    weekList: row.weekList,
    credit: row.credit ?? undefined,
    courseType: row.courseType ?? undefined,
    classId: row.classId ?? undefined,
    syxzdm: row.syxzdm ?? undefined,
    scheduleId: row.scheduleId ?? undefined,
    classType: row.classType ?? undefined,
    raw: row.raw ?? undefined,
  };
}

function mapEvaluationTask(row: Awaited<ReturnType<typeof queryPendingEvaluations>>[number]): EvaluationTask {
  const task = {
    wid: row.wid ?? "",
    wjid: row.wjid ?? undefined,
    name: row.name ?? undefined,
    courseName: row.courseName ?? undefined,
    teacherName: row.teacherName ?? undefined,
    teacherId: row.teacherId ?? undefined,
    term: row.term ?? undefined,
    termName: row.termName ?? undefined,
    evalType: row.evalType ?? undefined,
    evalTypeName: row.evalTypeName ?? undefined,
    category: row.category ?? undefined,
    categoryName: row.categoryName ?? undefined,
    startTime: row.startTime ?? undefined,
    endTime: row.endTime ?? undefined,
    startAt: row.startAt,
    endAt: row.endAt,
    startTimestamp: row.startTimestamp,
    endTimestamp: row.endTimestamp,
    status: row.status,
    sequence: row.sequence ?? 0,
    className: row.className ?? undefined,
    groupNo: row.groupNo ?? undefined,
  };
  return { ...task, providerTaskId: providerTaskId(task) };
}

function mapEvaluationAnswer(answer: EvaluationAnswer) {
  return {
    tmid: answer.tmid,
    questionType: answer.questionType ?? "",
    optionIds: answer.optionIds ?? [],
    text: answer.text ?? "",
  };
}

function mapCreditRecord(row: ScxtCreditRecord): CreditRecord {
  return {
    itemName: row.itemName,
    year: row.year || undefined,
    categoryMajor: row.categoryMajor || undefined,
    categoryMinor: row.categoryMinor || undefined,
    awardLevel: row.awardLevel || undefined,
    referenceScore: row.referenceScore ?? undefined,
    actualScore: row.actualScore ?? undefined,
    grade: row.grade || undefined,
    batch: row.batch || undefined,
    status: row.status || undefined,
    raw: row.raw,
  };
}

function mapCompletion(completion: ProtocolAcademicCompletion): AcademicCompletion {
  return {
    planName: completion.planName ?? undefined,
    totalRequired: completion.totalRequired ?? undefined,
    numericTotalRequired: completion.numericTotalRequired,
    completed: completion.completed ?? undefined,
    numericCompleted: completion.numericCompleted,
    elective: completion.elective ?? undefined,
    numericElective: completion.numericElective,
    passed: completion.passed ?? false,
    lastCalculatedAt: completion.lastCalculatedAt || undefined,
  };
}

export class YSUProvider extends BaseProvider {
  readonly id = "ysu";
  readonly name = "燕山大学";
  readonly capabilities = ysuCapabilities();
  readonly mobile?: ProviderMobile = this.capabilities.mobileSignin
    ? new YSUMobileAdapter()
    : undefined;
  readonly diagnostics = ysuDiagnostics;
  readonly nativeNotification = ysuNativeNotification;

  protected async onInitialize(): Promise<void> {
    await initializeSession();
  }

  async warmup(): Promise<void> {
    await warmupSession();
  }

  protected async onReset(): Promise<void> {
    resetSession();
  }

  async prepareLogin(): Promise<void> {
    await prepareLogin();
  }

  resetLoginSession(): void {
    resetLoginSession();
  }

  getCaptchaUrl(): string | null {
    return getCaptchaUrl();
  }

  async checkCaptchaNeeded(username: string): Promise<boolean> {
    return checkCaptchaNeeded(username);
  }

  async login(credential: Credential): Promise<void> {
    await this.prepareLogin();

    const needsCaptcha = await this.checkCaptchaNeeded(credential.username);
    if (needsCaptcha && typeof credential.metadata?.captcha !== "string") {
      throw new ProviderError(
        ProviderErrorCode.AUTH_CAPTCHA_REQUIRED,
        "Captcha required",
        undefined,
        403,
      );
    }

    const result = await this.loginStep1({
      username: credential.username,
      password: credential.password,
      captcha:
        typeof credential.metadata?.captcha === "string"
          ? credential.metadata.captcha
          : undefined,
    });

    if (result.authenticated && result.credential) {
      saveCredential(result.credential, result.username);
      return;
    }

    if (result.needsMfa) {
      throw new ProviderError(
        ProviderErrorCode.AUTH_MFA_REQUIRED,
        "Multi-factor authentication required",
        result,
        403,
        {
          username: result.username,
          methods: [...getYSUMfaMethods()],
        },
      );
    }

    throw new ProviderError(
      ProviderErrorCode.AUTH_INVALID_CREDENTIAL,
      "Login failed",
      result,
      401,
    );
  }

  async loginStep1(input: LoginStep1Input): Promise<LoginStep1Result> {
    return loginStep1(
      {
        username: input.username,
        password: input.password,
        captcha: input.captcha,
      },
      input.skipRateLimit ?? false,
    );
  }

  async requestMfaCode(input: MfaRequestInput): Promise<MfaChallenge> {
    return requestMFACode(input.username, input.method);
  }

  async submitMfaCode(input: MfaSubmitInput): Promise<string> {
    if (!isYSUMfaMethod(input.challenge.method)) {
      throw new ProviderError(
        ProviderErrorCode.FEATURE_NOT_SUPPORTED,
        `Unsupported YSU MFA method: ${input.challenge.method}`,
        undefined,
        501,
        { methods: [...getYSUMfaMethods()] },
      );
    }

    const credential = await submitMFACode(
      {
        method: input.challenge.method,
        methodCode: input.challenge.methodCode,
        mobileHint: input.challenge.mobileHint,
        username: input.challenge.username,
        raw: {},
      },
      input.code,
    );
    saveCredential(credential, input.challenge.username);
    return credential;
  }

  async initiateWechatMfa(): Promise<WechatMfaContext> {
    return initiateWechatMFA();
  }

  async pollWechatMfaQr(uuid: string, lastErrcode?: number, signal?: AbortSignal): Promise<WechatQrPollResult> {
    return pollWechatQR(uuid, lastErrcode, signal);
  }

  async completeWechatMfa(code: string, state: string): Promise<string> {
    const credential = await completeWechatMFA(code, state);
    saveCredential(credential);
    return credential;
  }

  async checkAuthStatus(): Promise<AuthStatus> {
    return { authenticated: await checkCASAuthenticated() };
  }

  async logout(): Promise<void> {
    await this.reset();
    useAuthStore.getState().clearCredential();
  }

  isAuthenticated(): boolean {
    return useAuthStore.getState().isAuthenticated;
  }

  async relogin(): Promise<boolean> {
    return reloginYSU();
  }

  async getStudentInfo(): Promise<StudentInfo> {
    return mapStudentInfo(await queryStudentInfo());
  }

  async getGrades(options?: GradeQueryOptions): Promise<Grade[]> {
    const rows = await queryGrades({
      term: options?.semester,
      courseName: options?.courseName,
      pageSize: options?.pageSize,
      pageNumber: options?.pageNumber,
    });
    return rows.map(mapGrade);
  }

  async getGPAStats(options?: GPAQueryOptions): Promise<GPAStats> {
    const stats = await queryGpaStats({ studentId: options?.studentId });
    return {
      planName: stats.planName ?? undefined,
      studyType: stats.studyType ?? undefined,
      requiredCreditEarned: stats.requiredCreditEarned ?? undefined,
      numericRequiredCreditEarned: stats.numericRequiredCreditEarned,
      electiveCreditEarned: stats.electiveCreditEarned ?? undefined,
      numericElectiveCreditEarned: stats.numericElectiveCreditEarned,
      degreeCreditEarned: stats.degreeCreditEarned ?? undefined,
      numericDegreeCreditEarned: stats.numericDegreeCreditEarned,
      requiredCreditFailed: stats.requiredCreditFailed ?? undefined,
      numericRequiredCreditFailed: stats.numericRequiredCreditFailed,
      gpaInitial: stats.gpaInitial ?? undefined,
      numericGpaInitial: stats.numericGpaInitial,
      gpaHighest: stats.gpaHighest ?? undefined,
      numericGpaHighest: stats.numericGpaHighest,
      requiredGpaHighest: stats.requiredGpaHighest ?? undefined,
      numericRequiredGpaHighest: stats.numericRequiredGpaHighest,
      degreeGpaInitial: stats.degreeGpaInitial ?? undefined,
      numericDegreeGpaInitial: stats.numericDegreeGpaInitial,
      degreeGpaHighest: stats.degreeGpaHighest ?? undefined,
      numericDegreeGpaHighest: stats.numericDegreeGpaHighest,
      weightedAvg: stats.weightedAvg ?? undefined,
      numericWeightedAvg: stats.numericWeightedAvg,
      arithmeticAvg: stats.arithmeticAvg ?? undefined,
      numericArithmeticAvg: stats.numericArithmeticAvg,
      degreeWeightedAvg: stats.degreeWeightedAvg ?? undefined,
      numericDegreeWeightedAvg: stats.numericDegreeWeightedAvg,
    };
  }

  async getGradeStatistics(options?: GradeAnalyticsQueryOptions): Promise<GradeStatistics> {
    const stats = await queryGradeStatistics({
      term: options?.semester,
      classId: options?.classId,
      courseCode: options?.courseCode,
    });
    return {
      scope: stats.scope ?? undefined,
      semester: stats.term ?? undefined,
      classId: stats.classId ?? undefined,
      courseCode: stats.courseCode ?? undefined,
      highestScore: stats.highestScore ?? 0,
      lowestScore: stats.lowestScore ?? 0,
      averageScore: stats.averageScore ?? 0,
      metadata: stats.raw ?? undefined,
    };
  }

  async getGradeDistribution(options?: GradeAnalyticsQueryOptions): Promise<GradeDistribution[]> {
    const rows = await queryGradeDistribution({
      term: options?.semester,
      classId: options?.classId,
      courseCode: options?.courseCode,
    });
    return rows.map((row) => ({
      scope: row.scope ?? undefined,
      semester: row.term ?? undefined,
      classId: row.classId ?? undefined,
      courseCode: row.courseCode ?? undefined,
      levelCode: row.levelCode ?? undefined,
      levelName: row.levelName ?? undefined,
      count: row.count ?? 0,
      metadata: row.raw ?? undefined,
    }));
  }

  async getGradeRanking(options?: GradeRankingQueryOptions): Promise<GradeRanking> {
    const ranking = await queryGradeRanking({
      term: options?.semester,
      studentId: options?.studentId,
      classId: options?.classId,
      courseCode: options?.courseCode,
    });
    return {
      scope: ranking.scope ?? undefined,
      semester: ranking.term ?? undefined,
      studentId: ranking.studentId ?? undefined,
      classId: ranking.classId ?? undefined,
      courseCode: ranking.courseCode ?? undefined,
      score: ranking.score ?? 0,
      rank: ranking.rank ?? 0,
      total: ranking.total ?? 0,
      rankingType: ranking.rankingType ?? undefined,
      metadata: ranking.raw ?? undefined,
    };
  }

  async getSchedule(options?: ScheduleQueryOptions): Promise<Course[]> {
    const term = options?.semester;
    const includeLab =
      (options?.includeLabSchedule ?? this.capabilities.labSchedule) &&
      this.capabilities.labSchedule;
    const rows = includeLab
      ? await queryExperimentalSchedule({
          term,
          courseCategory: options?.courseCategory ?? "all",
        })
      : await querySchedule({ term });
    return rows.map(mapCourse);
  }

  async getUnscheduledCourses(options?: UnscheduledCourseQueryOptions): Promise<Course[]> {
    if (!this.capabilities.labSchedule) return [];
    const rows = await queryUnscheduledCourses({
      term: options?.semester,
      courseCategory: options?.courseCategory ?? "all",
    });
    return rows.map(mapCourse);
  }

  async getClassPeriods(): Promise<ClassPeriod[]> {
    const rows = await queryClassPeriods();
    return rows.map((row) => ({
      name: row.name ?? undefined,
      section: row.section ?? 0,
      startTime: row.startTime ?? undefined,
      endTime: row.endTime ?? undefined,
      startMinute: row.startMinute,
      endMinute: row.endMinute,
      isInUse: row.isInUse ?? false,
      raw: row.raw ?? undefined,
    }));
  }

  async getTermCalendar(options?: TermCalendarQueryOptions): Promise<TermCalendar> {
    const calendar = await queryTermCalendar({ term: options?.semester });
    return {
      semester: calendar.term ?? undefined,
      startDate: calendar.startDate ?? undefined,
      totalWeeks: calendar.totalWeeks ?? 0,
      teachingWeeks: calendar.teachingWeeks ?? 0,
      isInUse: calendar.isInUse ?? false,
      raw: calendar.raw ?? undefined,
    };
  }

  async getCurrentWeek(options?: import("../types").CurrentWeekQueryOptions): Promise<CurrentWeek> {
    const week = await queryCurrentWeek({ term: options?.semester, date: options?.date });
    return {
      week: week.week ?? 0,
      weekday: week.weekday ?? 0,
      semester: week.term ?? undefined,
      date: week.date ?? undefined,
      weekStartDate: week.weekStartDate,
      weekEndDate: week.weekEndDate,
      weekDates: week.weekDates ? [...week.weekDates] : undefined,
      raw: week.raw ?? undefined,
    };
  }

  async getCurrentWeekNumber(options?: TermCalendarQueryOptions): Promise<number> {
    const currentWeek = await this.getCurrentWeek(options);
    return currentWeek.week;
  }

  async getExams(options?: ExamQueryOptions): Promise<Exam[]> {
    const rows = await queryExams({ term: options?.semester });
    return rows.map((row) => ({
      name: row.name ?? "",
      examName: row.examName ?? undefined,
      startAt: row.startAt ?? undefined,
      endAt: row.endAt ?? undefined,
      startTimestamp: row.startTimestamp,
      endTimestamp: row.endTimestamp,
      status: row.status,
      timeText: row.timeText ?? undefined,
      examLocation: row.examLocation ?? undefined,
      seatNumber: row.seatNumber ?? undefined,
      raw: row.raw ?? undefined,
    }));
  }

  async getMakeupExamBatches(options?: ExamQueryOptions): Promise<MakeupExamBatch[]> {
    const rows = await queryMakeupExamBatches({ term: options?.semester });
    return rows.map((row) => ({
      name: row.name,
      batchId: row.batchId,
      term: row.term,
      signupStart: row.signupStart || undefined,
      signupEnd: row.signupEnd || undefined,
      availableCount: row.availableCount,
      registeredCount: row.registeredCount,
      raw: row.raw,
    }));
  }

  async getMakeupExamCourses(
    options?: MakeupExamCourseQueryOptions,
  ): Promise<MakeupExamCourse[]> {
    const rows = await queryMakeupExamCourses({
      term: options?.semester,
      batchId: options?.batchId,
      registered: options?.registered,
    });
    return rows.map((row) => ({
      name: row.name,
      code: row.code || undefined,
      credit: row.credit || undefined,
      hours: row.hours || undefined,
      examSeq: row.examSeq || undefined,
      department: row.department || undefined,
      status: row.status || undefined,
      isAvailable: row.isAvailable,
      signupStart: row.signupStart || undefined,
      signupEnd: row.signupEnd || undefined,
      batchId: row.batchId || undefined,
      taskId: row.taskId || undefined,
      note: row.note || undefined,
      raw: row.raw,
    }));
  }

  async signupMakeupExam(input: MakeupExamSignupInput): Promise<void> {
    await signupMakeupExam({ taskId: input.taskId, batchId: input.batchId });
  }

  async getSchoolGradeYears(): Promise<CodeItem[]> {
    const rows = await queryGradeYears();
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  async getSchoolDepartments(): Promise<CodeItem[]> {
    const rows = await queryDepartments();
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  async getSchoolMajors(department?: string): Promise<MajorInfo[]> {
    const rows = await queryMajors(department);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      department: row.department || undefined,
    }));
  }

  async getSchoolClasses(options?: SchoolClassQueryOptions): Promise<SchoolClassInfo[]> {
    const rows = await querySchoolClasses({
      term: options?.semester,
      grade: options?.grade,
      department: options?.department,
      major: options?.major,
    });
    return rows.map((row) => ({
      classId: row.classId,
      className: row.className,
      grade: row.grade || undefined,
      gradeDisplay: row.gradeDisplay || undefined,
      department: row.department || undefined,
      departmentDisplay: row.departmentDisplay || undefined,
      major: row.major || undefined,
      majorDisplay: row.majorDisplay || undefined,
      isScheduled: row.isScheduled,
      studentCount: row.studentCount,
    }));
  }

  async getSchoolClassSchedule(classId: string, options?: ExamQueryOptions): Promise<Course[]> {
    const rows = await queryClassSchedule(classId, { term: options?.semester });
    return rows.map(mapCourse);
  }

  async getSchoolCampuses(): Promise<CodeItem[]> {
    const rows = await queryCampuses();
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  async getSchoolBuildings(campus?: string): Promise<CodeItem[]> {
    const rows = await queryTeachingBuildings(campus);
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  async getSchoolClassrooms(options?: ClassroomQueryOptions): Promise<ClassroomInfo[]> {
    const rows = await queryClassrooms({
      term: options?.semester,
      name: options?.name,
      campus: options?.campus,
      building: options?.building,
    });
    return rows.map((row) => ({
      name: row.name,
      code: row.code,
      campusDisplay: row.campusDisplay || undefined,
      building: row.building || undefined,
      buildingDisplay: row.buildingDisplay || undefined,
      examSeats: row.examSeats,
      classSeats: row.classSeats,
      typeDisplay: row.typeDisplay || undefined,
      floor: row.floor,
      isScheduled: row.isScheduled,
    }));
  }

  async getSchoolClassroomSchedule(
    code: string,
    options?: ExamQueryOptions,
  ): Promise<Course[]> {
    const rows = await queryClassroomSchedule(code, { term: options?.semester });
    return rows.map(mapCourse);
  }

  async getLaborRecords(): Promise<LaborRecord[]> {
    const rows = await queryLaborRecords();
    return rows.map((row) => ({
      term: row.term,
      name: row.name,
      enrollType: row.enrollType || undefined,
      category: row.category || undefined,
      department: row.department || undefined,
      timeStart: row.timeStart || undefined,
      timeEnd: row.timeEnd || undefined,
      teacher: row.teacher || undefined,
      hours: row.hours ?? undefined,
      status: row.status || undefined,
      raw: row.raw,
    }));
  }

  async getLaborSummary(): Promise<LaborSummary> {
    const row = await queryLaborSummary();
    return {
      studentId: row.studentId || undefined,
      name: row.name || undefined,
      department: row.department || undefined,
      major: row.major || undefined,
      className: row.className || undefined,
      grade: row.grade || undefined,
      schooling: row.schooling || undefined,
      totalHours: row.totalHours ?? undefined,
      totalCredits: row.totalCredits ?? undefined,
      raw: row.raw,
    };
  }

  async getLaborActivities(): Promise<EnrollableActivity[]> {
    const rows = await queryEnrollableActivities();
    return rows.map((row) => ({
      name: row.name,
      category: row.category || undefined,
      timeStart: row.timeStart || undefined,
      timeEnd: row.timeEnd || undefined,
      location: row.location || undefined,
      hours: row.hours ?? undefined,
      description: row.description || undefined,
      department: row.department || undefined,
      enrollStart: row.enrollStart || undefined,
      enrollEnd: row.enrollEnd || undefined,
      isEnrolled: row.isEnrolled,
      operation: row.operation || undefined,
      raw: row.raw,
    }));
  }

  async getCreditBatches(): Promise<CreditBatch[]> {
    const rows = await queryCreditBatches();
    return rows.map((row) => ({ batchId: row.batchId, name: row.name }));
  }

  async getCreditDeclarations(options?: CreditQueryOptions): Promise<CreditDeclaration[]> {
    const rows = await queryCreditDeclarations({
      batchId: options?.batchId,
      itemName: options?.itemName,
    });
    return rows.map((row) => ({
      itemName: row.itemName,
      categoryMajor: row.categoryMajor || undefined,
      categoryMinor: row.categoryMinor || undefined,
      awardLevel: row.awardLevel || undefined,
      score: row.score ?? undefined,
      batch: row.batch || undefined,
      status: row.status || undefined,
      operation: row.operation || undefined,
      raw: row.raw,
    }));
  }

  async getCreditRecords(options?: CreditQueryOptions): Promise<CreditRecord[]> {
    const rows = await queryCreditRecords({
      batchId: options?.batchId,
      itemName: options?.itemName,
    });
    return rows.map(mapCreditRecord);
  }

  async getAllCreditRecords(): Promise<CreditRecord[]> {
    const rows = await queryAllCreditRecords();
    return rows.map(mapCreditRecord);
  }

  async getCreditSummary(): Promise<CreditSummary> {
    const row = await queryCreditSummary();
    return {
      studentId: row.studentId || undefined,
      name: row.name || undefined,
      department: row.department || undefined,
      major: row.major || undefined,
      className: row.className || undefined,
      gradeYear: row.gradeYear || undefined,
      grade: row.grade || undefined,
      totalCredits: row.totalCredits ?? undefined,
      raw: row.raw,
    };
  }

  async getCreditCompetitions(
    options?: CatalogQueryOptions,
  ): Promise<CatalogPage<Competition>> {
    const page = await queryCompetitions({
      itemName: options?.keyword,
      pageIndex: options?.pageIndex,
    });
    return {
      items: page.items.map((row) => ({
        code: row.code,
        name: row.name,
        categoryMajor: row.categoryMajor || undefined,
        categoryMinor: row.categoryMinor || undefined,
        isEnabled: row.isEnabled,
        status: row.status || undefined,
        raw: row.raw,
      })),
      pageIndex: page.pageIndex,
      totalPages: page.totalPages,
      totalRecords: page.totalRecords,
    };
  }

  async getCreditLibraryActivities(
    options?: CatalogQueryOptions,
  ): Promise<CatalogPage<LibraryActivity>> {
    const page = await queryLibraryActivities({
      name: options?.keyword,
      pageIndex: options?.pageIndex,
    });
    return {
      items: page.items.map((row) => ({
        name: row.name,
        organizer: row.organizer || undefined,
        category: row.category || undefined,
        detail: row.detail || undefined,
        raw: row.raw,
      })),
      pageIndex: page.pageIndex,
      totalPages: page.totalPages,
      totalRecords: page.totalRecords,
    };
  }

  async getComprehensiveTerms(): Promise<ComprehensiveTerm[]> {
    const rows = await queryEvaluationTerms();
    return rows.map((row) => ({
      year: row.year,
      term: row.term,
      yearDisplay: row.yearDisplay,
      termDisplay: row.termDisplay,
    }));
  }

  async getComprehensiveResult(options?: ComprehensiveQueryOptions): Promise<ComprehensiveResult> {
    const row = await queryEvaluationResult(options?.year, options?.term);
    return {
      totalScore: row.totalScore,
      classRank: row.classRank,
      classSize: row.classSize,
      gradeRank: row.gradeRank,
      gradeSize: row.gradeSize,
      year: row.year,
      term: row.term,
      yearDisplay: row.yearDisplay || undefined,
      termDisplay: row.termDisplay || undefined,
      indicators: row.indicators.map((ind) => ({
        name: ind.name,
        score: ind.score,
        rank: ind.rank,
        maxScore: ind.maxScore || undefined,
      })),
    };
  }

  async getComprehensiveIndicators(
    options?: ComprehensiveQueryOptions,
  ): Promise<ComprehensiveIndicatorDetail[]> {
    const rows = await queryEvaluationIndicators(options?.year, options?.term);
    return rows.map((row) => ({
      name: row.name,
      score: row.score,
      maxScore: row.maxScore || undefined,
      rangeText: row.rangeText || undefined,
      proportion: row.proportion || undefined,
      categoryDisplay: row.categoryDisplay || undefined,
      description: row.description || undefined,
    }));
  }

  async getComprehensiveRadar(options?: ComprehensiveQueryOptions): Promise<ComprehensiveRadarItem[]> {
    const rows = await queryEvaluationRadar(options?.year, options?.term);
    return rows.map((row) => ({
      name: row.name,
      personal: row.personal,
      average: row.average,
      maxScore: row.maxScore,
    }));
  }

  async getComprehensiveYearScores(): Promise<ComprehensiveYearScore[]> {
    const rows = await queryYearScoreStatics();
    return rows.map((row) => ({
      year: row.year,
      term: row.term,
      yearDisplay: row.yearDisplay || undefined,
      termDisplay: row.termDisplay || undefined,
      score: row.score,
    }));
  }

  async getComprehensiveReportYears(): Promise<ComprehensiveReportYears> {
    const data = await queryAcademicReportYears();
    return {
      years: data.years.map((y) => ({ year: y.year, yearDisplay: y.yearDisplay })),
      defaultYear: data.defaultYear,
    };
  }

  async getComprehensiveReport(options?: { year?: string }): Promise<ComprehensiveReportPage> {
    const page = await queryAcademicReport(options?.year);
    return {
      entries: page.entries.map((entry) => ({
        courseName: entry.courseName,
        score: entry.score,
        credit: entry.credit || undefined,
        year: entry.year || undefined,
        term: entry.term || undefined,
      })),
      totalSize: page.totalSize,
      pageNumber: page.pageNumber,
      pageSize: page.pageSize,
    };
  }

  async getEvaluationTypes(options?: TermQueryOptions): Promise<EvaluationType[]> {
    const rows = await queryEvaluationTypes({ term: options?.semester });
    return rows.map((row) => ({
      name: row.name ?? "",
      code: row.code ?? undefined,
      count: row.count ?? 0,
    }));
  }

  async getPendingEvaluations(
    evalType: string,
    options?: TermQueryOptions,
  ): Promise<EvaluationTask[]> {
    const rows = await queryPendingEvaluations(evalType, { term: options?.semester });
    return rows.map(mapEvaluationTask);
  }

  async getEvaluationTasks(options?: TermQueryOptions): Promise<EvaluationTask[]> {
    const types = await this.getEvaluationTypes(options);
    const typeCodes = types
      .map((type) => type.code)
      .filter((code): code is string => !!code);
    const taskGroups = await Promise.all(
      typeCodes.map((code) => this.getPendingEvaluations(code, options)),
    );
    return taskGroups.flat();
  }

  async getEvaluationDetail(query: EvaluationDetailQuery): Promise<EvaluationDetail> {
    const detail = await queryEvaluationDetail(query.groupNo, query.evalType, {
      sequence: query.sequence,
    });
    return {
      wjid: detail.wjid ?? undefined,
      name: detail.name ?? undefined,
      deadline: detail.deadline ?? undefined,
      questions:
        detail.questions?.map((question) => ({
          tmid: question.tmid ?? "",
          wjid: question.wjid ?? undefined,
          text: question.text ?? undefined,
          questionType: question.questionType ?? undefined,
          maxScore: question.maxScore ?? 0,
          order: question.order ?? 0,
          options:
            question.options?.map((option) => ({
              wid: option.wid ?? "",
              text: option.text ?? undefined,
              score: option.score ?? 0,
              scoreRatio: option.scoreRatio ?? 0,
              questionId: option.questionId ?? undefined,
            })) ?? [],
        })) ?? [],
      teachers: detail.teachers as Record<string, unknown>[] | undefined,
    };
  }

  async calculateEvaluationScore(input: EvaluationScoreInput): Promise<Record<string, unknown>> {
    return _calculateEvaluationScore(
      input.groupNo,
      input.wjid,
      input.evalType,
      input.answers.map(mapEvaluationAnswer),
      {
        teacherRelationId: input.teacherRelationId,
        courseName: input.courseName,
        teacherName: input.teacherName,
        sequence: input.sequence,
      },
    );
  }

  async submitEvaluation(input: EvaluationSubmitInput): Promise<void> {
    await _submitEvaluation(
      input.groupNo,
      input.wjid,
      input.evalType,
      input.answers.map(mapEvaluationAnswer),
      {
        teacherRelationId: input.teacherRelationId,
        courseName: input.courseName,
        teacherName: input.teacherName,
        sequence: input.sequence,
      },
    );
  }

  async getTrainingPlan(options?: PageQueryOptions): Promise<TrainingPlan[]> {
    const rows = await queryTrainingPlan({
      pageSize: options?.pageSize,
      pageNumber: options?.pageNumber,
    });
    return rows.map((row) => ({
      courseName: row.courseName ?? "",
      courseCode: row.courseCode ?? undefined,
      credit: row.credit ?? undefined,
      courseType: row.courseType ?? undefined,
      required: row.required ?? false,
      term: row.term ?? undefined,
      courseGroup: row.courseGroup ?? undefined,
    }));
  }

  async getAcademicCompletion(): Promise<AcademicCompletion> {
    const completion = await queryAcademicCompletion();
    return mapCompletion(completion);
  }

  async recalculateAcademicCompletion(): Promise<AcademicCompletion> {
    const completion = await recalculateAcademicCompletionImpl();
    return mapCompletion(completion);
  }

  async getAcademicWarnings(): Promise<AcademicWarning[]> {
    const rows = await queryAcademicWarnings();
    return rows.map((row) => ({
      warningType: row.warningType ?? "",
      warningLevel: row.warningLevel ?? undefined,
      description: row.description ?? undefined,
      term: row.term ?? undefined,
    }));
  }
}
