"use client"

import { createContext, useContext, type ReactNode } from "react"
import { useEvaluationTasks, type ProviderQueryResult } from "@/providers/hooks"
import type { EvaluationTask } from "@/providers/types"
import { useOverviewSchedule, type OverviewSchedule } from "./use-overview-schedule"

interface OverviewData {
  schedule: OverviewSchedule
  evaluation: ProviderQueryResult<EvaluationTask[]>
}

const OverviewDataContext = createContext<OverviewData | null>(null)

/**
 * One page-lifetime subscription per query. Widgets are prop-less contributions and read
 * their data from here, so mounting or hiding a card never duplicates a request and the
 * native widget/class-reminder synchronization keeps running while the overview is open.
 */
export function OverviewDataProvider({ children }: { children: ReactNode }) {
  const schedule = useOverviewSchedule()
  const evaluation = useEvaluationTasks()
  return (
    <OverviewDataContext.Provider value={{ schedule, evaluation }}>
      {children}
    </OverviewDataContext.Provider>
  )
}

export function useOverviewData(): OverviewData {
  const value = useContext(OverviewDataContext)
  if (!value) throw new Error("Overview widgets must render inside OverviewDataProvider")
  return value
}

export function useOverviewScheduleData(): OverviewSchedule {
  return useOverviewData().schedule
}

export function useOverviewEvaluation(): ProviderQueryResult<EvaluationTask[]> {
  return useOverviewData().evaluation
}
