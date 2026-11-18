import {
  BUILT_IN_ACADEMIC_SLICES,
  defineSchoolProvider,
  ProviderError,
  ProviderErrorCode,
  type AcademicCompletion,
  type AcademicSliceMap,
  type AcademicWarning,
  type AuthSlice,
  type AuthStatus,
  type CatalogPage,
  type CatalogQueryOptions,
  type ClassPeriod,
  type ClassroomInfo,
  type ClassroomQueryOptions,
  type CodeItem,
  type Competition,
  type ComprehensiveIndicatorDetail,
  type ComprehensiveQueryOptions,
  type ComprehensiveRadarItem,
  type ComprehensiveReportPage,
  type ComprehensiveReportYears,
  type ComprehensiveResult,
  type ComprehensiveSlice,
  type ComprehensiveTerm,
  type ComprehensiveYearScore,
  type Course,
  type Credential,
  type CreditBatch,
  type CreditDeclaration,
  type CreditQueryOptions,
  type CreditRecord,
  type CreditsSlice,
  type CreditSummary,
  type CurrentWeek,
  type CurrentWeekQueryOptions,
  type EcardSlice,
  type EnrollableActivity,
  type EpaySlice,
  type EvaluationAnswer,
  type EvaluationDetail,
  type EvaluationDetailQuery,
  type EvaluationScoreInput,
  type EvaluationSlice,
  type EvaluationSubmitInput,
  type EvaluationTask,
  type EvaluationType,
  type Exam,
  type ExamQueryOptions,
  type ExamsSlice,
  type GPAQueryOptions,
  type GPAStats,
  type Grade,
  type GradeAnalyticsQueryOptions,
  type GradeDistribution,
  type GradeQueryOptions,
  type GradeRanking,
  type GradeRankingQueryOptions,
  type GradesSlice,
  type GradeStatistics,
  type LaborRecord,
  type LaborSlice,
  type LaborSummary,
  type LibraryActivity,
  type LoginStep1Input,
  type LoginStep1Result,
  type MajorInfo,
  type MakeupExamBatch,
  type MakeupExamCourse,
  type MakeupExamCourseQueryOptions,
  type MakeupExamSignupInput,
  type MakeupExamsSlice,
  type MfaChallenge,
  type MfaRequestInput,
  type MfaSubmitInput,
  type NativePollingSlice,
  type PageQueryOptions,
  type ProviderDiagnostics,
  type ScheduleQueryOptions,
  type SchoolClassInfo,
  type SchoolClassQueryOptions,
  type SchoolProvider,
  type SchoolScheduleSlice,
  type StudentInfo,
  type StudentProfileSlice,
  type TermCalendar,
  type TermCalendarQueryOptions,
  type TermQueryOptions,
  type TimetableSlice,
  type TrainingPlan,
  type TrainingPlanSlice,
  type UnscheduledCourseQueryOptions,
} from "@orahako/academic-sdk"
import type { YSUContextSource } from "./context"
import { YSU_GPA_SCALE, YSU_GRADE_SCALE } from "./grade-letters"
import type {
  AcademicCompletion as ProtocolAcademicCompletion,
  Course as JWXTCourse,
  EvaluationTask as JWXTEvaluationTask,
  Grade as JWXTGrade,
  StudentInfo as JWXTStudentInfo,
} from "./protocol/jwxt"
import type { CreditRecord as ScxtCreditRecord } from "./protocol/scxt"
import { createYSUProviderRuntime } from "./runtime"
import { getYSUMfaMethods, isYSUMfaMethod } from "./types"

function providerTaskId(task: {
  groupNo?: string
  evalType?: string
  sequence?: number
}): string | undefined {
  if (!task.groupNo || !task.evalType) return undefined
  return `${task.groupNo}|${task.evalType}|${task.sequence ?? 1}`
}

function mapStudentInfo(info: JWXTStudentInfo): StudentInfo {
  return {
    name: info.name || "",
    namePinyin: info.namePinyin || undefined,
    studentId: info.studentId || "",
    gender: info.gender || undefined,
    nation: info.nation || undefined,
    nationality: info.nationality || undefined,
    department: info.department || undefined,
    major: info.major || undefined,
    className: info.className || undefined,
    gradeLevel: info.gradeLevel || undefined,
    enrollmentDate: info.enrollmentDate || undefined,
    expectedGraduation: info.expectedGraduation || undefined,
    educationLevel: info.educationLevel || undefined,
    campus: info.campus || undefined,
    studentStatus: info.studentStatus || undefined,
    discipline: info.discipline || undefined,
    studyDuration: info.studyDuration || undefined,
    foreignLanguage: info.foreignLanguage || undefined,
  }
}

