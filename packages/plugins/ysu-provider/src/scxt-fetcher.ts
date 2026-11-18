/**
 * Scxt data fetcher wrapper for YSU Provider.
 */
import { ProviderError, ProviderErrorCode, wrapError } from "@orahako/academic-sdk"
import {
  ScxtError,
  ScxtNotLoggedInError,
  ScxtProtocolError,
  type CatalogPage as ScxtCatalogPage,
  type Competition as ScxtCompetition,
  type CreditBatch as ScxtCreditBatch,
  type CreditDeclaration as ScxtCreditDeclaration,
  type CreditRecord as ScxtCreditRecord,
  type CreditSummary as ScxtCreditSummary,
  type LibraryActivity as ScxtLibraryActivity,
  type ScxtProtocol,
} from "./protocol/scxt"

export type ScxtFetcher = Pick<
  ScxtProtocol,
  | "queryCreditBatches"
  | "queryCreditDeclarations"
  | "queryCreditRecords"
  | "queryAllCreditRecords"
  | "queryCreditSummary"
  | "queryCompetitions"
  | "queryLibraryActivities"
>

export function createScxtFetcher(
  scxt: ScxtProtocol,
  mapCASSessionError: (error: unknown) => ProviderError | undefined
): ScxtFetcher {
  function mapScxtError(e: unknown): ProviderError {
    const sessionError = mapCASSessionError(e)
    if (sessionError) return sessionError

    if (e instanceof ScxtNotLoggedInError) {
      return new ProviderError(ProviderErrorCode.AUTH_SESSION_EXPIRED, e.message, e, 401)
    }
    if (e instanceof ScxtProtocolError) {
      return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500)
    }
    if (e instanceof ScxtError) {
      return new ProviderError(ProviderErrorCode.BACKEND_PROTOCOL_ERROR, e.message, e, 500)
    }
    return wrapError(e)
  }

  async function withScxt<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw mapScxtError(e)
    }
  }

  return {
    queryCreditBatches: (): Promise<ScxtCreditBatch[]> => withScxt(() => scxt.queryCreditBatches()),
    queryCreditDeclarations: (opts): Promise<ScxtCreditDeclaration[]> =>
      withScxt(() => scxt.queryCreditDeclarations(opts)),
    queryCreditRecords: (opts): Promise<ScxtCreditRecord[]> =>
      withScxt(() => scxt.queryCreditRecords(opts)),
    queryAllCreditRecords: (): Promise<ScxtCreditRecord[]> =>
      withScxt(() => scxt.queryAllCreditRecords()),
    queryCreditSummary: (): Promise<ScxtCreditSummary> => withScxt(() => scxt.queryCreditSummary()),
    queryCompetitions: (opts): Promise<ScxtCatalogPage<ScxtCompetition>> =>
      withScxt(() => scxt.queryCompetitions(opts)),
    queryLibraryActivities: (opts): Promise<ScxtCatalogPage<ScxtLibraryActivity>> =>
      withScxt(() => scxt.queryLibraryActivities(opts)),
  }
}
