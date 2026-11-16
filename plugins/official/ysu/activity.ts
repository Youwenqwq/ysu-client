const SCXT_HOST = "202.206.247.49"

function isYsuHost(host: string): boolean {
  return host === "ysu.edu.cn" || host.endsWith(".ysu.edu.cn") || host === SCXT_HOST
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
export function labelYsuRequest(url: string): string | undefined {
  let host: string
  let path: string
  try {
    const parsed = new URL(url)
    host = parsed.hostname.toLowerCase()
    path = parsed.pathname.toLowerCase()
  } catch {
    return undefined
  }
  if (!isYsuHost(host)) return undefined

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
export function classifyYsuRequest(url: string): string | undefined {
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
  if (!isYsuHost(host)) return undefined
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
    path.startsWith("/jingcai")
  ) {
    return "campus"
  }
  return undefined
}
