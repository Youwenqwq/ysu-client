"use client";

import { useProvider } from "../use-provider";
import type {
  EvaluationDetail,
  EvaluationDetailQuery,
  EvaluationTask,
  EvaluationType,
  TermQueryOptions,
} from "../types";
import { useProviderQuery, type ProviderQueryResult } from "./use-provider-query";

export function useEvaluationTypes(
  options?: TermQueryOptions,
): ProviderQueryResult<EvaluationType[]> {
  const provider = useProvider();
  return useProviderQuery(
    "evaluation",
    "evaluation-types",
    () => provider.getEvaluationTypes(options),
    options,
  );
}

export function useEvaluationTasks(
  options?: TermQueryOptions,
): ProviderQueryResult<EvaluationTask[]> {
  const provider = useProvider();
  return useProviderQuery(
    "evaluation",
    "evaluation-tasks",
    () => provider.getEvaluationTasks(options),
    options,
  );
}

export function usePendingEvaluations(
  evalType: string | undefined,
  options?: TermQueryOptions,
): ProviderQueryResult<EvaluationTask[]> {
  const provider = useProvider();
  return useProviderQuery(
    "evaluation",
    "pending-evaluations",
    () => (evalType ? provider.getPendingEvaluations(evalType, options) : Promise.resolve([])),
    { evalType, ...options },
  );
}

export function useEvaluationDetail(
  query: EvaluationDetailQuery | undefined,
): ProviderQueryResult<EvaluationDetail> {
  const provider = useProvider();
  return useProviderQuery(
    "evaluation",
    "evaluation-detail",
    () => {
      if (!query) throw new Error("evaluation detail query is required");
      return provider.getEvaluationDetail(query);
    },
    query,
  );
}