function mapGrade(row: JWXTGrade): Grade {
  return {
    courseName: row.courseName || "",
    courseCode: row.courseCode || undefined,
    classId: row.classId || undefined,
    score: row.score || undefined,
    numericScore: row.numericScore,
    gradeLevel: row.gradeLevel || undefined,
    gradePoint: row.gradePoint || undefined,
    numericGradePoint: row.numericGradePoint,
    credit: row.credit || undefined,
    numericCredit: row.numericCredit,
    hours: row.hours || undefined,
    semester: row.term || undefined,
    courseType: row.courseType || undefined,
    courseCategory: row.courseCategory || undefined,
    examType: row.examType || undefined,
    studyMode: row.studyMode || undefined,
    isMajor: row.isMajor,
    isRetake: row.isRetake || undefined,
    gradeLevelType: row.gradeLevelType || undefined,
    department: row.department || undefined,
    isPass: row.isPass,
    isValid: row.isValid,
    specialReason: row.specialReason || undefined,
    isDegreeCourse: row.isDegreeCourse,
    projectName: row.projectName || undefined,
    metadata: row.raw,
  }
}

function mapCourse(row: JWXTCourse): Course {
  return {
    name: row.name || "",
    code: row.code || undefined,
    teacher: row.teacher || undefined,
    classroom: row.classroom || undefined,
    weekDay: row.weekDay,
    startSection: row.startSection,
    endSection: row.endSection,
    weeks: row.weeks || undefined,
    weekList: row.weekList,
    credit: row.credit || undefined,
    courseType: row.courseType || undefined,
    classId: row.classId || undefined,
    syxzdm: row.syxzdm || undefined,
    scheduleId: row.scheduleId || undefined,
    classType: row.classType || undefined,
    raw: row.raw,
  }
}

function mapEvaluationTask(row: JWXTEvaluationTask): EvaluationTask {
  const task = {
    wid: row.wid || "",
    wjid: row.wjid || undefined,
    name: row.name || undefined,
    courseName: row.courseName || undefined,
    teacherName: row.teacherName || undefined,
    teacherId: row.teacherId || undefined,
    term: row.term || undefined,
    termName: row.termName || undefined,
    evalType: row.evalType || undefined,
    evalTypeName: row.evalTypeName || undefined,
    category: row.category || undefined,
    categoryName: row.categoryName || undefined,
    startTime: row.startTime || undefined,
    endTime: row.endTime || undefined,
    startAt: row.startAt,
    endAt: row.endAt,
    startTimestamp: row.startTimestamp,
    endTimestamp: row.endTimestamp,
    status: row.status,
    sequence: row.sequence,
    className: row.className || undefined,
    groupNo: row.groupNo || undefined,
  }
  return { ...task, providerTaskId: providerTaskId(task) }
}

function mapEvaluationAnswer(answer: EvaluationAnswer) {
  return {
    tmid: answer.tmid,
    questionType: answer.questionType ?? "",
    optionIds: answer.optionIds ?? [],
    text: answer.text ?? "",
  }
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
  }
}

function mapCompletion(completion: ProtocolAcademicCompletion): AcademicCompletion {
  return {
    planName: completion.planName || undefined,
    totalRequired: completion.totalRequired || undefined,
    numericTotalRequired: completion.numericTotalRequired,
    completed: completion.completed || undefined,
    numericCompleted: completion.numericCompleted,
    elective: completion.elective || undefined,
    numericElective: completion.numericElective,
    passed: completion.passed,
    lastCalculatedAt: completion.lastCalculatedAt || undefined,
  }
}

export type YsuAcademicSlices = Pick<AcademicSliceMap, (typeof BUILT_IN_ACADEMIC_SLICES)[number]>

export interface YsuSchoolProvider extends SchoolProvider {
  readonly id: string
  readonly name: string
  readonly slices: YsuAcademicSlices
  readonly diagnostics: ProviderDiagnostics
  warmup(): Promise<void>
}

