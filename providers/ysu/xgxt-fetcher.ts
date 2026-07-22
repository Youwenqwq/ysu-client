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
  queryAcademicReport as _queryAcademicReport,
  queryAcademicReportYears as _queryAcademicReportYears,
  queryEvaluationIndicators as _queryEvaluationIndicators,
  queryEvaluationRadar as _queryEvaluationRadar,
  queryEvaluationResult as _queryEvaluationResult,
  queryEvaluationTerms as _queryEvaluationTerms,
  queryYearScoreStatics as _queryYearScoreStatics,
} from "./protocol/xgxt";
import type {
  AcademicReportPage as XgxtAcademicReportPage,
  AcademicReportYears as XgxtAcademicReportYears,
  EvaluationIndicatorDetail as XgxtEvaluationIndicatorDetail,
  EvaluationRadarItem as XgxtEvaluationRadarItem,
  EvaluationResult as XgxtEvaluationResult,
  EvaluationTerm as XgxtEvaluationTerm,
  YearScoreStatic as XgxtYearScoreStatic,
} from "./protocol/xgxt";
import { ProviderError, ProviderErrorCode, wrapError } from "../errors";

function mapXgxtError(e: unknown): ProviderError {
  if (e instanceof XgxtNotLoggedInError) {
    return new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, e.message, e, 401);
  }
  if (e instanceof XgxtBusinessError) {
    return new ProviderError(ProviderErrorCode.BACKEND_BUSINESS_ERROR, e.msg ?? e.message, e, 400);
  }
  if (e instanceof XgxtProtocolError) {
    return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500);
  }
  if (e instanceof XgxtError) {
    return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500);
  }
  return wrapError(e);
}

async function withXgxt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw mapXgxtError(e);
  }
}

export async function queryEvaluationTerms(): Promise<XgxtEvaluationTerm[]> {
  return withXgxt(() => _queryEvaluationTerms());
}

export async function queryEvaluationResult(
  year?: string,
  term?: string,
): Promise<XgxtEvaluationResult> {
  return withXgxt(() => _queryEvaluationResult(year, term));
}

export async function queryEvaluationIndicators(
  year?: string,
  term?: string,
): Promise<XgxtEvaluationIndicatorDetail[]> {
  return withXgxt(() => _queryEvaluationIndicators(year, term));
}

export async function queryEvaluationRadar(
  year?: string,
  term?: string,
): Promise<XgxtEvaluationRadarItem[]> {
  return withXgxt(() => _queryEvaluationRadar(year, term));
}

export async function queryYearScoreStatics(): Promise<XgxtYearScoreStatic[]> {
  return withXgxt(() => _queryYearScoreStatics());
}

export async function queryAcademicReportYears(): Promise<XgxtAcademicReportYears> {
  return withXgxt(() => _queryAcademicReportYears());
}

export async function queryAcademicReport(year?: string): Promise<XgxtAcademicReportPage> {
  return withXgxt(() => _queryAcademicReport(year));
}
