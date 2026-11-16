/**
 * Xgxt data fetcher wrapper for YSU Provider.
 *
 * Wraps protocol/xgxt.ts functions with error mapping to ProviderError.
 * xgxt 会话不持久化，每次启动首次查询重新走 authorize + 角色绑定握手。
 */
import {
  XgxtBusinessError,
  XgxtError,
  XgxtNotLoggedInError,
  XgxtProtocolError,
} from "./protocol/xgxt"
import type { XgxtProtocol } from "./protocol/xgxt"
import type {
  AcademicReportPage as XgxtAcademicReportPage,
  AcademicReportYears as XgxtAcademicReportYears,
  EvaluationIndicatorDetail as XgxtEvaluationIndicatorDetail,
  EvaluationRadarItem as XgxtEvaluationRadarItem,
  EvaluationResult as XgxtEvaluationResult,
  EvaluationTerm as XgxtEvaluationTerm,
  YearScoreStatic as XgxtYearScoreStatic,
} from "./protocol/xgxt"
import { ProviderError, ProviderErrorCode, wrapError } from "@orahako/plugin-sdk/provider-errors"

export type XgxtFetcher = Pick<
  XgxtProtocol,
  | "queryEvaluationTerms"
  | "queryEvaluationResult"
  | "queryEvaluationIndicators"
  | "queryEvaluationRadar"
  | "queryYearScoreStatics"
  | "queryAcademicReportYears"
  | "queryAcademicReport"
>

export function createXgxtFetcher(
  xgxt: XgxtProtocol,
  mapCASSessionError: (error: unknown) => ProviderError | undefined
): XgxtFetcher {
  const {
    queryAcademicReport: _queryAcademicReport,
    queryAcademicReportYears: _queryAcademicReportYears,
    queryEvaluationIndicators: _queryEvaluationIndicators,
    queryEvaluationRadar: _queryEvaluationRadar,
    queryEvaluationResult: _queryEvaluationResult,
    queryEvaluationTerms: _queryEvaluationTerms,
    queryYearScoreStatics: _queryYearScoreStatics,
  } = xgxt

function mapXgxtError(e: unknown): ProviderError {
  const sessionError = mapCASSessionError(e)
  if (sessionError) return sessionError

  if (e instanceof XgxtNotLoggedInError) {
    return new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, e.message, e, 401)
  }
  if (e instanceof XgxtBusinessError) {
    return new ProviderError(ProviderErrorCode.BACKEND_BUSINESS_ERROR, e.msg ?? e.message, e, 400)
  }
  if (e instanceof XgxtProtocolError) {
    return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500)
  }
  if (e instanceof XgxtError) {
    return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500)
  }
  return wrapError(e)
}

async function withXgxt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    throw mapXgxtError(e)
  }
}

async function queryEvaluationTerms(): Promise<XgxtEvaluationTerm[]> {
  return withXgxt(() => _queryEvaluationTerms())
}

async function queryEvaluationResult(
  year?: string,
  term?: string
): Promise<XgxtEvaluationResult> {
  return withXgxt(() => _queryEvaluationResult(year, term))
}

async function queryEvaluationIndicators(
  year?: string,
  term?: string
): Promise<XgxtEvaluationIndicatorDetail[]> {
  return withXgxt(() => _queryEvaluationIndicators(year, term))
}

async function queryEvaluationRadar(
  year?: string,
  term?: string
): Promise<XgxtEvaluationRadarItem[]> {
  return withXgxt(() => _queryEvaluationRadar(year, term))
}

async function queryYearScoreStatics(): Promise<XgxtYearScoreStatic[]> {
  return withXgxt(() => _queryYearScoreStatics())
}

async function queryAcademicReportYears(): Promise<XgxtAcademicReportYears> {
  return withXgxt(() => _queryAcademicReportYears())
}

async function queryAcademicReport(year?: string): Promise<XgxtAcademicReportPage> {
  return withXgxt(() => _queryAcademicReport(year))
}

  return {
    queryEvaluationTerms,
    queryEvaluationResult,
    queryEvaluationIndicators,
    queryEvaluationRadar,
    queryYearScoreStatics,
    queryAcademicReportYears,
    queryAcademicReport,
  }
}
