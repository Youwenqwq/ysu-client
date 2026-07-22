"use client";

import { useProvider } from "../use-provider";
import type {
  AcademicCompletion,
  AcademicWarning,
  ClassPeriod,
  CatalogPage,
  CatalogQueryOptions,
  Competition,
  Course,
  CreditBatch,
  CreditDeclaration,
  CreditQueryOptions,
  CreditRecord,
  CreditSummary,
  CurrentWeek,
  CurrentWeekQueryOptions,
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
  MakeupExamBatch,
  MakeupExamCourse,
  MakeupExamCourseQueryOptions,
  PageQueryOptions,
  ScheduleQueryOptions,
  TermCalendar,
  TermCalendarQueryOptions,
  TrainingPlan,
} from "../types";
import { useProviderQuery, type ProviderQueryResult } from "./use-provider-query";

export function useGrades(options?: GradeQueryOptions): ProviderQueryResult<Grade[]> {
  const provider = useProvider();
  return useProviderQuery("grades", "grades", () => provider.getGrades(options), options);
}

export function useGPAStats(options?: GPAQueryOptions): ProviderQueryResult<GPAStats> {
  const provider = useProvider();
  return useProviderQuery("gpa", "gpa-stats", () => provider.getGPAStats(options), options);
}

export function useGradeStatistics(
  options?: GradeAnalyticsQueryOptions,
): ProviderQueryResult<GradeStatistics> {
  const provider = useProvider();
  return useProviderQuery(
    "gradeAnalytics",
    "grade-statistics",
    () => provider.getGradeStatistics(options),
    options,
  );
}

export function useGradeDistribution(
  options?: GradeAnalyticsQueryOptions,
): ProviderQueryResult<GradeDistribution[]> {
  const provider = useProvider();
  return useProviderQuery(
    "gradeAnalytics",
    "grade-distribution",
    () => provider.getGradeDistribution(options),
    options,
  );
}

export function useGradeRanking(
  options?: GradeRankingQueryOptions,
): ProviderQueryResult<GradeRanking> {
  const provider = useProvider();
  return useProviderQuery(
    "gradeAnalytics",
    "grade-ranking",
    () => provider.getGradeRanking(options),
    options,
  );
}

export function useSchedule(options?: ScheduleQueryOptions): ProviderQueryResult<Course[]> {
  const provider = useProvider();
  return useProviderQuery("schedule", "schedule", () => provider.getSchedule(options), options);
}

export function useClassPeriods(): ProviderQueryResult<ClassPeriod[]> {
  const provider = useProvider();
  return useProviderQuery("classPeriods", "class-periods", () => provider.getClassPeriods());
}

export function useTermCalendar(
  options?: TermCalendarQueryOptions,
): ProviderQueryResult<TermCalendar> {
  const provider = useProvider();
  return useProviderQuery(
    "termCalendar",
    "term-calendar",
    () => provider.getTermCalendar(options),
    options,
  );
}

export function useCurrentWeek(
  options?: CurrentWeekQueryOptions,
): ProviderQueryResult<CurrentWeek> {
  const provider = useProvider();
  return useProviderQuery(
    "currentWeek",
    "current-week",
    () => provider.getCurrentWeek(options),
    options,
  );
}

export function useExams(options?: ExamQueryOptions): ProviderQueryResult<Exam[]> {
  const provider = useProvider();
  return useProviderQuery("exams", "exams", () => provider.getExams(options), options);
}

export function useMakeupExamBatches(
  options?: ExamQueryOptions,
): ProviderQueryResult<MakeupExamBatch[]> {
  const provider = useProvider();
  return useProviderQuery("makeupExams", "makeup-exam-batches", () =>
    provider.getMakeupExamBatches(options),
    options,
  );
}

export function useMakeupExamCourses(
  options?: MakeupExamCourseQueryOptions,
): ProviderQueryResult<MakeupExamCourse[]> {
  const provider = useProvider();
  return useProviderQuery(
    "makeupExams",
    "makeup-exam-courses",
    () => provider.getMakeupExamCourses(options),
    options,
  );
}

export function useLaborRecords(): ProviderQueryResult<LaborRecord[]> {
  const provider = useProvider();
  return useProviderQuery("laborEducation", "labor-records", () =>
    provider.getLaborRecords(),
  );
}

export function useLaborSummary(): ProviderQueryResult<LaborSummary> {
  const provider = useProvider();
  return useProviderQuery("laborEducation", "labor-summary", () =>
    provider.getLaborSummary(),
  );
}

export function useLaborActivities(): ProviderQueryResult<EnrollableActivity[]> {
  const provider = useProvider();
  return useProviderQuery("laborEducation", "labor-activities", () =>
    provider.getLaborActivities(),
  );
}

export function useCreditBatches(): ProviderQueryResult<CreditBatch[]> {
  const provider = useProvider();
  return useProviderQuery("innovationCredits", "credit-batches", () =>
    provider.getCreditBatches(),
  );
}

export function useCreditDeclarations(
  options?: CreditQueryOptions,
): ProviderQueryResult<CreditDeclaration[]> {
  const provider = useProvider();
  return useProviderQuery(
    "innovationCredits",
    "credit-declarations",
    () => provider.getCreditDeclarations(options),
    options,
  );
}

export function useCreditRecords(
  options?: CreditQueryOptions & { all?: boolean },
): ProviderQueryResult<CreditRecord[]> {
  const provider = useProvider();
  return useProviderQuery(
    "innovationCredits",
    "credit-records",
    () => (options?.all ? provider.getAllCreditRecords() : provider.getCreditRecords(options)),
    options,
  );
}

export function useCreditSummary(): ProviderQueryResult<CreditSummary> {
  const provider = useProvider();
  return useProviderQuery("innovationCredits", "credit-summary", () =>
    provider.getCreditSummary(),
  );
}

export function useCreditCompetitions(
  options?: CatalogQueryOptions,
): ProviderQueryResult<CatalogPage<Competition>> {
  const provider = useProvider();
  return useProviderQuery(
    "innovationCredits",
    "credit-competitions",
    () => provider.getCreditCompetitions(options),
    options,
  );
}

export function useCreditLibraryActivities(
  options?: CatalogQueryOptions,
): ProviderQueryResult<CatalogPage<LibraryActivity>> {
  const provider = useProvider();
  return useProviderQuery(
    "innovationCredits",
    "credit-library-activities",
    () => provider.getCreditLibraryActivities(options),
    options,
  );
}

export function useTrainingPlan(
  options?: PageQueryOptions,
): ProviderQueryResult<TrainingPlan[]> {
  const provider = useProvider();
  return useProviderQuery(
    "trainingPlan",
    "training-plan",
    () => provider.getTrainingPlan(options),
    options,
  );
}

export function useAcademicCompletion(): ProviderQueryResult<AcademicCompletion> {
  const provider = useProvider();
  return useProviderQuery(
    "trainingPlan",
    "academic-completion",
    () => provider.getAcademicCompletion(),
  );
}

export function useAcademicWarnings(): ProviderQueryResult<AcademicWarning[]> {
  const provider = useProvider();
  return useProviderQuery(
    "trainingPlan",
    "academic-warnings",
    () => provider.getAcademicWarnings(),
  );
}
