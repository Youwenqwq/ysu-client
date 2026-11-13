/**
 * @orahako/plugin-ui/academic — academic schedule/term utilities.
 */
export { formatLocalDateTime, formatTimeRange, parseAcademicDateTime } from "@/lib/academic/time"
export {
  getExamStartTime,
  getExamEndTime,
  isExamCompleted,
  compareExamStartTime,
  formatExamTime,
} from "@/lib/academic/exam-utils"
export { getAcademicClock, SCHOOL_TIME_ZONE } from "@/lib/academic/academic-time"
export * from "@/lib/academic/schedule-patches"
