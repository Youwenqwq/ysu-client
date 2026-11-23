import { describe, expect, it, vi } from "vitest"
import {
  BUILT_IN_ACADEMIC_SLICES,
  getEnabledSlices,
  getSlice,
  hasSlice,
  ProviderError,
  ProviderErrorCode,
} from "@orahako/academic-sdk"
import { CASCredential } from "../src/protocol/cas"
import { JWXTSession } from "../src/protocol/jwxt"
import { MobileSession } from "../src/protocol/jwmobile"
import {
  createYsuSchoolProvider,
  letterOfGradeLevel,
  letterOfScore,
  YSU_CONFIG,
  YSU_GPA_SCALE,
  YSU_GRADE_SCALE,
  YSU_SECURE_KEY_CAS_TGC,
  YSU_SESSION_ARTIFACT_JWXT,
  YSU_SESSION_ARTIFACT_MOBILE,
} from "../src"
import { createTestContext, emptyResponse, textResponse } from "./test-helper"

const LOGIN_PAGE_HTML = `<!doctype html>
<html><body>
<form id="pwdFromId">
  <input type="hidden" id="pwdEncryptSalt" value="0123456789abcdef" />
  <input type="hidden" name="execution" value="e1s1" />
  <input type="hidden" name="_eventId" value="submit" />
  <input type="hidden" name="cllt" value="userNameLogin" />
  <input type="hidden" name="dllt" value="generalLogin" />
  <input type="hidden" name="lt" value="" />
</form>
</body></html>`

function makeStoredCasJson(): string {
  return new CASCredential([
    {
      name: "CASTGC",
      value: "TGT-valid",
      domain: "cer.ysu.edu.cn",
      path: "/authserver",
      secure: true,
      expires: null,
    },
  ]).toJSON()
}

function makeStoredJwxtJson(): string {
  return new JWXTSession([
    {
      name: "JSESSIONID",
      value: "JWXT-1",
      domain: "jwxt.ysu.edu.cn",
      path: "/",
      secure: false,
      expires: null,
    },
  ]).toJSON()
}

function makeStoredMobileJson(): string {
  return new MobileSession([
    {
      name: "Authorization",
      value: "JWT-MOB-1",
      domain: "jwxt.ysu.edu.cn",
      path: "/jwmobile",
      secure: true,
      expires: null,
    },
  ]).toJSON()
}

function jsonResponse(url: string, payload: unknown, status = 200) {
  return textResponse(url, JSON.stringify(payload), status, {
    "content-type": "application/json; charset=utf-8",
  })
}

