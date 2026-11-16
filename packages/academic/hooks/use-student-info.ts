"use client"

import { useProvider, useProviderQuery, type ProviderQueryResult } from "@orahako/plugin-ui/hooks"
import type { StudentInfo } from "@orahako/plugin-sdk/academic"

export type UseStudentInfoResult = ProviderQueryResult<StudentInfo>

export function useStudentInfo(): UseStudentInfoResult {
  const provider = useProvider()
  return useProviderQuery("studentInfo", "student-info", () => provider.getStudentInfo())
}
