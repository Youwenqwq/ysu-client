/**
 * Xgxt data fetcher wrapper for YSU Provider.
 */
import { ProviderError, ProviderErrorCode, wrapError } from "@orahako/academic-sdk"
import {
  XgxtBusinessError,
  XgxtError,
  XgxtNotLoggedInError,
  XgxtProtocolError,
  type AcademicReportPage as XgxtAcademicReportPage,
  type AcademicReportYears as XgxtAcademicReportYears,
  type EvaluationIndicatorDetail as XgxtEvaluationIndicatorDetail,
  type EvaluationRadarItem as XgxtEvaluationRadarItem,
  type EvaluationResult as XgxtEvaluationResult,
  type EvaluationTerm as XgxtEvaluationTerm,
  type XgxtProtocol,
  type YearScoreStatic as XgxtYearScoreStatic,
} from "./protocol/xgxt"

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

  return {
    queryEvaluationTerms: (): Promise<XgxtEvaluationTerm[]> =>
      withXgxt(() => xgxt.queryEvaluationTerms()),
    queryEvaluationResult: (year, term): Promise<XgxtEvaluationResult> =>
      withXgxt(() => xgxt.queryEvaluationResult(year, term)),
    queryEvaluationIndicators: (year, term): Promise<XgxtEvaluationIndicatorDetail[]> =>
      withXgxt(() => xgxt.queryEvaluationIndicators(year, term)),
    queryEvaluationRadar: (year, term): Promise<XgxtEvaluationRadarItem[]> =>
      withXgxt(() => xgxt.queryEvaluationRadar(year, term)),
    queryYearScoreStatics: (): Promise<XgxtYearScoreStatic[]> =>
      withXgxt(() => xgxt.queryYearScoreStatics()),
    queryAcademicReportYears: (): Promise<XgxtAcademicReportYears> =>
      withXgxt(() => xgxt.queryAcademicReportYears()),
    queryAcademicReport: (year): Promise<XgxtAcademicReportPage> =>
      withXgxt(() => xgxt.queryAcademicReport(year)),
  }
}