describe("YSU SchoolProvider API v1 contract & grade scale", () => {
  it("constructs a plain SchoolProvider with zero BaseProvider inheritance and all 15 built-in slices", () => {
    const { ctx } = createTestContext()
    const provider = createYsuSchoolProvider({
      session: ctx.session,
      http: ctx.http,
      storage: ctx.storage,
      native: ctx.native,
      i18n: ctx.i18n,
      query: ctx.query,
      mfa: ctx.mfa,
    })

    expect(provider.id).toBe("ysu")
    expect(provider.name).toBe("燕山大学")
    expect(Object.getPrototypeOf(provider)).toBe(Object.prototype)

    for (const sliceKey of BUILT_IN_ACADEMIC_SLICES) {
      expect(hasSlice(provider, sliceKey)).toBe(true)
      expect(getSlice(provider, sliceKey)).toBeDefined()
    }
    expect(getEnabledSlices(provider)).toEqual(BUILT_IN_ACADEMIC_SLICES)
  })

  it("computes YSU era-aware score letters, categorical grade letters, and 4.5 max GPA scale", () => {
    expect(YSU_GPA_SCALE.max).toBe(4.5)
    expect(YSU_GPA_SCALE.bands.length).toBeGreaterThan(0)
    expect(YSU_GRADE_SCALE.letterOfScore).toBe(letterOfScore)
    expect(YSU_GRADE_SCALE.letterOfGradeLevel).toBe(letterOfGradeLevel)

    // Pre-2022 spring era (< 2021-2022-2)
    expect(letterOfScore(96, "2021-2022-1")).toBe("A+")
    expect(letterOfScore(92, "2021-2022-1")).toBe("A")
    expect(letterOfScore(86, "2021-2022-1")).toBe("B+")
    expect(letterOfScore(81, "2021-2022-1")).toBe("B")
    expect(letterOfScore(76, "2021-2022-1")).toBe("C+")
    expect(letterOfScore(71, "2021-2022-1")).toBe("C")
    expect(letterOfScore(66, "2021-2022-1")).toBe("D+")
    expect(letterOfScore(61, "2021-2022-1")).toBe("D")
    expect(letterOfScore(45, "2021-2022-1")).toBe("F")
    expect(letterOfScore(30, "2021-2022-1")).toBe("F-")

    // 2022 spring ~ 2024 spring era
    expect(letterOfScore(96, "2022-2023-1")).toBe("A+")
    expect(letterOfScore(91, "2023-2024-2")).toBe("A")
    expect(letterOfScore(87, "2023-2024-2")).toBe("B+")
    expect(letterOfScore(83, "2023-2024-2")).toBe("B")
    expect(letterOfScore(79, "2023-2024-2")).toBe("B-")
    expect(letterOfScore(75, "2023-2024-2")).toBe("C+")
    expect(letterOfScore(71, "2023-2024-2")).toBe("C")
    expect(letterOfScore(66, "2023-2024-2")).toBe("C-")
    expect(letterOfScore(61, "2023-2024-2")).toBe("D")

    // >= 2024 autumn era (and default when semester is omitted)
    expect(letterOfScore(97)).toBe("A+")
    expect(letterOfScore(94, "2024-2025-1")).toBe("A")
    expect(letterOfScore(90, "2024-2025-2")).toBe("A-")
    expect(letterOfScore(86, "2024-2025-1")).toBe("B+")
    expect(letterOfScore(82, "2024-2025-1")).toBe("B")
    expect(letterOfScore(78, "2024-2025-1")).toBe("B-")
    expect(letterOfScore(74, "2024-2025-1")).toBe("C+")
    expect(letterOfScore(70, "2024-2025-1")).toBe("C")
    expect(letterOfScore(66, "2024-2025-1")).toBe("C-")
    expect(letterOfScore(60, "2024-2025-1")).toBe("D")
    expect(letterOfScore(50, "2024-2025-1")).toBe("F")
    expect(letterOfScore(20, "2024-2025-1")).toBe("F-")

    // Categorical levels
    expect(letterOfGradeLevel("优秀")).toBe("A")
    expect(letterOfGradeLevel("良好")).toBe("B")
    expect(letterOfGradeLevel("中等")).toBe("C")
    expect(letterOfGradeLevel("及格")).toBe("D")
    expect(letterOfGradeLevel("通过")).toBe("C")
    expect(letterOfGradeLevel("不合格")).toBe("F")
    expect(letterOfGradeLevel("b+")).toBe("B+")
    expect(letterOfGradeLevel("未知等级")).toBeUndefined()
  })
})

