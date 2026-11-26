import { defineDictionary } from "@orahako/sdk"

export const studentInfoDictionary = defineDictionary({
  zh: {
    pageTitle: "学生信息",
    navTitle: "学生信息",
    student: {
      title: "学生基本信息",
      description: "个人学籍与身份信息",
      fields: {
        name: "姓名",
        studentId: "学号",
        pinyin: "拼音",
        gender: "性别",
        nation: "民族",
        nationality: "国籍",
        department: "院系",
        major: "专业",
        className: "班级",
        gradeLevel: "年级",
        enrollmentDate: "入学日期",
        expectedGraduation: "预计毕业",
        educationLevel: "学历层次",
        campus: "校区",
        studentStatus: "学籍状态",
        studyDuration: "学制",
        foreignLanguage: "外语语种",
      },
    },
  },
  en: {
    pageTitle: "Student Info",
    navTitle: "Student Info",
    student: {
      title: "Student Info",
      description: "Personal academic information",
      fields: {
        name: "Name",
        studentId: "Student ID",
        pinyin: "Pinyin",
        gender: "Gender",
        nation: "Nation",
        nationality: "Nationality",
        department: "Department",
        major: "Major",
        className: "Class",
        gradeLevel: "Grade",
        enrollmentDate: "Enrollment",
        expectedGraduation: "Graduation",
        educationLevel: "Level",
        campus: "Campus",
        studentStatus: "Status",
        studyDuration: "Duration",
        foreignLanguage: "Language",
      },
    },
  },
})

export type StudentInfoDictionary = typeof studentInfoDictionary
