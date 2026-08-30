"use client"

import { useProvider } from "../use-provider"
import type { StudentInfo } from "../types"
import { useProviderQuery, type ProviderQueryResult } from "./use-provider-query"

export type UseStudentInfoResult = ProviderQueryResult<StudentInfo>

export function useStudentInfo(): UseStudentInfoResult {
  const provider = useProvider()
  return useProviderQuery("studentInfo", "student-info", () => provider.getStudentInfo())
}