describe("YSU SchoolProvider 15-slice functional integration", () => {
  it("queries only evaluation types with count > 0 in evaluation.getEvaluationTasks and populates providerTaskId", async () => {
    const pendingCalls: string[] = []
    const { ctx } = createTestContext({
      initialState: {
        activeSchoolId: "ysu",
        username: "20230001",
        credential: makeStoredCasJson(),
        isAuthenticated: true,
        artifacts: {
          [YSU_SESSION_ARTIFACT_JWXT]: makeStoredJwxtJson(),
        },
      },
      fetchWithJar: async (_jar, req) => {
        if (req.url.includes("appShow")) return emptyResponse(req.url)
        if (req.url.includes("getPjlx.do")) {
          return jsonResponse(req.url, {
            code: "0",
            datas: {
              getPjlx: {
                rows: [
                  { PJLXMC: "学生评教", PJLXDM: "01", NUMBER: 0 },
                  { PJLXMC: "督导评教", PJLXDM: "02", NUMBER: 2 },
                ],
              },
            },
          })
        }
        if (req.url.includes("getDpwj.do")) {
          const bodyStr = String(req.body ?? "")
          const params = new URLSearchParams(bodyStr)
          pendingCalls.push(params.get("PJLXDM") ?? "")
          return jsonResponse(req.url, {
            code: "0",
            datas: {
              getDpwj: {
                rows: [
                  {
                    WID: "w-1",
                    WJID: "wj-1",
                    MC: "期末评教",
                    KCM: "高等数学",
                    XM: "张老师",
                    PJLXDM: "02",
                    GROUPNO: "GRP-9",
                    XUH: 1,
                  },
                ],
              },
            },
          })
        }
        return emptyResponse(req.url)
      },
    })

    const provider = createYsuSchoolProvider({
      session: ctx.session,
      http: ctx.http,
      storage: ctx.storage,
      native: ctx.native,
      i18n: ctx.i18n,
      query: ctx.query,
      mfa: ctx.mfa,
    })
    await provider.initialize()

    const tasks = await provider.slices.evaluation!.getEvaluationTasks({ semester: "2024-2025-1" })
    expect(pendingCalls).toEqual(["02"])
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      wid: "w-1",
      wjid: "wj-1",
      name: "期末评教",
      courseName: "高等数学",
      teacherName: "张老师",
      evalType: "02",
      groupNo: "GRP-9",
      providerTaskId: "GRP-9|02|1",
    })
  })

  it("executes representative queries across JWXT-backed, mobile, ecard, epay, ldxt, scxt, xgxt, nativePolling, and diagnostics slices", async () => {
    const { ctx, secureStore } = createTestContext({
      initialState: {
        activeSchoolId: "ysu",
        username: "20230001",
        credential: makeStoredCasJson(),
        isAuthenticated: true,
        artifacts: {
          [YSU_SESSION_ARTIFACT_JWXT]: makeStoredJwxtJson(),
          [YSU_SESSION_ARTIFACT_MOBILE]: makeStoredMobileJson(),
        },
      },
      fetchWithJar: async (jar, req) => {
        const url = req.url

        // CAS check / authorize
        const casLoginUrl = `${YSU_CONFIG.cas.cerBaseUrl}/authserver/login`
        if (url === `${YSU_CONFIG.cas.cerBaseUrl}/authserver/index.do` && req.method === "GET") {
          return textResponse(url, "", 302, {
            location: "https://cer.ysu.edu.cn/personalInfo/index.html",
          })
        }
        if (url.startsWith(`${casLoginUrl}?service=`)) {
          const serviceUrl =
            new URL(url).searchParams.get("service") ??
            `${YSU_CONFIG.jwxt.jwxtBaseUrl}${YSU_CONFIG.jwxt.portalPath}`
          const serviceHost = new URL(serviceUrl).hostname
          await jar.setCookie(`SESSION=AUTH_OK; Domain=${serviceHost}; Path=/`, serviceUrl)
          return textResponse(serviceUrl, "<html>authorized</html>", 200, {
            "content-type": "text/html",
          })
        }

        // JWXT EMAP endpoints
        if (url.includes("appShow")) {
          await jar.setCookie("_WEU=weu-token; Domain=jwxt.ysu.edu.cn; Path=/", url)
          return emptyResponse(url)
        }
        if (url.includes("dqxnxq.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: { dqxnxq: { rows: [{ DM: "2024-2025-1" }] } },
          })
        }
        if (url.includes("cxxsjbxxlb.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              cxxsjbxxlb: {
                rows: [{ XM: "张三", XH: "20230001", YXDM_DISPLAY: "信息科学与工程学院" }],
              },
            },
          })
        }
        if (url.includes("cxxskb.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              cxxskb: {
                rows: [
                  {
                    KCM: "数据结构实验",
                    KCH: "CS101L",
                    SKJS: "李老师",
                    JASMC: "实验楼202",
                    SKXQ: 2,
                    KSJC: 3,
                    JSJC: 4,
                    ZCMC: "1-8周",
                  },
                ],
              },
            },
          })
        }
        if (url.includes("cxxsllsywpk.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              cxxsllsywpk: {
                rows: [{ KCM: "毕业实习", KCH: "CS499", SKJS: "王老师" }],
              },
            },
          })
        }
        if (url.includes("jshkcb/jc.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              jc: {
                rows: [{ MC: "第1节", DM: 1, KSSJ: "08:00", JSSJ: "08:45", SFSY: "1" }],
              },
            },
          })
        }
        if (url.includes("cxxljc.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              cxxljc: {
                rows: [
                  {
                    XN: "2024-2025",
                    XQ: "1",
                    XQKSRQ: "2024-09-02 00:00:00",
                    ZZC: 20,
                    ZJXZC: 18,
                    SFSY: "1",
                  },
                ],
              },
            },
          })
        }
        if (url.includes("dqzc.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              dqzc: {
                rows: [{ ZC: 5, XQJ: 3, XN: "2024-2025", XQ: "1", RQ: "2024-10-02" }],
              },
            },
          })
        }
        if (url.includes("xscjcx.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              xscjcx: {
                rows: [
                  {
                    XSKCM: "编译原理",
                    XSKCH: "CS301",
                    ZCJ: 92,
                    XF: 3.5,
                    XFJD: 4.2,
                    XNXQDM: "2024-2025-1",
                    SFJG: "1",
                    SFYX: "1",
                  },
                ],
              },
            },
          })
        }
        if (url.includes("cxzxfaxfjd.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              cxzxfaxfjd: {
                rows: [{ PYFAMC: "计算机科学与技术方案", PPJDZG: "3.95", JQPJF: "89.5" }],
              },
            },
          })
        }
        if (url.includes("jxbcjtjcx.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              jxbcjtjcx: {
                rows: [{ TJLX: "01", ZGF: 98, ZDF: 62, PJF: 84.5 }],
              },
            },
          })
        }
        if (url.includes("jxbcjfbcx.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              jxbcjfbcx: {
                rows: [{ TJLX: "01", DJDM: "90-100", DJDM_DISPLAY: "优秀", DJSL: 12 }],
              },
            },
          })
        }
        if (url.includes("jxbxspmcx.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              jxbxspmcx: {
                rows: [{ TJLX: "01", PMF: 92, PM: 3, ZRS: 35 }],
              },
            },
          })
        }
        if (url.includes("cxxsksap.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              cxxsksap: {
                rows: [
                  {
                    KCM: "操作系统",
                    KSMC: "期末考试",
                    KSRQ: "2025-01-08",
                    KSSJMS: "09:00-11:00",
                    JASMC: "西区302",
                    ZWH: "18",
                  },
                ],
              },
            },
          })
        }
        if (url.includes("cxxtcs.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              cxxtcs: { rows: [{ CSZA: "2024-2025-1" }] },
            },
          })
        }
        if (url.includes("cxbkkspc.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              cxbkkspc: {
                rows: [
                  {
                    KSMC: "2024秋补考",
                    KSDM: "B1",
                    XNXQDM: "2024-2025-1",
                    KBMCOUNT: 1,
                    YBMCOUNT: 0,
                  },
                ],
              },
            },
          })
        }
        if (url.includes("xgksrwxs.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: { xgksrwxs: { extParams: { code: "1", msg: "ok" } } },
          })
        }
        if (url.includes("grpyfacx.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: { grpyfacx: { rows: [{ PYFADM: "PLAN-2023" }] } },
          })
        }
        if (url.includes("kzkccx.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              kzkccx: {
                rows: [{ KCM: "离散数学", KCH: "CS102", XF: "3", KCXZDM: "01" }],
              },
            },
          })
        }
        if (url.includes("cxxsscfa.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              cxxsscfa: {
                rows: [{ PYFAMC: "计科培养方案", YQXF: "160", WCXF: "120", JSSFTG: "0" }],
              },
            },
          })
        }
        if (url.includes("cxxsyjpcjg.do")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              cxxsyjpcjg: {
                rows: [{ SCJLMC: "学分预警", YJJB: "黄色预警", SCPCMC: "2024-2025-1" }],
              },
            },
          })
        }
        if (url.includes("/jwapp/code/")) {
          return jsonResponse(url, {
            code: "0",
            datas: {
              code: {
                rows: [{ id: "01", name: "测试编码项" }],
              },
            },
          })
        }

        // Mobile endpoints
        if (url.includes("/jwmobile/biz/v410/lesson/queryCurrentLesson")) {
          return jsonResponse(url, {
            code: "200",
            data: {
              lessonId: "L-100",
              activityList: [
                {
                  activityId: "ACT-1",
                  type: 1,
                  status: 1,
                  title: "课堂签到",
                  isEnd: 0,
                  isCreator: 0,
                },
              ],
            },
          })
        }

        // LDXT (labor)
        if (url.startsWith("https://ldxt.ysu.edu.cn")) {
          await jar.setCookie("ASP.NET_SessionId=LD1; Domain=ldxt.ysu.edu.cn; Path=/", url)
          if (url.includes("/About/UnifiedAuthenticationLogin") && req.method === "POST") {
            return jsonResponse(url, { Success: true, Data: { Url: "/System/Home/Index" } })
          }
          if (url.includes("/XueFen/SummaryQuery/Index")) {
            return textResponse(
              url,
              `<table><thead><tr><th>学生学号</th><th>学生姓名</th><th>劳动时长</th><th>总学分</th></tr></thead>
               <tbody><tr><td>20230001</td><td>张三</td><td>32</td><td>2</td></tr></tbody></table>`,
              200,
              { "content-type": "text/html" }
            )
          }
          if (url.includes("/XueFen/Summary")) {
            return textResponse(
              url,
              `<table><thead><tr><th>学期</th><th>活动名称</th><th>劳动时长</th><th>状态</th></tr></thead>
               <tbody><tr><td>2024-2025-1</td><td>校园清扫</td><td>4</td><td>已认定</td></tr></tbody></table>`,
              200,
              { "content-type": "text/html" }
            )
          }
          if (url.includes("/XueFen/Enroll/Index")) {
            return textResponse(
              url,
              `<table><thead><tr><th>活动名称</th><th>活动地点</th><th>劳动时长</th><th>是否报名</th><th>操作</th></tr></thead>
               <tbody><tr><td>图书馆整理</td><td>东区图书馆</td><td>2</td><td>否</td><td>报名</td></tr></tbody></table>`,
              200,
              { "content-type": "text/html" }
            )
          }
          return textResponse(url, "<html><body>Home</body></html>", 200, {
            "content-type": "text/html",
          })
        }

        // SCXT (innovation credits)
        if (url.startsWith("http://202.206.247.49")) {
          await jar.setCookie("ASP.NET_SessionId=SC1; Domain=202.206.247.49; Path=/", url)
          if (url.includes("/System/Platform/AccessSubsystem/")) {
            return textResponse(url, "", 302, {
              location: "http://202.206.247.49/ysu_xf/authserver/access?ticket=T1",
            })
          }
          if (url.includes("/authserver/access")) {
            return textResponse(url, "", 302, {
              location: "http://202.206.247.49/ysu_xf/System/Home/Index",
            })
          }
          if (url.includes("/XueFen/Declare/Index")) {
            return textResponse(
              url,
              `<select name="BatchID"><option value="">请选择</option><option value="B2024">2024批次</option></select>
               <table><thead><tr><th>项目名称</th><th>所得学分</th><th>审核状态</th></tr></thead>
               <tbody><tr><td>数学建模</td><td>2</td><td>通过</td></tr></tbody></table>`,
              200,
              { "content-type": "text/html" }
            )
          }
          if (url.includes("/XueFen/SummaryQuery/Index")) {
            return textResponse(
              url,
              `<table><thead><tr><th>账号</th><th>用户名</th><th>总学分</th></tr></thead>
               <tbody><tr><td>20230001</td><td>张三</td><td>4.5</td></tr></tbody></table>`,
              200,
              { "content-type": "text/html" }
            )
          }
          return textResponse(url, "<html><body>SCXT</body></html>", 200, {
            "content-type": "text/html",
          })
        }

        // XGXT (comprehensive evaluation)
        if (url.startsWith("https://xgxt.ysu.edu.cn")) {
          await jar.setCookie("MOD_AMP_AUTH=XG1; Domain=xgxt.ysu.edu.cn; Path=/", url)
          if (url.includes("getCpxnxq.do")) {
            return jsonResponse(url, {
              code: "0",
              data: {
                XNXX: [
                  {
                    CPXN: "2023-2024",
                    CPXQ: "1",
                    CPXN_DISPLAY: "2023-2024学年",
                    CPXQ_DISPLAY: "第一学期",
                    WID: "W1",
                  },
                ],
              },
            })
          }
          if (url.includes("getYearCjStatic.do")) {
            return jsonResponse(url, {
              code: "0",
              data: [{ XNZ: "2023-2024", XQZ: "1", FS: "88.6" }],
            })
          }
          return jsonResponse(url, { code: "0", data: {}, datas: {} })
        }

        return emptyResponse(url)
      },
    })

    secureStore.set(YSU_SECURE_KEY_CAS_TGC, makeStoredCasJson())

    const provider = createYsuSchoolProvider({
      session: ctx.session,
      http: ctx.http,
      storage: ctx.storage,
      native: ctx.native,
      i18n: ctx.i18n,
      query: ctx.query,
      mfa: ctx.mfa,
    })
    await provider.initialize()

    // Timetable + Mobile
    const schedule = await provider.slices.timetable!.getSchedule({ includeLabSchedule: true })
    expect(schedule[0]?.name).toBe("数据结构实验")
    const unscheduled = await provider.slices.timetable!.getUnscheduledCourses!()
    expect(unscheduled[0]?.name).toBe("毕业实习")
    const periods = await provider.slices.timetable!.getClassPeriods!()
    expect(periods[0]).toMatchObject({ section: 1, startTime: "08:00", endTime: "08:45" })
    const calendar = await provider.slices.timetable!.getTermCalendar!()
    expect(calendar).toMatchObject({ semester: "2024-2025-1", totalWeeks: 20, teachingWeeks: 18 })
    await expect(provider.slices.timetable!.getCurrentWeekNumber!()).resolves.toBe(5)
    const currentLesson = await provider.slices.timetable!.mobile!.getCurrentLesson({
      teachClassId: "TC1",
      teachClassType: "01",
      scheduleId: "SCH1",
      week: 5,
      weekDay: 1,
      startNode: 1,
      endNode: 2,
    })
    expect(currentLesson.lessonId).toBe("L-100")

    // SchoolSchedule
    const gradeYears = await provider.slices.schoolSchedule!.getSchoolGradeYears()
    expect(gradeYears).toEqual([{ id: "01", name: "测试编码项" }])

    // Grades
    const grades = await provider.slices.grades!.getGrades()
    expect(grades[0]).toMatchObject({ courseName: "编译原理", numericScore: 92 })
    const gpa = await provider.slices.grades!.getGPAStats!()
    expect(gpa).toMatchObject({ planName: "计算机科学与技术方案", gpaHighest: "3.95" })
    const stats = await provider.slices.grades!.getGradeStatistics!({ classId: "JXB-1" })
    expect(stats).toMatchObject({ highestScore: 98, lowestScore: 62, averageScore: 84.5 })
    const dist = await provider.slices.grades!.getGradeDistribution!({ classId: "JXB-1" })
    expect(dist[0]).toMatchObject({ levelName: "优秀", count: 12 })
    const ranking = await provider.slices.grades!.getGradeRanking!({ classId: "JXB-1" })
    expect(ranking).toMatchObject({ rank: 3, total: 35 })

    // Exams & MakeupExams
    const exams = await provider.slices.exams!.getExams()
    expect(exams[0]).toMatchObject({ name: "操作系统", examLocation: "西区302", seatNumber: "18" })
    const batches = await provider.slices.makeupExams!.getMakeupExamBatches()
    expect(batches[0]).toMatchObject({ batchId: "B1", name: "2024秋补考" })
    await expect(
      provider.slices.makeupExams!.signupMakeupExam({ taskId: "T1", batchId: "B1" })
    ).resolves.toBeUndefined()

    // StudentProfile & TrainingPlan
    const profile = await provider.slices.studentProfile!.getStudentInfo()
    expect(profile).toMatchObject({ name: "张三", studentId: "20230001" })
    const plan = await provider.slices.trainingPlan!.getTrainingPlan()
    expect(plan[0]).toMatchObject({ courseName: "离散数学", required: true })
    const completion = await provider.slices.trainingPlan!.getAcademicCompletion!()
    expect(completion).toMatchObject({ planName: "计科培养方案", passed: false })
    const warnings = await provider.slices.trainingPlan!.getAcademicWarnings!()
    expect(warnings[0]).toMatchObject({ warningType: "学分预警", warningLevel: "黄色预警" })

    // Epay status helper
    expect(
      provider.slices.epay!.recordStatus({
        id: "EPAY-1",
        payName: "学费",
        chargeYear: "2024",
        currencyTypeShow: "人民币",
        amountN: 5000,
        amount: "5000.00",
        payAmount: "5000.00",
        refundAmount: "0.00",
        status: "1",
        expired: "0",
        startTime: "2024-08-20 00:00:00",
        overTime: "2024-08-25 12:00:00",
      })
    ).toBe("paid")

    // Labor (LDXT)
    const laborRecords = await provider.slices.labor!.getLaborRecords()
    expect(laborRecords[0]).toMatchObject({ name: "校园清扫", hours: 4 })
    const laborSummary = await provider.slices.labor!.getLaborSummary()
    expect(laborSummary).toMatchObject({ studentId: "20230001", totalHours: 32, totalCredits: 2 })
    const laborActivities = await provider.slices.labor!.getLaborActivities()
    expect(laborActivities[0]).toMatchObject({ name: "图书馆整理", isEnrolled: false })

    // Credits (SCXT)
    const creditBatches = await provider.slices.credits!.getCreditBatches()
    expect(creditBatches).toEqual([{ batchId: "B2024", name: "2024批次" }])
    const creditSummary = await provider.slices.credits!.getCreditSummary()
    expect(creditSummary).toMatchObject({ studentId: "20230001", totalCredits: 4.5 })

    // Comprehensive (XGXT)
    const compTerms = await provider.slices.comprehensive!.getComprehensiveTerms()
    expect(compTerms[0]).toMatchObject({ year: "2023-2024", term: "1" })
    const yearScores = await provider.slices.comprehensive!.getComprehensiveYearScores()
    expect(yearScores[0]).toMatchObject({ year: "2023-2024", score: "88.6" })

    // NativePolling
    expect(provider.slices.nativePolling!.handlerId).toBe("ysu")
    const serverCfg = provider.slices.nativePolling!.getServerConfig()
    expect(serverCfg).toMatchObject({
      configVersion: 2,
      cerBaseUrl: YSU_CONFIG.cas.cerBaseUrl,
      jwxtBaseUrl: YSU_CONFIG.jwxt.jwxtBaseUrl,
    })
    await expect(provider.slices.nativePolling!.getAuthToken()).resolves.toBe("TGT-valid")

    // Diagnostics
    expect(provider.diagnostics.labels.authSystem).toBe("CAS")
    await expect(provider.diagnostics.checkAuth()).resolves.toBe(true)
  })
})