export function createYsuSchoolProvider(source: YSUContextSource): YsuSchoolProvider {
  const runtime = createYSUProviderRuntime(source)
  const config = runtime.ctx.config
  const hasLabSchedule = config.features.hasLabSchedule
  const hasMobile = config.features.hasMobile
  const hasMfa = config.features.hasMfa

  let lifecycleGeneration = 0
  let initialized = false
  let pendingInit: { readonly generation: number; readonly promise: Promise<void> } | null = null

  const authSlice: AuthSlice = {
    async prepareLogin(): Promise<void> {
      await runtime.auth.prepareLogin()
    },
    async resetLoginSession(): Promise<void> {
      await runtime.auth.resetLoginSession()
    },
    getCaptchaUrl(): string | null {
      return runtime.auth.getCaptchaUrl()
    },
    async checkCaptchaNeeded(username: string): Promise<boolean> {
      return runtime.auth.checkCaptchaNeeded(username)
    },
    async loginStep1(input: LoginStep1Input): Promise<LoginStep1Result> {
      return runtime.auth.loginStep1(
        {
          username: input.username,
          password: input.password,
          captcha: input.captcha,
        },
        input.skipRateLimit ?? false
      )
    },
    async login(credential: Credential): Promise<void> {
      await authSlice.prepareLogin()

      const needsCaptcha = await authSlice.checkCaptchaNeeded!(credential.username)
      if (needsCaptcha && typeof credential.metadata?.captcha !== "string") {
        throw new ProviderError(
          ProviderErrorCode.AUTH_CAPTCHA_REQUIRED,
          "Captcha required",
          undefined,
          403
        )
      }

      const result = await authSlice.loginStep1({
        username: credential.username,
        password: credential.password,
        captcha:
          typeof credential.metadata?.captcha === "string"
            ? credential.metadata.captcha
            : undefined,
      })

      if (result.authenticated && result.credential) {
        runtime.auth.saveCredential(result.credential, result.username)
        return
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
          }
        )
      }

      throw new ProviderError(
        ProviderErrorCode.AUTH_INVALID_CREDENTIAL,
        "Login failed",
        result,
        401
      )
    },
    async requestMfaCode(input: MfaRequestInput): Promise<MfaChallenge> {
      return runtime.auth.requestMFACode(input.username, input.method)
    },
    async submitMfaCode(input: MfaSubmitInput): Promise<string> {
      if (!isYSUMfaMethod(input.challenge.method)) {
        throw new ProviderError(
          ProviderErrorCode.FEATURE_NOT_SUPPORTED,
          `Unsupported YSU MFA method: ${input.challenge.method}`,
          undefined,
          501,
          { methods: [...getYSUMfaMethods()] }
        )
      }

      const credential = await runtime.auth.submitMFACode(
        {
          method: input.challenge.method,
          methodCode: input.challenge.methodCode,
          mobileHint: input.challenge.mobileHint,
          username: input.challenge.username,
          raw: {},
        },
        input.code
      )
      runtime.auth.saveCredential(credential, input.challenge.username)
      return credential
    },
    async checkAuthStatus(): Promise<AuthStatus> {
      return { authenticated: await runtime.auth.isAuthenticated() }
    },
    isAuthenticated(): boolean {
      return runtime.ctx.session.getSnapshot().isAuthenticated
    },
    wechatMfa: hasMfa
      ? {
          initiateWechatMfa: () => runtime.auth.initiateWechatMFA(),
          pollWechatMfaQr: (uuid, lastErrcode, signal) =>
            runtime.auth.pollWechatQR(uuid, lastErrcode, signal),
          completeWechatMfa: async (code, state) => {
            const credential = await runtime.auth.completeWechatMFA(code, state)
            runtime.auth.saveCredential(credential)
            return credential
          },
        }
      : undefined,
    diagnostics: runtime.diagnostics,
  }

  const timetableSlice: TimetableSlice = {
    async getSchedule(options?: ScheduleQueryOptions): Promise<Course[]> {
      const term = options?.semester
      const includeLab = (options?.includeLabSchedule ?? hasLabSchedule) && hasLabSchedule
      const rows = includeLab
        ? await runtime.emap.queryExperimentalSchedule({
            term,
            courseCategory: options?.courseCategory ?? "all",
          })
        : await runtime.emap.querySchedule({ term })
      return rows.map(mapCourse)
    },
    async getUnscheduledCourses(options?: UnscheduledCourseQueryOptions): Promise<Course[]> {
      if (!hasLabSchedule) return []
      const rows = await runtime.emap.queryUnscheduledCourses({
        term: options?.semester,
        courseCategory: options?.courseCategory ?? "all",
      })
      return rows.map(mapCourse)
    },
    async getClassPeriods(): Promise<ClassPeriod[]> {
      const rows = await runtime.emap.queryClassPeriods()
      return rows.map((row) => ({
        name: row.name || undefined,
        section: row.section,
        startTime: row.startTime || undefined,
        endTime: row.endTime || undefined,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        isInUse: row.isInUse,
        raw: row.raw,
      }))
    },
    async getTermCalendar(options?: TermCalendarQueryOptions): Promise<TermCalendar> {
      const calendar = await runtime.emap.queryTermCalendar({ term: options?.semester })
      return {
        semester: calendar.term || undefined,
        startDate: calendar.startDate || undefined,
        totalWeeks: calendar.totalWeeks,
        teachingWeeks: calendar.teachingWeeks,
        isInUse: calendar.isInUse,
        raw: calendar.raw,
      }
    },
    async getCurrentWeek(options?: CurrentWeekQueryOptions): Promise<CurrentWeek> {
      const week = await runtime.emap.queryCurrentWeek({
        term: options?.semester,
        date: options?.date,
      })
      return {
        week: week.week,
        weekday: week.weekday,
        semester: week.term || undefined,
        date: week.date || undefined,
        weekStartDate: week.weekStartDate,
        weekEndDate: week.weekEndDate,
        weekDates: week.weekDates ? [...week.weekDates] : undefined,
        raw: week.raw,
      }
    },
    async getCurrentWeekNumber(options?: CurrentWeekQueryOptions): Promise<number> {
      const currentWeek = await timetableSlice.getCurrentWeek!(options)
      return currentWeek.week
    },
    hasLabSchedule,
    mobile: hasMobile ? runtime.mobileAdapter : undefined,
  }

  const schoolScheduleSlice: SchoolScheduleSlice = {
    async getSchoolGradeYears(): Promise<CodeItem[]> {
      const rows = await runtime.emap.queryGradeYears()
      return rows.map((row) => ({ id: row.id, name: row.name }))
    },
    async getSchoolDepartments(): Promise<CodeItem[]> {
      const rows = await runtime.emap.queryDepartments()
      return rows.map((row) => ({ id: row.id, name: row.name }))
    },
    async getSchoolMajors(department?: string): Promise<MajorInfo[]> {
      const rows = await runtime.emap.queryMajors(department)
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        department: row.department || undefined,
      }))
    },
    async getSchoolClasses(options?: SchoolClassQueryOptions): Promise<SchoolClassInfo[]> {
      const rows = await runtime.emap.querySchoolClasses({
        term: options?.semester,
        grade: options?.grade,
        department: options?.department,
        major: options?.major,
      })
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
      }))
    },
    async getSchoolClassSchedule(classId: string, options?: ExamQueryOptions): Promise<Course[]> {
      const rows = await runtime.emap.queryClassSchedule(classId, { term: options?.semester })
      return rows.map(mapCourse)
    },
    async getSchoolCampuses(): Promise<CodeItem[]> {
      const rows = await runtime.emap.queryCampuses()
      return rows.map((row) => ({ id: row.id, name: row.name }))
    },
    async getSchoolBuildings(campus?: string): Promise<CodeItem[]> {
      const rows = await runtime.emap.queryTeachingBuildings(campus)
      return rows.map((row) => ({ id: row.id, name: row.name }))
    },
    async getSchoolClassrooms(options?: ClassroomQueryOptions): Promise<ClassroomInfo[]> {
      const rows = await runtime.emap.queryClassrooms({
        term: options?.semester,
        name: options?.name,
        campus: options?.campus,
        building: options?.building,
      })
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
      }))
    },
    async getSchoolClassroomSchedule(code: string, options?: ExamQueryOptions): Promise<Course[]> {
      const rows = await runtime.emap.queryClassroomSchedule(code, { term: options?.semester })
      return rows.map(mapCourse)
    },
  }

  const gradesSlice: GradesSlice = {
    async getGrades(options?: GradeQueryOptions): Promise<Grade[]> {
      const rows = await runtime.emap.queryGrades({
        term: options?.semester,
        courseName: options?.courseName,
        pageSize: options?.pageSize,
        pageNumber: options?.pageNumber,
      })
      return rows.map(mapGrade)
    },
    async getGPAStats(options?: GPAQueryOptions): Promise<GPAStats> {
      const stats = await runtime.emap.queryGpaStats({ studentId: options?.studentId })
      return {
        planName: stats.planName || undefined,
        studyType: stats.studyType || undefined,
        requiredCreditEarned: stats.requiredCreditEarned || undefined,
        numericRequiredCreditEarned: stats.numericRequiredCreditEarned,
        electiveCreditEarned: stats.electiveCreditEarned || undefined,
        numericElectiveCreditEarned: stats.numericElectiveCreditEarned,
        degreeCreditEarned: stats.degreeCreditEarned || undefined,
        numericDegreeCreditEarned: stats.numericDegreeCreditEarned,
        requiredCreditFailed: stats.requiredCreditFailed || undefined,
        numericRequiredCreditFailed: stats.numericRequiredCreditFailed,
        gpaInitial: stats.gpaInitial || undefined,
        numericGpaInitial: stats.numericGpaInitial,
        gpaHighest: stats.gpaHighest || undefined,
        numericGpaHighest: stats.numericGpaHighest,
        requiredGpaHighest: stats.requiredGpaHighest || undefined,
        numericRequiredGpaHighest: stats.numericRequiredGpaHighest,
        degreeGpaInitial: stats.degreeGpaInitial || undefined,
        numericDegreeGpaInitial: stats.numericDegreeGpaInitial,
        degreeGpaHighest: stats.degreeGpaHighest || undefined,
        numericDegreeGpaHighest: stats.numericDegreeGpaHighest,
        weightedAvg: stats.weightedAvg || undefined,
        numericWeightedAvg: stats.numericWeightedAvg,
        arithmeticAvg: stats.arithmeticAvg || undefined,
        numericArithmeticAvg: stats.numericArithmeticAvg,
        degreeWeightedAvg: stats.degreeWeightedAvg || undefined,
        numericDegreeWeightedAvg: stats.numericDegreeWeightedAvg,
      }
    },
    async getGradeStatistics(options?: GradeAnalyticsQueryOptions): Promise<GradeStatistics> {
      const stats = await runtime.emap.queryGradeStatistics({
        term: options?.semester,
        classId: options?.classId,
        courseCode: options?.courseCode,
      })
      return {
        scope: stats.scope || undefined,
        semester: stats.term || undefined,
        classId: stats.classId || undefined,
        courseCode: stats.courseCode || undefined,
        highestScore: stats.highestScore,
        lowestScore: stats.lowestScore,
        averageScore: stats.averageScore,
        metadata: stats.raw,
      }
    },
    async getGradeDistribution(options?: GradeAnalyticsQueryOptions): Promise<GradeDistribution[]> {
      const rows = await runtime.emap.queryGradeDistribution({
        term: options?.semester,
        classId: options?.classId,
        courseCode: options?.courseCode,
      })
      return rows.map((row) => ({
        scope: row.scope || undefined,
        semester: row.term || undefined,
        classId: row.classId || undefined,
        courseCode: row.courseCode || undefined,
        levelCode: row.levelCode || undefined,
        levelName: row.levelName || undefined,
        count: row.count,
        metadata: row.raw,
      }))
    },
    async getGradeRanking(options?: GradeRankingQueryOptions): Promise<GradeRanking> {
      const ranking = await runtime.emap.queryGradeRanking({
        term: options?.semester,
        studentId: options?.studentId,
        classId: options?.classId,
        courseCode: options?.courseCode,
      })
      return {
        scope: ranking.scope || undefined,
        semester: ranking.term || undefined,
        studentId: ranking.studentId || undefined,
        classId: ranking.classId || undefined,
        courseCode: ranking.courseCode || undefined,
        score: ranking.score,
        rank: ranking.rank,
        total: ranking.total,
        rankingType: ranking.rankingType || undefined,
        metadata: ranking.raw,
      }
    },
    gradeScale: YSU_GRADE_SCALE,
    gpaScale: YSU_GPA_SCALE,
  }

  const examsSlice: ExamsSlice = {
    async getExams(options?: ExamQueryOptions): Promise<Exam[]> {
      const rows = await runtime.emap.queryExams({ term: options?.semester })
      return rows.map((row) => ({
        name: row.name || "",
        examName: row.examName || undefined,
        startAt: row.startAt || undefined,
        endAt: row.endAt || undefined,
        startTimestamp: row.startTimestamp,
        endTimestamp: row.endTimestamp,
        status: row.status,
        timeText: row.timeText || undefined,
        examLocation: row.examLocation || undefined,
        seatNumber: row.seatNumber || undefined,
        raw: row.raw,
      }))
    },
  }

  const makeupExamsSlice: MakeupExamsSlice = {
    async getMakeupExamBatches(options?: ExamQueryOptions): Promise<MakeupExamBatch[]> {
      const rows = await runtime.emap.queryMakeupExamBatches({ term: options?.semester })
      return rows.map((row) => ({
        name: row.name,
        batchId: row.batchId,
        term: row.term,
        signupStart: row.signupStart || undefined,
        signupEnd: row.signupEnd || undefined,
        availableCount: row.availableCount,
        registeredCount: row.registeredCount,
        raw: row.raw,
      }))
    },
    async getMakeupExamCourses(
      options?: MakeupExamCourseQueryOptions
    ): Promise<MakeupExamCourse[]> {
      const rows = await runtime.emap.queryMakeupExamCourses({
        term: options?.semester,
        batchId: options?.batchId,
        registered: options?.registered,
      })
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
      }))
    },
    async signupMakeupExam(input: MakeupExamSignupInput): Promise<void> {
      await runtime.emap.signupMakeupExam({ taskId: input.taskId, batchId: input.batchId })
    },
  }

  const evaluationSlice: EvaluationSlice = {
    async getEvaluationTypes(options?: TermQueryOptions): Promise<EvaluationType[]> {
      const rows = await runtime.emap.queryEvaluationTypes({ term: options?.semester })
      return rows.map((row) => ({
        name: row.name || "",
        code: row.code || undefined,
        count: row.count,
      }))
    },
    async getPendingEvaluations(
      evalType: string,
      options?: TermQueryOptions
    ): Promise<EvaluationTask[]> {
      const rows = await runtime.emap.queryPendingEvaluations(evalType, {
        term: options?.semester,
      })
      return rows.map(mapEvaluationTask)
    },
    async getEvaluationTasks(options?: TermQueryOptions): Promise<EvaluationTask[]> {
      const types = await evaluationSlice.getEvaluationTypes(options)
      const taskGroups = await Promise.all(
        types
          .filter((type): type is EvaluationType & { readonly code: string } =>
            Boolean(type.code && type.count > 0)
          )
          .map((type) => evaluationSlice.getPendingEvaluations(type.code, options))
      )
      return taskGroups.flat()
    },
    async getEvaluationDetail(query: EvaluationDetailQuery): Promise<EvaluationDetail> {
      const detail = await runtime.emap.queryEvaluationDetail(query.groupNo, query.evalType, {
        sequence: query.sequence,
      })
      return {
        wjid: detail.wjid || undefined,
        name: detail.name || undefined,
        deadline: detail.deadline || undefined,
        questions: detail.questions.map((question) => ({
          tmid: question.tmid || "",
          wjid: question.wjid || undefined,
          text: question.text || undefined,
          questionType: question.questionType || undefined,
          maxScore: question.maxScore,
          order: question.order,
          options: question.options.map((option) => ({
            wid: option.wid || "",
            text: option.text || undefined,
            score: option.score,
            scoreRatio: option.scoreRatio,
            questionId: option.questionId || undefined,
          })),
        })),
        teachers: [...detail.teachers],
      }
    },
    async calculateEvaluationScore(input: EvaluationScoreInput): Promise<Record<string, unknown>> {
      return runtime.emap.calculateEvaluationScore(
        input.groupNo,
        input.wjid,
        input.evalType,
        input.answers.map(mapEvaluationAnswer),
        {
          teacherRelationId: input.teacherRelationId,
          courseName: input.courseName,
          teacherName: input.teacherName,
          sequence: input.sequence,
        }
      )
    },
    async submitEvaluation(input: EvaluationSubmitInput): Promise<void> {
      await runtime.emap.submitEvaluation(
        input.groupNo,
        input.wjid,
        input.evalType,
        input.answers.map(mapEvaluationAnswer),
        {
          teacherRelationId: input.teacherRelationId,
          courseName: input.courseName,
          teacherName: input.teacherName,
          sequence: input.sequence,
        }
      )
    },
  }

  const studentProfileSlice: StudentProfileSlice = {
    async getStudentInfo(): Promise<StudentInfo> {
      return mapStudentInfo(await runtime.emap.queryStudentInfo())
    },
  }

  const trainingPlanSlice: TrainingPlanSlice = {
    async getTrainingPlan(options?: PageQueryOptions): Promise<TrainingPlan[]> {
      const rows = await runtime.emap.queryTrainingPlan({
        pageSize: options?.pageSize,
        pageNumber: options?.pageNumber,
      })
      return rows.map((row) => ({
        courseName: row.courseName || "",
        courseCode: row.courseCode || undefined,
        credit: row.credit || undefined,
        courseType: row.courseType || undefined,
        required: row.required,
        term: row.term || undefined,
        courseGroup: row.courseGroup || undefined,
      }))
    },
    async getAcademicCompletion(): Promise<AcademicCompletion> {
      return mapCompletion(await runtime.emap.queryAcademicCompletion())
    },
    async recalculateAcademicCompletion(): Promise<AcademicCompletion> {
      return mapCompletion(await runtime.emap.recalculateAcademicCompletion())
    },
    async getAcademicWarnings(): Promise<AcademicWarning[]> {
      const rows = await runtime.emap.queryAcademicWarnings()
      return rows.map((row) => ({
        warningType: row.warningType || "",
        warningLevel: row.warningLevel || undefined,
        description: row.description || undefined,
        term: row.term || undefined,
      }))
    },
  }

  const ecardSlice: EcardSlice = {
    fetchBalance: () => runtime.fetchEcardBalance(),
  }

  const epaySlice: EpaySlice = {
    fetchPayments: () => runtime.fetchEpayPayments(),
    recordStatus: (record) => runtime.epay.toRecordStatus(record),
  }

  const laborSlice: LaborSlice = {
    async getLaborRecords(): Promise<LaborRecord[]> {
      const rows = await runtime.ldxtFetcher.queryLaborRecords()
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
      }))
    },
    async getLaborSummary(): Promise<LaborSummary> {
      const row = await runtime.ldxtFetcher.queryLaborSummary()
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
      }
    },
    async getLaborActivities(): Promise<EnrollableActivity[]> {
      const rows = await runtime.ldxtFetcher.queryEnrollableActivities()
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
      }))
    },
  }

  const creditsSlice: CreditsSlice = {
    async getCreditBatches(): Promise<CreditBatch[]> {
      const rows = await runtime.scxtFetcher.queryCreditBatches()
      return rows.map((row) => ({ batchId: row.batchId, name: row.name }))
    },
    async getCreditDeclarations(options?: CreditQueryOptions): Promise<CreditDeclaration[]> {
      const rows = await runtime.scxtFetcher.queryCreditDeclarations({
        batchId: options?.batchId,
        itemName: options?.itemName,
      })
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
      }))
    },
    async getCreditRecords(options?: CreditQueryOptions): Promise<CreditRecord[]> {
      const rows = await runtime.scxtFetcher.queryCreditRecords({
        batchId: options?.batchId,
        itemName: options?.itemName,
      })
      return rows.map(mapCreditRecord)
    },
    async getAllCreditRecords(): Promise<CreditRecord[]> {
      const rows = await runtime.scxtFetcher.queryAllCreditRecords()
      return rows.map(mapCreditRecord)
    },
    async getCreditSummary(): Promise<CreditSummary> {
      const row = await runtime.scxtFetcher.queryCreditSummary()
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
      }
    },
    async getCreditCompetitions(options?: CatalogQueryOptions): Promise<CatalogPage<Competition>> {
      const page = await runtime.scxtFetcher.queryCompetitions({
        itemName: options?.keyword,
        pageIndex: options?.pageIndex,
      })
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
      }
    },
    async getCreditLibraryActivities(
      options?: CatalogQueryOptions
    ): Promise<CatalogPage<LibraryActivity>> {
      const page = await runtime.scxtFetcher.queryLibraryActivities({
        name: options?.keyword,
        pageIndex: options?.pageIndex,
      })
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
      }
    },
  }

  const comprehensiveSlice: ComprehensiveSlice = {
    async getComprehensiveTerms(): Promise<ComprehensiveTerm[]> {
      const rows = await runtime.xgxtFetcher.queryEvaluationTerms()
      return rows.map((row) => ({
        year: row.year,
        term: row.term,
        yearDisplay: row.yearDisplay,
        termDisplay: row.termDisplay,
      }))
    },
    async getComprehensiveResult(
      options?: ComprehensiveQueryOptions
    ): Promise<ComprehensiveResult> {
      const row = await runtime.xgxtFetcher.queryEvaluationResult(options?.year, options?.term)
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
      }
    },
    async getComprehensiveIndicators(
      options?: ComprehensiveQueryOptions
    ): Promise<ComprehensiveIndicatorDetail[]> {
      const rows = await runtime.xgxtFetcher.queryEvaluationIndicators(options?.year, options?.term)
      return rows.map((row) => ({
        name: row.name,
        score: row.score,
        maxScore: row.maxScore || undefined,
        rangeText: row.rangeText || undefined,
        proportion: row.proportion || undefined,
        categoryDisplay: row.categoryDisplay || undefined,
        description: row.description || undefined,
      }))
    },
    async getComprehensiveRadar(
      options?: ComprehensiveQueryOptions
    ): Promise<ComprehensiveRadarItem[]> {
      const rows = await runtime.xgxtFetcher.queryEvaluationRadar(options?.year, options?.term)
      return rows.map((row) => ({
        name: row.name,
        personal: row.personal,
        average: row.average,
        maxScore: row.maxScore,
      }))
    },
    async getComprehensiveYearScores(): Promise<ComprehensiveYearScore[]> {
      const rows = await runtime.xgxtFetcher.queryYearScoreStatics()
      return rows.map((row) => ({
        year: row.year,
        term: row.term,
        yearDisplay: row.yearDisplay || undefined,
        termDisplay: row.termDisplay || undefined,
        score: row.score,
      }))
    },
    async getComprehensiveReportYears(): Promise<ComprehensiveReportYears> {
      const data = await runtime.xgxtFetcher.queryAcademicReportYears()
      return {
        years: data.years.map((y) => ({
          year: y.year,
          yearDisplay: y.yearDisplay,
        })),
        defaultYear: data.defaultYear,
      }
    },
    async getComprehensiveReport(options?: { year?: string }): Promise<ComprehensiveReportPage> {
      const page = await runtime.xgxtFetcher.queryAcademicReport(options?.year)
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
      }
    },
  }

  const nativePollingSlice: NativePollingSlice = runtime.nativePolling

  const slices: YsuAcademicSlices = {
    auth: authSlice,
    timetable: timetableSlice,
    schoolSchedule: schoolScheduleSlice,
    grades: gradesSlice,
    exams: examsSlice,
    makeupExams: makeupExamsSlice,
    evaluation: evaluationSlice,
    studentProfile: studentProfileSlice,
    trainingPlan: trainingPlanSlice,
    ecard: ecardSlice,
    epay: epaySlice,
    labor: laborSlice,
    credits: creditsSlice,
    comprehensive: comprehensiveSlice,
    nativePolling: nativePollingSlice,
  }

  return defineSchoolProvider({
    id: config.id,
    name: config.name,
    slices,
    diagnostics: runtime.diagnostics,
    async warmup(): Promise<void> {
      await runtime.lifecycle.warmupSession()
    },
    initialize(): Promise<void> {
      if (initialized) return Promise.resolve()
      const generation = lifecycleGeneration
      if (pendingInit?.generation === generation) {
        return pendingInit.promise
      }
      const promise = runtime.ctx.transition
        .withAuthTransition(async () => {
          if (lifecycleGeneration !== generation || initialized) return
          await runtime.lifecycle.initializeSession()
          if (lifecycleGeneration === generation) {
            initialized = true
          }
        })
        .finally(() => {
          if (pendingInit?.generation === generation) {
            pendingInit = null
          }
        })
      pendingInit = { generation, promise }
      return promise
    },
    async reset(): Promise<void> {
      lifecycleGeneration += 1
      initialized = false
      pendingInit = null
      await runtime.lifecycle.resetSession()
    },
    async logout(): Promise<void> {
      await this.reset()
      runtime.ctx.session.clearCredential(config.id)
    },
    async relogin(): Promise<boolean> {
      return runtime.relogin.reloginYSU()
    },
  })
}
