import { describe, expect, it } from "vitest"
import {
  currentWeekFromContext,
  discoverCurrentSemester,
  mapExams,
  mapGrades,
  mapSchedule,
  parseStudentInfo,
  parseTermContext,
  semesterCode,
  semesterName,
} from "./mappers"

describe("ZMU protocol mappers", () => {
  it("maps the real profile label/select/input shapes", () => {
    const profile = parseStudentInfo(`
      <table><tr><td>学号：</td><td><label>20240001</label></td>
      <td>姓名：</td><td><label>测试学生</label></td></tr>
      <tr><td>院系名称：</td><td><label>第一临床学院</label></td>
      <td>专业：</td><td><label>临床医学</label></td>
      <td>培养层次：</td><td><label>本科</label></td></tr>
      <tr><td>班级：</td><td><label>临床24-8</label></td>
      <td>所在年级：</td><td><label>2024</label></td>
      <td>学制：</td><td><label>5</label></td></tr>
      <tr><td>所在校区：</td><td><label>新蒲校区</label></td>
      <td>学生状态：</td><td><label>在读</label></td></tr>
      <tr><td>毕业日期：</td><td><label>20290701</label></td></tr>
      <tr><td>外语语种：</td><td><label>无</label></td></tr></table>
      <input id="py" value="Test Student"><input id="rxrq" value="20240901">
      <select id="xbdm"><option value="1" selected>男</option></select>
      <select id="mzdm"><option value="01" selected>汉族</option></select>
    `)
    expect(profile).toMatchObject({
      studentId: "20240001",
      name: "测试学生",
      department: "第一临床学院",
      major: "临床医学",
      className: "临床24-8",
      enrollmentDate: "2024-09-01",
      expectedGraduation: "2029-07-01",
      gender: "男",
      nation: "汉族",
    })
  })

  it("normalizes semester codes and reads server-selected term anchors", () => {
    expect(semesterCode("2026-2027-1")).toBe("202601")
    expect(semesterName("202601")).toBe("2026-2027-1")
    expect(() => semesterCode("2026-2028-1")).toThrow("Unsupported")
    const html = `<option value='202602'>2026-2027-2</option>
      <option value='202601' selected>2026-2027-1</option>
      <script>var val = '' || '' || '11';</script>`
    expect(parseTermContext(html)).toEqual({ code: "202601", semester: "2026-2027-1", week: 11 })
    expect(discoverCurrentSemester("getXsgrbkList.action?xnxqdm=202601")).toBe("202601")
  })

  it("aggregates full-term schedule weeks without merging different rooms", () => {
    const row = (zc: string, room = "第三阶梯教室") => ({
      kcmc: "药理学",
      kcbh: "TMP570",
      teaxms: "张成宸",
      jxcdmc: room,
      xq: "4",
      jcdm2: "01,02",
      zc,
      jxbdm: "1178861",
    })
    const courses = mapSchedule([[row("1"), row("2"), row("2", "第四阶梯教室")], []])
    expect(courses).toHaveLength(2)
    expect(courses[0]).toMatchObject({
      name: "药理学",
      weekDay: 4,
      startSection: 1,
      endSection: 2,
      weeks: "1,2",
      weekList: [1, 2],
    })
    expect(courses[1]).toMatchObject({ classroom: "第四阶梯教室", weekList: [2] })
  })

  it("preserves non-numeric scores and valid/pass state", () => {
    const grades = mapGrades({
      rows: [
        { kcmc: "实验室安全教育", zcj: "合格", xf: "0.4", cjjd: "3", isactive: "1" },
        { kcmc: "补考课程", zcj: "45", xf: "2", isactive: "0" },
      ],
    })
    expect(grades[0]).toMatchObject({
      gradeLevel: "合格",
      isPass: true,
      isValid: true,
      numericCredit: 0.4,
    })
    expect(grades[1]).toMatchObject({ numericScore: 45, isPass: false, isValid: false })
  })

  it("maps exam local times to China timestamps and completion state", () => {
    const exams = mapExams(
      {
        rows: [
          {
            kcmc: "医学免疫学",
            ksrq: "2026-06-30",
            kssj: "09:00:00--11:00:00",
            xqmc: "新蒲校区",
            kscdmc: "第三十二阶梯教室",
            zwh: "689",
          },
        ],
      },
      Date.parse("2026-07-01T00:00:00+08:00")
    )
    expect(exams[0]).toMatchObject({
      name: "医学免疫学",
      startAt: "2026-06-30T09:00:00",
      endAt: "2026-06-30T11:00:00",
      startTimestamp: Date.parse("2026-06-30T09:00:00+08:00"),
      status: "completed",
      examLocation: "新蒲校区 第三十二阶梯教室",
      seatNumber: "689",
    })
  })

  it("builds a Monday-Sunday current-week anchor", () => {
    expect(
      currentWeekFromContext({ code: "202601", semester: "2026-2027-1", week: 11 }, "2026-11-13")
    ).toMatchObject({
      week: 11,
      weekday: 5,
      weekStartDate: "2026-11-09",
      weekEndDate: "2026-11-15",
      weekDates: [
        "2026-11-09",
        "2026-11-10",
        "2026-11-11",
        "2026-11-12",
        "2026-11-13",
        "2026-11-14",
        "2026-11-15",
      ],
    })
  })
})