describe("YSU SchoolProvider lifecycle, concurrency, relogin, and session expiry", () => {
  it("deduplicates concurrent initialize() calls and cancels stale generation on reset()", async () => {
    const gate = Promise.withResolvers<void>()
    let authChecks = 0

    const { ctx, secureStore } = createTestContext({
      initialState: {
        activeSchoolId: "ysu",
        username: "20230001",
        credential: makeStoredCasJson(),
        isAuthenticated: true,
      },
      fetchWithJar: async (_jar, req) => {
        if (req.url === `${YSU_CONFIG.cas.cerBaseUrl}/authserver/index.do`) {
          authChecks += 1
          await gate.promise
          return textResponse(req.url, "", 302, {
            location: "https://cer.ysu.edu.cn/personalInfo/index.html",
          })
        }
        return emptyResponse(req.url)
      },
    })
    secureStore.set(YSU_SECURE_KEY_CAS_TGC, makeStoredCasJson())

    const provider = createYsuSchoolProvider({
      session: ctx.session,
      http: ctx.http,
      storage: ctx.storage,
      native: ctx.native,
      i18n: ctx.i18n,
      query: ctx.query,
      mfa: ctx.mfa,
    })

    const p1 = provider.initialize()
    const p2 = provider.initialize()
    expect(p1).toBe(p2)

    // Reset while first initialize is still in flight
    const resetPromise = provider.reset()
    gate.resolve()
    await Promise.all([p1, resetPromise])

    expect(secureStore.has(YSU_SECURE_KEY_CAS_TGC)).toBe(false)
    expect(authChecks).toBe(0)

    // Subsequent initialize runs fresh in the new generation
    await provider.initialize()
    await provider.logout()
    expect(ctx.session.getSnapshot().isAuthenticated).toBe(false)
  })

  it("maps JWXT NotAuthenticatedError during reauthorization to AUTH_SESSION_EXPIRED while preserving isAuthenticated", async () => {
    const casLoginUrl = `${YSU_CONFIG.cas.cerBaseUrl}/authserver/login`
    const { ctx, state } = createTestContext({
      initialState: {
        activeSchoolId: "ysu",
        username: "20230001",
        credential: makeStoredCasJson(),
        isAuthenticated: true,
      },
      fetchWithJar: async (_jar, req) => {
        if (req.url.startsWith(casLoginUrl)) {
          return textResponse(casLoginUrl, LOGIN_PAGE_HTML, 200, { "content-type": "text/html" })
        }
        return emptyResponse(req.url)
      },
    })

    const provider = createYsuSchoolProvider({
      session: ctx.session,
      http: ctx.http,
      storage: ctx.storage,
      native: ctx.native,
      i18n: ctx.i18n,
      query: ctx.query,
      mfa: ctx.mfa,
    })

    await expect(provider.slices.studentProfile!.getStudentInfo()).rejects.toMatchObject({
      code: ProviderErrorCode.AUTH_SESSION_EXPIRED,
      status: 401,
    })
    expect(state.isAuthenticated).toBe(true)
  })

  it("completes relogin() via SMS MFA when CAS redirects to reAuthPage", async () => {
    const casLoginUrl = `${YSU_CONFIG.cas.cerBaseUrl}/authserver/login`
    const mfaShow = vi.fn(async () => ({
      type: "code" as const,
      method: "sms",
      methodCode: "reAuthDynamicCodeType",
      code: "654321",
    }))

    const { ctx, state } = createTestContext({
      initialState: {
        activeSchoolId: "ysu",
        username: "20230001",
        credential: makeStoredCasJson(),
        isAuthenticated: true,
        sessionExpired: true,
        artifacts: {
          "remembered-username": "20230001",
          "remembered-password": "secret-password",
        },
      },
      mfaShow,
      fetchWithJar: async (jar, req) => {
        if (
          req.url === `${YSU_CONFIG.cas.cerBaseUrl}/authserver/index.do` &&
          req.method === "GET"
        ) {
          const cookies = await jar.getCookieString(req.url)
          if (cookies.includes("CASTGC=TGT-mfa")) {
            return textResponse(req.url, "", 302, {
              location: "https://cer.ysu.edu.cn/personalInfo/index.html",
            })
          }
          return textResponse(req.url, "", 302, {
            location:
              "https://cer.ysu.edu.cn/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true",
          })
        }
        if (req.url.startsWith(`${casLoginUrl}?service=`) && req.method === "GET") {
          return textResponse(casLoginUrl, LOGIN_PAGE_HTML, 200, {
            "content-type": "text/html",
          })
        }
        if (req.url.includes("checkNeedCaptcha.htl")) {
          return jsonResponse(req.url, { isNeed: false })
        }
        if (req.url.startsWith(casLoginUrl) && req.method === "POST") {
          return textResponse(req.url, "", 302, {
            location:
              "https://cer.ysu.edu.cn/authserver/reAuthCheck/reAuthLoginView.do?isMultifactor=true",
          })
        }
        if (req.url.includes("reAuthLoginView.do")) {
          return textResponse(req.url, "<html>reAuth</html>", 200, { "content-type": "text/html" })
        }
        if (req.url.includes("reAuthSubmit.do") && req.method === "POST") {
          await jar.setCookie("CASTGC=TGT-mfa; Domain=cer.ysu.edu.cn; Path=/authserver", req.url)
          return jsonResponse(req.url, { code: "reAuth_success" })
        }
        return emptyResponse(req.url)
      },
    })

    const provider = createYsuSchoolProvider({
      session: ctx.session,
      http: ctx.http,
      storage: ctx.storage,
      native: ctx.native,
      i18n: ctx.i18n,
      query: ctx.query,
      mfa: ctx.mfa,
    })

    await expect(provider.relogin()).resolves.toBe(true)
    expect(mfaShow).toHaveBeenCalledOnce()
    expect(state.isAuthenticated).toBe(true)
    expect(state.sessionExpired).toBe(false)
  })

  it("rejects unsupported MFA methods on auth.submitMfaCode with FEATURE_NOT_SUPPORTED", async () => {
    const { ctx } = createTestContext()
    const provider = createYsuSchoolProvider({
      session: ctx.session,
      http: ctx.http,
      storage: ctx.storage,
      native: ctx.native,
      i18n: ctx.i18n,
      query: ctx.query,
      mfa: ctx.mfa,
    })

    await expect(
      provider.slices.auth!.submitMfaCode!({
        challenge: {
          method: "totp",
          methodCode: "totpCode",
          mobileHint: "",
          username: "20230001",
        },
        code: "123456",
      })
    ).rejects.toBeInstanceOf(ProviderError)

    await expect(
      provider.slices.auth!.submitMfaCode!({
        challenge: {
          method: "totp",
          methodCode: "totpCode",
          mobileHint: "",
          username: "20230001",
        },
        code: "123456",
      })
    ).rejects.toMatchObject({
      code: ProviderErrorCode.FEATURE_NOT_SUPPORTED,
      status: 501,
    })
  })
})
