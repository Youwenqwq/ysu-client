import { PLUGIN_API_VERSION, definePlugin, type PluginManifest } from "@orahako/plugin-sdk"
import { classifyYsuRequest, labelYsuRequest } from "./activity"
import type { YSUPluginContext } from "./context"
import { YSUProvider } from "./ysu-provider"
import { YSU_CONFIG } from "./ysu-config"

export const manifest: PluginManifest = {
  id: "ysu.provider",
  name: "燕山大学教务",
  version: "1.0.0",
  apiVersion: PLUGIN_API_VERSION,
  kind: "provider",
  required: true,
  inject: ["i18n", "providers", "http", "session", "storage", "query", "native", "mfa"],
  entry: "index.js",
  description: "燕山大学 CAS / 教务 / 移动端 / 缴费平台 Provider",
}

export const definition = definePlugin((baseCtx) => {
  const ctx = baseCtx as unknown as YSUPluginContext
  ctx.i18n.register({
    zh: {
      networkActivity: {
        ysu: {
          cas: "统一认证",
          casMfa: "二次认证",
          jwxtLogin: "教务登录",
          portal: "教务门户",
          codes: "教务基础数据",
          grades: "成绩查询",
          gpa: "绩点统计",
          gradeStats: "成绩统计",
          gradeDistribution: "成绩分布",
          gradeRanking: "成绩排名",
          schedule: "课表",
          labSchedule: "实验课表",
          classPeriods: "节次信息",
          currentWeek: "当前周",
          currentTerm: "学期信息",
          exams: "考试安排",
          makeupExams: "补考报名",
          evaluation: "教学评价",
          studentInfo: "学籍信息",
          trainingPlan: "培养方案",
          academicWarning: "学业预警",
          classroom: "教室课表",
          mobile: "移动教务",
          mobileLogin: "移动端登录",
          mobileLesson: "当前课程",
          signin: "课堂签到",
          ecard: "校园卡",
          payment: "缴费平台",
          studentAffairs: "学工服务",
          credits: "学分申报",
          activities: "活动库",
          competitions: "竞赛申报",
          campusLogin: "校园服务登录",
        },
      },
    },
    en: {
      networkActivity: {
        ysu: {
          cas: "Sign-in",
          casMfa: "Two-factor auth",
          jwxtLogin: "Academic login",
          portal: "Academic portal",
          codes: "Academic reference data",
          grades: "Grades",
          gpa: "GPA stats",
          gradeStats: "Grade statistics",
          gradeDistribution: "Grade distribution",
          gradeRanking: "Grade ranking",
          schedule: "Schedule",
          labSchedule: "Lab schedule",
          classPeriods: "Class periods",
          currentWeek: "Current week",
          currentTerm: "Term info",
          exams: "Exams",
          makeupExams: "Makeup exam signup",
          evaluation: "Teaching evaluation",
          studentInfo: "Student record",
          trainingPlan: "Training plan",
          academicWarning: "Academic warning",
          classroom: "Classroom schedule",
          mobile: "Mobile academic",
          mobileLogin: "Mobile login",
          mobileLesson: "Current lesson",
          signin: "Class check-in",
          ecard: "Campus card",
          payment: "Payments",
          studentAffairs: "Student affairs",
          credits: "Credit applications",
          activities: "Activities",
          competitions: "Competitions",
          campusLogin: "Campus services sign-in",
        },
      },
    },
  })
  ctx.http.activity.registerLabeler(labelYsuRequest)
  ctx.http.activity.registerClassifier(classifyYsuRequest)

  // The registry owns disposal: destroying this Cordis scope revokes the
  // registration together with the factory. The factory captures this plugin's
  // typed context, which is the exact scope the registry reuses for creation.
  ctx.providers.registerProvider(YSU_CONFIG.id, () => new YSUProvider(ctx))
})

export type { YSUMfaMethod } from "./types"
export default definition
