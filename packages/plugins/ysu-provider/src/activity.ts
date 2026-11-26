import type { PluginTranslations } from "@orahako/sdk"

const SCXT_HOST = "202.206.247.49"

function isYsuHost(host: string, extraHosts?: ReadonlySet<string>): boolean {
  return (
    host === "ysu.edu.cn" ||
    host.endsWith(".ysu.edu.cn") ||
    host === SCXT_HOST ||
    (extraHosts !== undefined && extraHosts.has(host))
  )
}

function labelJwapp(path: string): string | undefined {
  if (path.includes("/cjcx/modules/cjcx/")) {
    if (path.endsWith("/cxzxfaxfjd.do")) return "networkActivity.ysu.gpa"
    if (path.endsWith("/jxbcjtjcx.do")) return "networkActivity.ysu.gradeStats"
    if (path.endsWith("/jxbcjfbcx.do")) return "networkActivity.ysu.gradeDistribution"
    if (path.endsWith("/jxbxspmcx.do")) return "networkActivity.ysu.gradeRanking"
    return "networkActivity.ysu.grades"
  }
  if (path.includes("/wdkb/modules/jshkcb/jc.do")) return "networkActivity.ysu.classPeriods"
  if (path.includes("/wdkb/modules/jshkcb/dqzc.do")) return "networkActivity.ysu.currentWeek"
  if (path.includes("/wdkb/modules/xskcb/")) return "networkActivity.ysu.schedule"
  if (path.includes("/syxkjg/")) return "networkActivity.ysu.labSchedule"
  if (path.includes("/xsjbxxgl/")) return "networkActivity.ysu.studentInfo"
  if (path.includes("/xsfacx/") || path.includes("/jwpubapp/modules/pyfa/")) {
    return "networkActivity.ysu.trainingPlan"
  }
  if (path.includes("/xyyj/")) return "networkActivity.ysu.academicWarning"
  if (path.includes("/studentwdksapapp/")) {
    if (path.includes("dqxnxq")) return "networkActivity.ysu.currentTerm"
    return "networkActivity.ysu.exams"
  }
  if (path.includes("/pjapp/")) return "networkActivity.ysu.evaluation"
  if (path.includes("/bkbl/")) return "networkActivity.ysu.makeupExams"
  if (path.includes("/kcbcx/")) return "networkActivity.ysu.classroom"
  if (path.includes("/emaphome/")) return "networkActivity.ysu.portal"
  return undefined
}

function labelJwmobile(path: string): string {
  if (path.includes("/lesson/")) return "networkActivity.ysu.mobileLesson"
  if (path.includes("/signin/")) return "networkActivity.ysu.signin"
  if (path.includes("/auth/")) return "networkActivity.ysu.mobileLogin"
  return "networkActivity.ysu.mobile"
}

/**
 * Maps YSU provider endpoints to activity i18n keys. Only the key leaves this
 * function; the host never retains the URL. Returning undefined falls back to
 * the generic transport category.
 */
export function labelYsuRequest(url: string, extraHosts?: ReadonlySet<string>): string | undefined {
  let host: string
  let path: string
  try {
    const parsed = new URL(url)
    host = parsed.hostname.toLowerCase()
    path = parsed.pathname.toLowerCase()
  } catch {
    return undefined
  }
  if (!isYsuHost(host, extraHosts)) return undefined

  if (path.startsWith("/authserver/") || path.startsWith("/personalinfo/")) {
    if (path.includes("reauth") || path.includes("dynamiccode")) {
      return "networkActivity.ysu.casMfa"
    }
    return "networkActivity.ysu.cas"
  }
  if (path.startsWith("/jwmobile/")) return labelJwmobile(path)
  if (path.startsWith("/jwglxt/")) return "networkActivity.ysu.jwxtLogin"
  if (path.startsWith("/jwapp/code/")) return "networkActivity.ysu.codes"
  if (path.startsWith("/jwapp/sys/")) return labelJwapp(path)
  if (path.startsWith("/publicapp/")) return "networkActivity.ysu.ecard"
  if (path.startsWith("/pay/")) return "networkActivity.ysu.payment"
  if (path.startsWith("/xsfw/")) return "networkActivity.ysu.studentAffairs"
  if (path.includes("/xuefen/")) return "networkActivity.ysu.credits"
  if (path.includes("/huodongku/")) return "networkActivity.ysu.activities"
  if (path.includes("/jingsai/")) return "networkActivity.ysu.competitions"
  if (
    path.includes("/system/") ||
    path.includes("/unifiedauth/") ||
    path.includes("/about/unifiedauthenticationlogin")
  ) {
    return "networkActivity.ysu.campusLogin"
  }
  return undefined
}

/** Coarse YSU categories used by the generic transport activity service. */
export function classifyYsuRequest(
  url: string,
  extraHosts?: ReadonlySet<string>
): string | undefined {
  let host: string
  let path: string
  try {
    const parsed = new URL(url)
    host = parsed.hostname.toLowerCase()
    path = parsed.pathname.toLowerCase()
  } catch {
    return undefined
  }
  if (
    host === "open.weixin.qq.com" ||
    host === "lp.open.weixin.qq.com" ||
    host.endsWith(".weixin.qq.com")
  ) {
    return "wechat"
  }
  if (!isYsuHost(host, extraHosts)) return undefined
  if (path.startsWith("/authserver")) return "auth"
  if (path.startsWith("/jwmobile")) return "mobile"
  if (path.startsWith("/publicapp")) return "one-stop"
  if (path === "/pay" || path.startsWith("/pay/")) return "payment"
  if (path.startsWith("/jwapp") || path.startsWith("/jwglxt") || path.startsWith("/jwxt")) {
    return "academic"
  }
  if (
    path.startsWith("/xsfw") ||
    path.startsWith("/xuefen") ||
    path.startsWith("/system") ||
    path.startsWith("/huodongku") ||
    path.startsWith("/jingcai") ||
    path.startsWith("/jingsai")
  ) {
    return "campus"
  }
  return undefined
}

export const ysuPluginTranslations: PluginTranslations = {
  zh: {
    app: {
      sessionExpired: "登录会话已过期，请重新验证身份",
    },
    autoLogin: {
      captchaRequired: "当前登录需要图形验证码，请手动重新登录",
      mfaUnavailable: "当前登录需要二次验证，但未配置验证界面，请手动重新登录",
    },
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
    app: {
      sessionExpired: "Session expired, please sign in again",
    },
    autoLogin: {
      captchaRequired: "Captcha is required, please sign in manually",
      mfaUnavailable: "Two-factor verification is required but no verification UI is available",
    },
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
}
