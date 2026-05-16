export interface CaptchaResponse {
  needed: boolean;
  image_base64?: string;
}

export interface Step1Request {
  username: string;
  password: string;
  captcha?: string;
  skip_rate_limit?: boolean;
}

export interface Step1Response {
  authenticated: boolean;
  needs_mfa: boolean;
  username: string;
  credential?: string;
}

export interface MFARequestCodeRequest {
  username: string;
  method: "sms" | "cpdaily";
}

export interface MFAChallengeResponse {
  method: "sms" | "cpdaily";
  method_code: string;
  mobile_hint: string;
  username: string;
}

export interface MFASubmitRequest {
  method: "sms" | "cpdaily";
  method_code: string;
  username: string;
  code: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  captcha?: string;
  mfa_code?: string;
  mfa_method?: "sms" | "cpdaily";
}

export interface LoginResponse {
  credential: string;
}

export interface StatusResponse {
  authenticated: boolean;
}

export interface Course {
  name: string;
  code?: string;
  teacher?: string;
  classroom?: string;
  week_day: number;
  start_section: number;
  end_section: number;
  weeks?: string;
  credit?: string;
  course_type?: string;
  class_id?: string;
  syxzdm?: string;
  schedule_id?: string;
  class_type?: string;
  raw?: Record<string, unknown>;
}

export interface ClassPeriod {
  name?: string;
  section: number;
  start_time?: string;
  end_time?: string;
  is_in_use: boolean;
}

export interface TermCalendar {
  term?: string;
  start_date?: string;
  total_weeks: number;
  teaching_weeks: number;
  is_in_use: boolean;
}

export interface CurrentWeek {
  week: number;
  weekday: number;
  term?: string;
  date?: string;
}

export interface Exam {
  name: string;
  exam_name?: string;
  exam_date?: string;
  exam_time?: string;
  exam_location?: string;
  seat_number?: string;
}

export interface Grade {
  course_name: string;
  course_code?: string;
  class_id?: string;
  score?: string;
  grade_level?: string;
  grade_point?: string;
  credit?: string;
  hours?: string;
  term?: string;
  course_type?: string;
  course_category?: string;
  exam_type?: string;
  study_mode?: string;
  is_major: boolean;
  is_retake?: string;
  grade_level_type?: string;
  department?: string;
  is_pass: boolean;
  is_valid: boolean;
  special_reason?: string;
  is_degree_course: boolean;
  project_name?: string;
}

export interface GradeStatistics {
  scope?: string;
  term?: string;
  class_id?: string;
  course_code?: string;
  highest_score: number;
  lowest_score: number;
  average_score: number;
}

export interface GradeDistribution {
  scope?: string;
  term?: string;
  class_id?: string;
  course_code?: string;
  level_code?: string;
  level_name?: string;
  count: number;
}

export interface GradeRanking {
  scope?: string;
  term?: string;
  student_id?: string;
  class_id?: string;
  course_code?: string;
  score: number;
  rank: number;
  total: number;
  ranking_type?: string;
}

export interface GPAStats {
  plan_name?: string;
  study_type?: string;
  required_credit_earned?: string;
  elective_credit_earned?: string;
  degree_credit_earned?: string;
  required_credit_failed?: string;
  gpa_initial?: string;
  gpa_highest?: string;
  required_gpa_highest?: string;
  degree_gpa_initial?: string;
  degree_gpa_highest?: string;
  weighted_avg?: string;
  arithmetic_avg?: string;
  degree_weighted_avg?: string;
}

export interface StudentInfo {
  name?: string;
  name_pinyin?: string;
  student_id?: string;
  gender?: string;
  nation?: string;
  nationality?: string;
  department?: string;
  major?: string;
  class_name?: string;
  grade_level?: string;
  enrollment_date?: string;
  expected_graduation?: string;
  education_level?: string;
  campus?: string;
  student_status?: string;
  discipline?: string;
  study_duration?: string;
  foreign_language?: string;
}

export interface TrainingPlan {
  course_name: string;
  course_code?: string;
  credit?: string;
  course_type?: string;
  required: boolean;
  term?: string;
  course_group?: string;
}

export interface AcademicWarning {
  warning_type: string;
  warning_level?: string;
  description?: string;
  term?: string;
}

export interface AcademicCompletion {
  plan_name?: string;
  total_required?: string;
  completed?: string;
  elective?: string;
  passed: boolean;
}

export interface EvaluationType {
  name: string;
  code?: string;
  count: number;
}

export interface EvaluationTask {
  wid: string;
  wjid?: string;
  name?: string;
  course_name?: string;
  teacher_name?: string;
  teacher_id?: string;
  term?: string;
  term_name?: string;
  eval_type?: string;
  eval_type_name?: string;
  category?: string;
  category_name?: string;
  start_time?: string;
  end_time?: string;
  sequence: number;
  class_name?: string;
  group_no?: string;
}

export interface QuestionOption {
  wid: string;
  text?: string;
  score: number;
  score_ratio: number;
  question_id?: string;
}

export interface Question {
  tmid: string;
  wjid?: string;
  text?: string;
  question_type?: string;
  max_score: number;
  order: number;
  options: QuestionOption[];
}

export interface EvaluationDetail {
  wjid?: string;
  name?: string;
  deadline?: string;
  questions: Question[];
  teachers?: Record<string, unknown>[];
}

export interface EvaluationAnswer {
  tmid: string;
  question_type?: string;
  option_ids?: string[];
  text?: string;
}

export interface CalculateScoreRequest {
  group_no: string;
  wjid: string;
  eval_type: string;
  answers: EvaluationAnswer[];
  teacher_relation_id?: string;
  course_name?: string;
  teacher_name?: string;
  sequence?: number;
}

export interface SubmitEvaluationRequest {
  group_no: string;
  wjid: string;
  eval_type: string;
  answers: EvaluationAnswer[];
  teacher_relation_id?: string;
  course_name?: string;
  teacher_name?: string;
  sequence?: number;
}

export interface ApiError {
  detail: string;
  code?: string;
}

export interface LessonActivity {
  activity_id: string;
  type: number | null;
  status: number | null;
  title: string | null;
  icon: string | null;
  sign_type: string | null;
  sign_clazz: string | null;
  is_end: boolean;
  is_creator: boolean;
  create_time: string | null;
  raw?: Record<string, unknown>;
}

export interface CurrentLesson {
  lesson_id: string | null;
  activity_list: LessonActivity[];
  raw?: Record<string, unknown>;
}

export interface SigninActivityDetail {
  activity_id: string;
  duration: number;
  end_time: string;
  left_seconds: number;
  signin_type: number;
  start_time: string;
  raw?: Record<string, unknown>;
}

export interface StudentSigninStatus {
  sign_status: number;
  attendance_status: number;
  sign_order: number;
  signin_type: number;
  raw?: Record<string, unknown>;
}

export interface StudentSignResult {
  sign_status: number;
  attendance_status: number;
  sign_order: number;
  signin_type: number;
  raw?: Record<string, unknown>;
}
