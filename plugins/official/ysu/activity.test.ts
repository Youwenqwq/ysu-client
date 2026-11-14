import { describe, expect, it } from "vitest"
import { labelYsuRequest } from "./activity"

describe("labelYsuRequest", () => {
  it.each([
    [
      "https://jwxt.ysu.edu.cn/jwapp/sys/studentWdksapApp/WdksapController/cxxsksap.do",
      "networkActivity.ysu.exams",
    ],
    [
      "https://jwxt.ysu.edu.cn/jwapp/sys/wdkb/modules/xskcb/cxxszhxqkb.do",
      "networkActivity.ysu.schedule",
    ],
    [
      "https://jwxt.ysu.edu.cn/jwapp/sys/syxkjg/modules/wdkb/cxxskb.do",
      "networkActivity.ysu.labSchedule",
    ],
    [
      "https://jwxt.ysu.edu.cn/jwapp/sys/pjapp/api/wdpj/getPjlx.do",
      "networkActivity.ysu.evaluation",
    ],
    ["https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/xscjcx.do", "networkActivity.ysu.grades"],
    [
      "https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/cxzxfaxfjd.do",
      "networkActivity.ysu.gpa",
    ],
    [
      "https://jwxt.ysu.edu.cn/jwapp/sys/cjcx/modules/cjcx/jxbcjtjcx.do",
      "networkActivity.ysu.gradeStats",
    ],
    [
      "https://jwxt.ysu.edu.cn/jwapp/sys/xsjbxxgl/modules/xsjbxx/cxxsjbxxlb.do",
      "networkActivity.ysu.studentInfo",
    ],
    [
      "https://jwxt.ysu.edu.cn/jwapp/sys/xsfacx/modules/pyfacxepg/grpyfacx.do",
      "networkActivity.ysu.trainingPlan",
    ],
    [
      "https://jwxt.ysu.edu.cn/jwapp/sys/bkbl/modules/bkbm/cxxtcs.do",
      "networkActivity.ysu.makeupExams",
    ],
    ["https://cer.ysu.edu.cn/authserver/login", "networkActivity.ysu.cas"],
    ["https://cer.ysu.edu.cn/authserver/reAuthCheck/reAuthSubmit.do", "networkActivity.ysu.casMfa"],
    ["https://jwxt.ysu.edu.cn/jwglxt/xtgl/login_slogin.html", "networkActivity.ysu.jwxtLogin"],
    ["https://jwxt.ysu.edu.cn/jwapp/sys/emaphome/portal/index.do", "networkActivity.ysu.portal"],
    ["https://jwxt.ysu.edu.cn/jwapp/code/c1e19f4d.do", "networkActivity.ysu.codes"],
    [
      "https://jwxt.ysu.edu.cn/jwmobile/biz/v410/lesson/queryCurrentLesson",
      "networkActivity.ysu.mobileLesson",
    ],
    ["https://jwxt.ysu.edu.cn/jwmobile/biz/v410/signin/sign", "networkActivity.ysu.signin"],
    ["https://ehall.ysu.edu.cn/publicapp/sys/myyktzd/index.do", "networkActivity.ysu.ecard"],
    ["https://epay.ysu.edu.cn/pay/allPay.html", "networkActivity.ysu.payment"],
    [
      "https://xgxt.ysu.edu.cn/xsfw/sys/swpubapp/indexmenu/getAppConfig.do",
      "networkActivity.ysu.studentAffairs",
    ],
    ["https://ldxt.ysu.edu.cn/XueFen/Summary", "networkActivity.ysu.credits"],
    ["http://202.206.247.49/ysu_xf/HuoDongKu/Declare/Index", "networkActivity.ysu.activities"],
    ["http://202.206.247.49/ysu_pt/JingSai/Declare/Index", "networkActivity.ysu.competitions"],
    ["https://ldxt.ysu.edu.cn/System/Home/Index", "networkActivity.ysu.campusLogin"],
    ["https://example.com/jwapp/sys/cjcx/modules/cjcx/xscjcx.do", undefined],
    ["https://jwxt.ysu.edu.cn/jwapp/sys/unknown/module.do", undefined],
  ])("classifies %s", (url, label) => {
    expect(labelYsuRequest(url)).toBe(label)
  })
})
